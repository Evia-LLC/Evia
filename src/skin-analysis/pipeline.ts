/**
 * The client-side skin analysis pipeline (ARCHITECTURE §3).
 *
 *   frame -> quality gate -> face ROI -> canonical crop -> normalise -> metrics
 *
 * Runs entirely on the device. The image only ever leaves the browser if the
 * user separately consented to storing it, and the metrics that get uploaded are
 * numbers, not pixels.
 *
 * Progress is reported from the real stages, because the scan-line sweep in the
 * clinical room is driven by this and a progress bar that is secretly a timer is
 * exactly the kind of fake the brief rules out.
 */
import { assessCapture, type FaceBox } from './quality.ts';
import {
  resolveProvider,
  SkinToneRegionProvider,
  subdivide,
  type RegionRect,
  type RoiProvider,
} from './roi.ts';
import { buildChannels, computeMetrics, computeRegionStats } from './metrics.ts';
import { normaliseInPlace } from './normalise.ts';
import {
  FACE_REGIONS,
  SKIN_MODEL_VERSION,
  type FaceRegionKey,
  type RegionStats,
  type SkinAnalysis,
} from '@shared/types.ts';
import { clamp } from '@/lib/math.ts';

/** Working resolution for detection and gating. */
const DETECT_LONG_EDGE = 512;

/**
 * The face is resampled to a fixed pixel height before measurement. Without
 * this, standing closer to the camera would raise the texture and pore scores
 * on its own, and the whole longitudinal model would be measuring distance from
 * the lens.
 */
const CANONICAL_FACE_WIDTH = 288;
const CANONICAL_FACE_HEIGHT = 384;

export type ProgressFn = (progress: number, stage: string) => void;

export class CaptureRejected extends Error {
  quality: ReturnType<typeof assessCapture>;
  constructor(quality: ReturnType<typeof assessCapture>) {
    super(quality.issues[0] ?? 'That capture is not usable.');
    this.name = 'CaptureRejected';
    this.quality = quality;
  }
}

export interface AnalysisResult {
  analysis: SkinAnalysis;
  /** JPEG of the canonical crop, base64, for optional consented storage. */
  imageBase64: string;
  /**
   * Where the crop came from, as fractions of the source frame. The live mesh
   * is measured on the source, so this is what puts it onto the stored image.
   */
  crop: { x: number; y: number; w: number; h: number };
}

let cachedProvider: RoiProvider | null = null;

export async function analyseFace(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  onProgress: ProgressFn = () => {},
): Promise<AnalysisResult> {
  onProgress(0.04, 'reading the frame');

  const detectCanvas = drawScaled(source, DETECT_LONG_EDGE);
  const detectCtx = context2d(detectCanvas);
  const detectImage = detectCtx.getImageData(0, 0, detectCanvas.width, detectCanvas.height);

  onProgress(0.16, 'finding your face');
  if (!cachedProvider) cachedProvider = await resolveProvider();

  // A provider that fails at detect time degrades to the one that always works,
  // rather than taking the scan down with it. The fallback is permanent for the
  // session so this costs one failed attempt, not one per scan.
  let roi;
  try {
    roi = await cachedProvider.detect(detectImage);
  } catch (err) {
    if (cachedProvider instanceof SkinToneRegionProvider) throw err;
    console.warn(
      `[evia/skin] ${cachedProvider.name} failed, falling back to skin-tone regions:`,
      (err as Error).message,
    );
    cachedProvider = new SkinToneRegionProvider();
    roi = await cachedProvider.detect(detectImage);
  }

  onProgress(0.3, 'checking the lighting');
  const quality = assessCapture(detectImage, roi.face);
  if (quality.verdict === 'fail') throw new CaptureRejected(quality);

  onProgress(0.42, 'lining everything up');
  const face = roi.face as FaceBox;
  const { canvas: cropCanvas, rect: crop } = cropToCanonical(source, face, detectCanvas);
  const cropCtx = context2d(cropCanvas);
  const cropImage = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);

  onProgress(0.55, 'correcting for the light');
  normaliseInPlace(cropImage);
  cropCtx.putImageData(cropImage, 0, 0);

  onProgress(0.68, 'mapping the regions');
  // In canonical space the face fills the frame, so regions come from the whole
  // canvas rather than from the original detection box.
  const canonicalFace: FaceBox = {
    x: 0,
    y: 0,
    width: cropImage.width,
    height: cropImage.height,
    confidence: face.confidence,
  };
  const rects = subdivide(canonicalFace);

  onProgress(0.78, 'measuring');
  const channels = buildChannels(cropImage);
  const regions: Partial<Record<FaceRegionKey, RegionStats>> = {};
  for (const key of FACE_REGIONS) {
    const rect = rects[key] as RegionRect | undefined;
    if (rect) regions[key] = computeRegionStats(channels, rect);
  }

  onProgress(0.9, 'working out what it means');
  const metrics = computeMetrics(channels, regions, rects);

  // Confidence is the product of how good the capture was and how sure the ROI
  // finder is. It flows through to what Evia is willing to claim.
  const confidence = clamp(quality.score * roi.confidence);

  onProgress(1, 'done');

  return {
    analysis: {
      capturedAt: new Date().toISOString(),
      metrics,
      regions,
      quality,
      confidence,
      modelVersion: SKIN_MODEL_VERSION,
    },
    imageBase64: cropCanvas.toDataURL('image/jpeg', 0.86).split(',')[1],
    crop,
  };
}

