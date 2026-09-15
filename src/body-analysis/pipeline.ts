/**
 * A body scan, end to end.
 *
 * Mirrors `analyseFace`: take a frame, find the subject, measure it, hand back
 * numbers plus the image the numbers came from. The differences are all
 * consequences of the subject being a whole person rather than a face.
 *
 *  - No canonical crop. A face is normalised into a square where it fills the
 *    frame, because every downstream region is a fraction of that square. A
 *    body is measured from joint positions, which are already relative to each
 *    other, so cropping would only throw away context.
 *
 *  - No lighting normalisation. The face pipeline corrects for light because it
 *    measures *colour*. Nothing here measures colour; moving a joint two pixels
 *    is not something white balance can do.
 *
 *  - Confidence comes from the model's own weakest landmark rather than from a
 *    capture-quality heuristic, because the pose model already knows when it is
 *    guessing and says so.
 */
import { PoseProvider, PoseUnavailable, type PoseResult } from './pose.ts';
import {
  BODY_MODEL_VERSION,
  computeBodyMetrics,
  type BodyMetrics,
  type WaistSource,
} from './metrics.ts';
import {
  PROFILE_MODEL_VERSION,
  ProfileRejected,
  checkProfileView,
  measureProfile,
  type ProfileMetrics,
} from './profile.ts';

/** Anything a frame can arrive as. */
export type CaptureSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

/** Long edge the frame is scaled to before detection. */
const DETECT_LONG_EDGE = 640;

export type ProgressFn = (fraction: number, stage: string) => void;

export interface BodyAnalysis {
  id?: string;
  capturedAt: string;
  metrics: BodyMetrics;
  /** Whether the waist was traced from the outline or estimated from joints. */
  waistSource: WaistSource;
  /**
   * The side-view reading, or null when only a front shot was taken.
   *
   * Separate from `metrics` rather than folded into it, because it comes from
   * a different photograph, a different formula and a different model version.
   * A field that is sometimes absent is honest about that; a seventh key in
   * `metrics` that is sometimes zero is not.
   */
  profile: ProfileMetrics | null;
  /** The raw depths behind the profile figure, for a calibration study. */
  profileDetail: { depthRatio: number; chestDepth: number; bellyDepth: number } | null;
  /** Normalised landmark positions, kept so the hologram can annotate them. */
  landmarks: PoseResult['landmarks'];
  /** 0..1 — the weakest joint the measurements depend on. */
  confidence: number;
  modelVersion: string;
  profileModelVersion: string | null;
}

export interface BodyAnalysisResult {
  analysis: BodyAnalysis;
  /** The front frame, as raw JPEG base64 — same contract as the face pipeline. */
  imageBase64: string;
  /** The side frame, when one was taken. This is the one a belly shows in. */
  profileImageBase64: string | null;
}

/** Thrown when the frame cannot support a body reading. Carries the reason. */
export class BodyCaptureRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyCaptureRejected';
  }
}

export { PoseUnavailable, ProfileRejected };

let cachedProvider: PoseProvider | null = null;

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  return ctx;
}

function sourceSize(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/**
 * The frame size the detector is given — always a multiple of four.
 *
 * Not cosmetic. The MediaPipe vision wasm aborts outright on a frame whose
 * width is not a multiple of four, which is a texture row-alignment constraint
 * showing through. Measured rather than assumed: on the same photograph,
 * 356x640, 360x640 and 352x632 all detect at 0.99 confidence and return a mask,
 * while 357x640 dies with `RuntimeError: Aborted()` and takes the whole wasm
 * module with it.
 *
 * This matters far beyond one fixture. A 640-long-edge scale turns a 1536x2752
 * phone photo into exactly that 357 — so without this, body scanning fails on
 * most real captures and succeeds on square ones, which is the worst possible
 * distribution of a bug: it works on every test image anybody would hand-make.
 */
export function detectSize(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(1, Math.max(width, height)));
  const align = (value: number) => Math.max(4, Math.floor((value * scale) / 4) * 4);
  return { width: align(width), height: align(height) };
}

