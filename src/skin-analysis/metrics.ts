/**
 * The nine appearance metrics (ARCHITECTURE §3, step 4).
 *
 * Every number this product ever says out loud is computed here, from real
 * pixels, deterministically. There is no model in this file and no randomness —
 * the same image always produces the same result, which is what makes two scans
 * six weeks apart comparable at all.
 *
 * WHAT THESE ARE: measurements of how skin *appears* under a normalised capture.
 * WHAT THESE ARE NOT: clinical measurements. There is no corneometer here. The
 * hydration metric measures the fine surface roughness that dehydrated skin
 * shows; it does not measure water content, and the product must never claim it
 * does.
 *
 * CALIBRATION: the constants below map raw signal ranges onto 0–100. They are an
 * initial calibration, and they are the reason SKIN_MODEL_VERSION exists — when
 * they change, the version changes, and the longitudinal engine stops comparing
 * across the boundary instead of quietly drawing a wrong line.
 */
import { rgbToHsv, rgbToLab, type Hsv, type Lab } from './color.ts';
import type { RegionRect } from './roi.ts';
import {
  FACE_REGIONS,
  SKIN_METRIC_KEYS,
  type FaceRegionKey,
  type RegionStats,
  type SkinAppearanceMetrics,
  type SkinMetricKey,
} from '@shared/types.ts';
import { clamp } from '@/lib/math.ts';

/** Raw-signal to 0–100 mapping. [low, high] where low maps to 0. */
const CALIBRATION = {
  /** Mean high-frequency L* energy. Smooth skin ~1.2, visibly crepey ~6.5. */
  highFreq: [1.1, 6.5],
  /** Specular pixel fraction in the T-zone. Matte ~0.005, shiny ~0.16. */
  specular: [0.004, 0.16],
  /** a* elevation over the face's own baseline, in Lab units. */
  rednessDelta: [0.6, 9.0],
  /** Local σ of L* at fine scale. */
  sigmaL: [1.4, 8.0],
  /** Pore-scale local minima per 1000 px. */
  poreDensity: [1.0, 26.0],
  /** Dark-blob area fraction. */
  darkFraction: [0.004, 0.11],
  /** Inter-region σ of L* and b*, combined. */
  unevenness: [1.2, 9.5],
  /** Infraorbital darkening: cheek L* minus periorbital L*. */
  underEyeDelta: [0.5, 11.0],
  /** Co-located redness + texture pixel fraction. */
  acneFraction: [0.002, 0.075],
} as const;

/** Maps a raw value onto 0–100 using a calibration range. */
const scale = (value: number, [lo, hi]: readonly [number, number]): number =>
  clamp((value - lo) / (hi - lo)) * 100;

/** Regions grouped by what they are diagnostic of. */
const TZONE: FaceRegionKey[] = ['forehead', 'glabella', 'nose'];
const CHEEKS: FaceRegionKey[] = ['cheekLeft', 'cheekRight'];
const INFLAMMATION_PRONE: FaceRegionKey[] = ['cheekLeft', 'cheekRight', 'nose', 'chin'];
const SMOOTH_REFERENCE: FaceRegionKey[] = ['forehead', 'cheekLeft', 'cheekRight'];
const PERIORBITAL: FaceRegionKey[] = ['periorbitalLeft', 'periorbitalRight'];

/**
 * Which regions each metric is actually measured from.
 *
 * Written next to the groups it is built out of, and next to `computeMetrics`,
 * because it exists to be shown to the user: the scan atlas lights these zones
 * on their own photograph when they pick a metric. If a claim is made about
 * "your under-eyes", this is the promise that the number came from there.
 *
 * `evenness` is the whole face by construction — it is the variation *between*
 * regions, so no single zone produces it.
 */
export const METRIC_REGIONS: Record<SkinMetricKey, FaceRegionKey[]> = {
  hydration: SMOOTH_REFERENCE,
  oiliness: [...TZONE, ...CHEEKS],
  redness: INFLAMMATION_PRONE,
  texture: SMOOTH_REFERENCE,
  pores: ['nose', 'cheekLeft', 'cheekRight'],
  darkSpots: ['forehead', 'cheekLeft', 'cheekRight', 'perioral', 'chin'],
  evenness: [...FACE_REGIONS],
  underEye: [...PERIORBITAL, ...CHEEKS],
  acneIndicators: INFLAMMATION_PRONE,
};

/** Per-pixel derived channels for the whole working image. */
interface Channels {
  width: number;
  height: number;
  L: Float32Array;
  a: Float32Array;
  b: Float32Array;
  /** |L − boxBlur(L, r=3)| — fine detail energy. */
  highFreq: Float32Array;
  /** 1 where the pixel reads as a specular highlight. */
  specular: Uint8Array;
  /** 1 where the pixel is a pore-scale local minimum. */
  poreMinima: Uint8Array;
}