// ---------------------------------------------------------------------------

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  // willReadFrequently matters here: every stage reads the buffer back.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  return ctx;
}

function sourceSize(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): {
  width: number;
  height: number;
} {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function drawScaled(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  longEdge: number,
): HTMLCanvasElement {
  const { width, height } = sourceSize(source);
  if (!width || !height) throw new Error('That image has no pixels yet.');

  const scale = Math.min(1, longEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  context2d(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Re-samples the face from the *original* resolution — not from the detection
 * downscale — so no detail is thrown away before it is measured.
 */
function cropToCanonical(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  face: FaceBox,
  detectCanvas: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; rect: { x: number; y: number; w: number; h: number } } {
  const { width, height } = sourceSize(source);
  const scaleX = width / detectCanvas.width;
  const scaleY = height / detectCanvas.height;

  // A little padding, since the skin-tone box tends to clip at the hairline.
  const pad = 0.06;
  let sx = Math.max(0, (face.x - face.width * pad) * scaleX);
  let sy = Math.max(0, (face.y - face.height * pad) * scaleY);
  let sw = Math.min(width - sx, face.width * (1 + pad * 2) * scaleX);
  let sh = Math.min(height - sy, face.height * (1 + pad * 2) * scaleY);

  // Match the source rect to the canonical aspect *before* drawing, by growing
  // the short side around the same centre.
  //
  // Stretching a variable-aspect detection box into a fixed 3:4 frame scales x
  // and y by different factors, which changes horizontal and vertical spatial
  // frequency by different amounts. Texture and pore density are measured from
  // exactly that frequency, so an identical face detected with a slightly
  // taller box would score differently — which would quietly undermine the
  // longitudinal comparison the whole model rests on. It also slides the
  // anatomical region grid off the features it is supposed to sample.
  const targetAspect = CANONICAL_FACE_WIDTH / CANONICAL_FACE_HEIGHT;
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;

  if (sw / sh > targetAspect) {
    sh = sw / targetAspect; // too wide: take more vertically
  } else {
    sw = sh * targetAspect; // too tall: take more horizontally
  }

  // Re-centre, then pull back inside the source. Clamping the origin alone
  // would shift the face off-centre near an edge.
  sw = Math.min(sw, width);
  sh = Math.min(sh, height);
  sx = Math.min(Math.max(0, cx - sw / 2), width - sw);
  sy = Math.min(Math.max(0, cy - sh / 2), height - sh);

  const canvas = document.createElement('canvas');
  canvas.width = CANONICAL_FACE_WIDTH;
  canvas.height = CANONICAL_FACE_HEIGHT;
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { canvas, rect: { x: sx / width, y: sy / height, w: sw / width, h: sh / height } };
}
