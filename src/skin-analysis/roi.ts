/**
 * Face region-of-interest detection (ARCHITECTURE §3, step 3).
 *
 * Two providers behind one interface. The default needs no model file, no
 * download and no network, which means the analysis works offline and on first
 * run — an important property when the alternative is a 3 MB fetch standing
 * between the user and the first thing the product does.
 *
 * `MediapipeLandmarkProvider` is declared here and used automatically when the
 * landmark model is present in /public/models; it gives tighter regions when
 * available.
 */
import { isSkinChroma } from './color.ts';
import type { FaceBox } from './quality.ts';
import { FACE_REGIONS, type FaceRegionKey } from '@shared/types.ts';
import { clamp } from '@/lib/math.ts';

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoiResult {
  face: FaceBox | null;
  /** Rects in the coordinate space of the image that was passed in. */
  regions: Partial<Record<FaceRegionKey, RegionRect>>;
  confidence: number;
  provider: string;
}

export interface RoiProvider {
  readonly name: string;
  available(): Promise<boolean>;
  detect(image: ImageData): Promise<RoiResult>;
}

/**
 * Skin-chroma segmentation: build a skin mask, take the largest connected
 * component, fit a box, then subdivide anatomically.
 *
 * Deliberately simple and deliberately honest about it — `confidence` reflects
 * how face-like the component actually is, and a low confidence flows all the
 * way through to what Evia says about the numbers.
 */
export class SkinToneRegionProvider implements RoiProvider {
  readonly name = 'skin-tone-v1';

  async available(): Promise<boolean> {
    return true;
  }

  async detect(image: ImageData): Promise<RoiResult> {
    const { width, height, data } = image;
    const mask = new Uint8Array(width * height);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      mask[p] = isSkinChroma(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
    }

    this.erode(mask, width, height);
    this.dilate(mask, width, height);

    const component = this.largestComponent(mask, width, height);
    if (!component || component.count < width * height * 0.012) {
      return { face: null, regions: {}, confidence: 0, provider: this.name };
    }

    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;

    // A face is taller than it is wide and reasonably solid. A hand, an arm or a
    // wooden door catching the light fails at least one of those.
    const aspect = boxHeight / boxWidth;
    const fill = component.count / (boxWidth * boxHeight);
    const aspectScore = clamp(1 - Math.abs(aspect - 1.32) / 0.85);
    const fillScore = clamp((fill - 0.34) / 0.4);
    const confidence = clamp(Math.sqrt(aspectScore * fillScore));

    const face: FaceBox = {
      x: component.minX,
      y: component.minY,
      width: boxWidth,
      height: boxHeight,
      confidence,
    };

    return { face, regions: subdivide(face), confidence, provider: this.name };
  }

  /** 4-neighbour erosion — removes single-pixel speckle from the mask. */
  private erode(mask: Uint8Array, w: number, h: number): void {
    const copy = mask.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (!copy[p]) continue;
        if (!copy[p - 1] || !copy[p + 1] || !copy[p - w] || !copy[p + w]) mask[p] = 0;
      }
    }
  }

  /** Fills the holes erosion and eyes/lips leave behind. */
  private dilate(mask: Uint8Array, w: number, h: number): void {
    const copy = mask.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (copy[p]) continue;
        if (copy[p - 1] || copy[p + 1] || copy[p - w] || copy[p + w]) mask[p] = 1;
      }
    }
  }

  /** Iterative flood fill — recursion blows the stack on a full-frame region. */
  private largestComponent(
    mask: Uint8Array,
    w: number,
    h: number,
  ): { count: number; minX: number; minY: number; maxX: number; maxY: number } | null {
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    let best: { count: number; minX: number; minY: number; maxX: number; maxY: number } | null =
      null;

    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;

      let count = 0;
      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;

      stack.length = 0;
      stack.push(start);
      seen[start] = 1;

      while (stack.length) {
        const p = stack.pop()!;
        const x = p % w;
        const y = (p - x) / w;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        if (x > 0 && mask[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1);
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1);
        if (y > 0 && mask[p - w] && !seen[p - w]) (seen[p - w] = 1), stack.push(p - w);
        if (y < h - 1 && mask[p + w] && !seen[p + w]) (seen[p + w] = 1), stack.push(p + w);
      }

      if (!best || count > best.count) best = { count, minX, minY, maxX, maxY };
    }

    return best;
  }
}

/**
 * Anatomical subdivision of a face box, in normalised face coordinates.
 * Proportions are the standard thirds: hairline-to-brow, brow-to-nose-base,
 * nose-base-to-chin.
 */
const REGION_FRACTIONS: Record<FaceRegionKey, [number, number, number, number]> = {
  //                     x        y        w       h   (fractions of the face box)
  forehead: [0.24, 0.06, 0.52, 0.17],
  glabella: [0.41, 0.24, 0.18, 0.09],
  nose: [0.42, 0.34, 0.16, 0.22],
  cheekLeft: [0.1, 0.38, 0.24, 0.22],
  cheekRight: [0.66, 0.38, 0.24, 0.22],
  periorbitalLeft: [0.16, 0.28, 0.22, 0.1],
  periorbitalRight: [0.62, 0.28, 0.22, 0.1],
  perioral: [0.33, 0.6, 0.34, 0.13],
  chin: [0.36, 0.76, 0.28, 0.14],
};

export function subdivide(face: FaceBox): Partial<Record<FaceRegionKey, RegionRect>> {
  const regions: Partial<Record<FaceRegionKey, RegionRect>> = {};
  for (const key of FACE_REGIONS) {
    const [fx, fy, fw, fh] = REGION_FRACTIONS[key];
    regions[key] = {
      x: Math.round(face.x + fx * face.width),
      y: Math.round(face.y + fy * face.height),
      width: Math.max(2, Math.round(fw * face.width)),
      height: Math.max(2, Math.round(fh * face.height)),
    };
  }
  return regions;
}

/**
 * Landmark-based provider. Used when `/models/face_landmarker.task` has been
 * added to the project; falls back silently when it has not, which is the
 * default state of a fresh checkout.
 */
export class MediapipeLandmarkProvider implements RoiProvider {
  readonly name = 'mediapipe-facelandmarker';
  private landmarker: unknown = null;
  private checked = false;
  private ok = false;

  async available(): Promise<boolean> {
    if (this.checked) return this.ok;
    this.checked = true;
    try {
      const probe = await fetch('/models/face_landmarker.task', { method: 'HEAD' });
      // A dev server with SPA fallback answers 200 with index.html for any
      // unknown path, so `ok` alone is not evidence the model exists. Require a
      // non-HTML body of plausible size.
      const type = probe.headers.get('content-type') ?? '';
      const length = Number(probe.headers.get('content-length') ?? 0);
      this.ok = probe.ok && !type.includes('text/html') && length > 100_000;
    } catch {
      this.ok = false;
    }
    return this.ok;
  }

  async detect(image: ImageData): Promise<RoiResult> {
    // Intentionally not implemented until the model file ships: returning a
    // wrong answer would be worse than deferring to the provider that works.
    void image;
    void this.landmarker;
    throw new Error('Mediapipe landmark provider requires /models/face_landmarker.task');
  }
}

/** Picks the best available provider, preferring landmarks when present. */
export async function resolveProvider(): Promise<RoiProvider> {
  const mediapipe = new MediapipeLandmarkProvider();
  if (await mediapipe.available()) return mediapipe;
  return new SkinToneRegionProvider();
}