export function buildChannels(image: ImageData): Channels {
  const { width, height, data } = image;
  const n = width * height;
  const L = new Float32Array(n);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  const specular = new Uint8Array(n);

  const lab: Lab = { L: 0, a: 0, b: 0 };
  const hsv: Hsv = { h: 0, s: 0, v: 0 };

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    rgbToLab(data[i], data[i + 1], data[i + 2], lab);
    L[p] = lab.L;
    a[p] = lab.a;
    b[p] = lab.b;

    // A specular highlight is bright and desaturated — sebum reflecting the
    // light source, rather than lighter skin, which stays saturated.
    rgbToHsv(data[i], data[i + 1], data[i + 2], hsv);
    specular[p] = hsv.v > 0.8 && hsv.s < 0.2 ? 1 : 0;
  }

  const blurred = boxBlur(L, width, height, 3);
  const highFreq = new Float32Array(n);
  for (let p = 0; p < n; p++) highFreq[p] = Math.abs(L[p] - blurred[p]);

  return { width, height, L, a, b, highFreq, specular, poreMinima: findPoreMinima(L, width, height) };
}

/** Separable box blur — O(n) regardless of radius. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const window = r * 2 + 1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + clampIndex(x, w)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / window;
      sum -= src[row + clampIndex(x - r, w)];
      sum += src[row + clampIndex(x + r + 1, w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clampIndex(y, h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / window;
      sum -= tmp[clampIndex(y - r, h) * w + x];
      sum += tmp[clampIndex(y + r + 1, h) * w + x];
    }
  }
  return out;
}

const clampIndex = (v: number, max: number): number => (v < 0 ? 0 : v >= max ? max - 1 : v);

/**
 * Pores read as small, isolated dark points. A pixel counts when it is darker
 * than all eight neighbours by a margin — a plain darkness threshold would
 * catch shadow and hair instead.
 */
function findPoreMinima(L: Float32Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(L.length);
  const MARGIN = 1.4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const v = L[p];
      if (
        v + MARGIN < L[p - 1] &&
        v + MARGIN < L[p + 1] &&
        v + MARGIN < L[p - w] &&
        v + MARGIN < L[p + w] &&
        v + MARGIN < L[p - w - 1] &&
        v + MARGIN < L[p - w + 1] &&
        v + MARGIN < L[p + w - 1] &&
        v + MARGIN < L[p + w + 1]
      ) {
        out[p] = 1;
      }
    }
  }
  return out;
}

export function computeRegionStats(
  channels: Channels,
  rect: RegionRect,
): RegionStats {
  const { width, height, L, a, b, highFreq, specular } = channels;
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(width, rect.x + rect.width);
  const y1 = Math.min(height, rect.y + rect.height);

  let samples = 0;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let sumHf = 0;
  let sumSpec = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      samples++;
      sumL += L[p];
      sumA += a[p];
      sumB += b[p];
      sumHf += highFreq[p];
      sumSpec += specular[p];
    }
  }

  if (samples === 0) {
    return { samples: 0, L: 0, a: 0, b: 0, sigmaL: 0, specular: 0, highFreq: 0, darkFraction: 0 };
  }

  const meanL = sumL / samples;

  // Second pass for σ and the darkness threshold, which both need the mean.
  let sumSq = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = L[y * width + x] - meanL;
      sumSq += d * d;
    }
  }
  const sigmaL = Math.sqrt(sumSq / samples);

  /*
   * A dark spot is dark *relative to the surrounding skin*, which is what makes
   * this work the same on deep and light skin tones.
   *
   * The 2.2 floor is absolute where the sigma term is relative, and that is a
   * real inconsistency — on very dark skin 2.2 L* units is a larger relative
   * step than on very light skin. Scaling it to `meanL` was tried and measured
   * *worse* (synthetic exposure drift went from 12 points to 24), because with
   * grain-level sigma the floor is the dominant term either way and tying it to
   * the mean only made it dominate harder. Left alone deliberately: changing it
   * on reasoning alone, without real faces at both ends of the tone range to
   * measure against, would be trading a known constant for an unknown one.
   */
  const threshold = meanL - Math.max(2.2, sigmaL * 1.25);
  let dark = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (L[y * width + x] < threshold) dark++;
    }
  }

  return {
    samples,
    L: meanL,
    a: sumA / samples,
    b: sumB / samples,
    sigmaL,
    specular: sumSpec / samples,
    highFreq: sumHf / samples,
    darkFraction: dark / samples,
  };
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function pick(
  regions: Partial<Record<FaceRegionKey, RegionStats>>,
  keys: FaceRegionKey[],
  field: keyof RegionStats,
): number[] {
  const out: number[] = [];
  for (const key of keys) {
    const r = regions[key];
    if (r && r.samples > 0) out.push(r[field] as number);
  }
  return out;
}