function drawScaled(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  longEdge: number,
): HTMLCanvasElement {
  const { width, height } = sourceSize(source);
  const size = detectSize(width, height, longEdge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  context2d(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * The lowest landmark confidence the measurements are allowed to run on.
 *
 * Below this the model is placing joints it cannot see — behind a coat, out of
 * frame, or in shadow — and every ratio built on them is fiction. Refusing is
 * the only honest option.
 */
const MIN_CONFIDENCE = 0.55;

/** Detects a pose in one frame, or explains why it could not. */
async function poseIn(source: CaptureSource): Promise<{ frame: HTMLCanvasElement; pose: PoseResult }> {
  const frame = drawScaled(source, DETECT_LONG_EDGE);
  const ctx = context2d(frame);
  const image = ctx.getImageData(0, 0, frame.width, frame.height);

  cachedProvider ??= new PoseProvider();
  const pose = await cachedProvider.detect(image);
  if (!pose) {
    throw new BodyCaptureRejected(
      'I could not find a body in that frame. Stand facing me with your arms clear of your sides.',
    );
  }
  if (pose.confidence < MIN_CONFIDENCE) {
    throw new BodyCaptureRejected(
      'I can see you but not clearly enough to measure — some joints are hidden. ' +
        'Try more light, or a plainer background.',
    );
  }
  return { frame, pose };
}

/**
 * A body scan, from a front view and optionally a side one.
 *
 * The side view is where an abdomen is actually visible. A belly projects
 * forward, and a camera in front of you measures width — so a front-only scan
 * can describe proportions and posture honestly but has nothing at all to say
 * about protrusion, and says so by leaving `profile` null rather than
 * estimating it.
 *
 * Side-view problems throw `ProfileRejected` rather than `BodyCaptureRejected`,
 * so the caller can ask for that one frame again instead of discarding a
 * perfectly good front capture.
 */
export async function analyseBody(
  source: CaptureSource,
  side: CaptureSource | null = null,
  onProgress: ProgressFn = () => {},
): Promise<BodyAnalysisResult> {
  onProgress(0.05, 'reading the frame');

  /*
   * No separate classifier. The pose model is the validator.
   *
   * A skin-chroma classifier was tried and measured: on real photographs it
   * called 83% of a full-body frame "skin", because a cream sweater and a warm
   * background both pass a chroma test. It could not tell a face from a body at
   * all, and a router that guesses wrong sends a torso to the face pipeline —
   * which does not fail, it just returns confident numbers about the wrong
   * subject.
   *
   * The pose model already knows. If the frame is a close-up of a face, the
   * hips and shoulders it needs are not in it, their visibility is low, and the
   * confidence check below rejects the capture with a useful reason.
   */
  onProgress(side ? 0.25 : 0.4, 'finding your posture');
  const { frame, pose } = await poseIn(source);

  onProgress(side ? 0.5 : 0.8, 'measuring');
  const { metrics, waistSource } = computeBodyMetrics(pose.landmarks, pose.mask);

  let profile: ProfileMetrics | null = null;
  let profileDetail: BodyAnalysis['profileDetail'] = null;
  let profileImageBase64: string | null = null;

  if (side) {
    onProgress(0.65, 'reading your profile');
    const sideShot = await poseIn(side);

    /*
     * Checked before it is measured, and this order matters.
     *
     * Two front photographs analysed as a front and a side do not fail. They
     * produce a depth ratio that is really a width ratio — a plausible number,
     * stable across scans, and about the wrong axis entirely. The check is what
     * stops that being shipped as a body measurement.
     */
    const view = checkProfileView(sideShot.pose.landmarks, pose.landmarks);
    if (!view.ok) throw new ProfileRejected(view.reason);
    if (!sideShot.pose.mask) {
      throw new ProfileRejected(
        'I could not separate you from the background in that one. More light, or a plainer wall behind you.',
      );
    }

    onProgress(0.85, 'measuring your profile');
    const reading = measureProfile(sideShot.pose.mask, sideShot.pose.landmarks);
    profile = reading.metrics;
    profileDetail = {
      depthRatio: reading.depthRatio,
      chestDepth: reading.chestDepth,
      bellyDepth: reading.bellyDepth,
    };
    profileImageBase64 = cropToSubject(sideShot.frame, sideShot.pose.landmarks);
  }

  onProgress(1, 'done');
  return {
    analysis: {
      capturedAt: new Date().toISOString(),
      metrics,
      waistSource,
      profile,
      profileDetail,
      landmarks: pose.landmarks,
      confidence: pose.confidence,
      modelVersion: BODY_MODEL_VERSION,
      profileModelVersion: profile ? PROFILE_MODEL_VERSION : null,
    },
    imageBase64: cropToSubject(frame, pose.landmarks),
    profileImageBase64,
  };
}

/**
 * Crops the frame to the person before it becomes a hologram.
 *
 * The measurements do not need this — they are ratios between landmarks and do
 * not care what else is in shot. The *projection* very much does. The hologram
 * draws contour lines along luminance bands, and over a whole room those bands
 * follow the wall, the furniture and the folds of a sofa, so the result is a
 * beautiful topographic map of the background with a person somewhere in it.
 *
 * The landmarks say exactly where the person is, so the picture is cut to them.
 */
function cropToSubject(frame: HTMLCanvasElement, landmarks: PoseResult['landmarks']): string {
  // Only points the model actually saw; an invented ankle would drag the crop
  // to the floor and put the subject in a corner of it.
  const seen = landmarks.filter((p) => p.visibility > 0.5);
  if (seen.length < 4) return frame.toDataURL('image/jpeg', 0.86).split(',')[1];

  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of seen) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  // Landmarks sit on joints, so the silhouette runs past them in every
  // direction — and the head extends well above the nose.
  const padX = (maxX - minX) * 0.28;
  const padTop = (maxY - minY) * 0.22;
  const padBottom = (maxY - minY) * 0.08;
  const x0 = Math.max(0, (minX - padX) * frame.width);
  const x1 = Math.min(frame.width, (maxX + padX) * frame.width);
  const y0 = Math.max(0, (minY - padTop) * frame.height);
  const y1 = Math.min(frame.height, (maxY + padBottom) * frame.height);

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(x1 - x0));
  out.height = Math.max(1, Math.round(y1 - y0));
  context2d(out).drawImage(frame, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.86).split(',')[1];
}