export function computeMetrics(
  channels: Channels,
  regions: Partial<Record<FaceRegionKey, RegionStats>>,
  rects: Partial<Record<FaceRegionKey, RegionRect>>,
): SkinAppearanceMetrics {
  const allA = pick(regions, [...FACE_REGIONS], 'a');
  const allL = pick(regions, [...FACE_REGIONS], 'L');
  const allB = pick(regions, [...FACE_REGIONS], 'b');
  const baselineA = median(allA);

  // --- hydration -----------------------------------------------------------
  // Dehydrated skin shows fine, crepey surface detail. Low high-frequency
  // energy on the cheeks and forehead reads as plump and smooth.
  const hf = mean(pick(regions, SMOOTH_REFERENCE, 'highFreq'));
  const hydration = 100 - scale(hf, CALIBRATION.highFreq);

  // --- oiliness ------------------------------------------------------------
  // Specular coverage, weighted to the T-zone where sebum actually pools.
  const tzoneSpec = mean(pick(regions, TZONE, 'specular'));
  const cheekSpec = mean(pick(regions, CHEEKS, 'specular'));
  const oiliness = scale(tzoneSpec * 0.72 + cheekSpec * 0.28, CALIBRATION.specular);

  // --- redness -------------------------------------------------------------
  // a* elevation in inflammation-prone regions over the face's own baseline.
  // Measuring against the person's own baseline is what makes this independent
  // of skin tone.
  const inflamedA = mean(pick(regions, INFLAMMATION_PRONE, 'a'));
  const redness = scale(inflamedA - baselineA, CALIBRATION.rednessDelta);

  // --- texture -------------------------------------------------------------
  const sigma = mean(pick(regions, SMOOTH_REFERENCE, 'sigmaL'));
  const texture = scale(sigma, CALIBRATION.sigmaL);

  // --- pores ---------------------------------------------------------------
  const poreRegions: FaceRegionKey[] = ['nose', 'cheekLeft', 'cheekRight'];
  let minima = 0;
  let area = 0;
  for (const key of poreRegions) {
    const rect = rects[key];
    if (!rect) continue;
    const x1 = Math.min(channels.width, rect.x + rect.width);
    const y1 = Math.min(channels.height, rect.y + rect.height);
    for (let y = Math.max(0, rect.y); y < y1; y++) {
      for (let x = Math.max(0, rect.x); x < x1; x++) {
        minima += channels.poreMinima[y * channels.width + x];
        area++;
      }
    }
  }
  const pores = scale(area > 0 ? (minima / area) * 1000 : 0, CALIBRATION.poreDensity);

  // --- dark spots ----------------------------------------------------------
  const darkSpots = scale(
    mean(pick(regions, ['forehead', 'cheekLeft', 'cheekRight', 'perioral', 'chin'], 'darkFraction')),
    CALIBRATION.darkFraction,
  );

  // --- evenness ------------------------------------------------------------
  // How much lightness and yellow-blue vary *between* regions. Low variation is
  // an even tone.
  const unevenness = stdDev(allL) * 0.65 + stdDev(allB) * 0.35;
  const evenness = 100 - scale(unevenness, CALIBRATION.unevenness);

  // --- under-eye -----------------------------------------------------------
  const cheekL = mean(pick(regions, CHEEKS, 'L'));
  const orbitalL = mean(pick(regions, PERIORBITAL, 'L'));
  const orbitalB = mean(pick(regions, PERIORBITAL, 'b'));
  const cheekB = mean(pick(regions, CHEEKS, 'b'));
  // Darker and bluer than the cheek is the classic under-eye signature.
  const underEye = scale(
    cheekL - orbitalL + Math.max(0, cheekB - orbitalB) * 0.4,
    CALIBRATION.underEyeDelta,
  );

  // --- breakout indicators -------------------------------------------------
  // Redness alone is irritation; texture alone is congestion. Their overlap is
  // what reads as an active breakout.
  const acneIndicators = scale(
    coLocatedFraction(channels, rects, baselineA),
    CALIBRATION.acneFraction,
  );

  const metrics: SkinAppearanceMetrics = {
    hydration,
    oiliness,
    redness,
    texture,
    pores,
    darkSpots,
    evenness,
    underEye,
    acneIndicators,
  };

  // Nothing downstream should ever have to guard against NaN or an out-of-range
  // score, so clamp once here at the boundary.
  for (const key of SKIN_METRIC_KEYS) {
    const v = metrics[key as SkinMetricKey];
    metrics[key as SkinMetricKey] = Number.isFinite(v) ? Math.round(clamp(v, 0, 100) * 10) / 10 : 0;
  }
  return metrics;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/** Fraction of facial pixels that are both notably red and notably textured. */
function coLocatedFraction(
  channels: Channels,
  rects: Partial<Record<FaceRegionKey, RegionRect>>,
  baselineA: number,
): number {
  const keys: FaceRegionKey[] = ['forehead', 'cheekLeft', 'cheekRight', 'chin', 'perioral'];
  let hits = 0;
  let total = 0;

  const A_THRESHOLD = baselineA + 4.5;
  const HF_THRESHOLD = 4.0;

  for (const key of keys) {
    const rect = rects[key];
    if (!rect) continue;
    const x1 = Math.min(channels.width, rect.x + rect.width);
    const y1 = Math.min(channels.height, rect.y + rect.height);
    for (let y = Math.max(0, rect.y); y < y1; y++) {
      for (let x = Math.max(0, rect.x); x < x1; x++) {
        const p = y * channels.width + x;
        total++;
        if (channels.a[p] > A_THRESHOLD && channels.highFreq[p] > HF_THRESHOLD) hits++;
      }
    }
  }
  return total > 0 ? hits / total : 0;
}

export type { Channels };
