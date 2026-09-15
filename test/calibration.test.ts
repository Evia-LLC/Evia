/**
 * Is the measurement stable enough for the claims built on top of it?
 *
 * This is not the calibration study. That needs the same real face captured
 * repeatedly under real lighting, and it is the one piece of this project that
 * cannot be done without a camera and a person — see `scripts/repeatability.mjs`
 * for the harness that runs it when both exist.
 *
 * What can be checked here is the property the whole app rests on: the pipeline
 * normalises for light before it measures, so *the same face under different
 * light must produce the same numbers*. If a white-balance shift or an exposure
 * change moves a metric further than its own noise floor, then every downstream
 * promise is broken — "improved by 9 points" would sometimes mean the user
 * moved closer to a window.
 *
 * So: take a synthetic face, apply the distortions a phone camera actually
 * introduces, and assert the metrics hold. Synthetic input cannot tell us
 * whether 61 is the *right* hydration score. It can tell us whether 61 is a
 * stable one, which is the part the noise floors are claiming.
 */
import { describe, expect, it } from 'vitest';

import { buildChannels, computeMetrics, computeRegionStats, METRIC_REGIONS } from '../src/skin-analysis/metrics.ts';
import { subdivide } from '../src/skin-analysis/roi.ts';
import { normaliseInPlace } from '../src/skin-analysis/normalise.ts';
import {
  FACE_REGIONS,
  METRIC_NOISE_FLOOR,
  SKIN_METRIC_KEYS,
  type FaceRegionKey,
  type RegionStats,
  type SkinAppearanceMetrics,
} from '../shared/types.ts';

const SIZE = 256;

/** Pigment marks: [x, y, radius]. Spread across the regions the metric samples. */
const SPOTS: Array<[number, number, number]> = [
  [70, 120, 5],
  [88, 138, 3.5],
  [176, 126, 4.5],
  [190, 148, 3],
  [120, 60, 4],
  [140, 196, 3.5],
];

/**
 * A synthetic face: skin-toned, with plausible local variation.
 *
 * Not a photograph and not pretending to be. It exists to be *perturbed* — the
 * assertions are all about how much the numbers move between two versions of
 * the same input, never about their absolute values.
 */
function syntheticFace(seed = 1): ImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  let s = seed;
  const rand = () => {
    // Deterministic, so a failure is reproducible.
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // A broad lighting falloff plus fine grain, in a mid skin tone.
      const shade = 1 - 0.18 * Math.hypot(x / SIZE - 0.5, y / SIZE - 0.42);
      const grain = (rand() - 0.5) * 14;
      /*
       * Actual dark blobs, not just grain.
       *
       * `darkFraction` counts pixels below a threshold. On a face that has no
       * spots at all it is measuring the tail of the noise distribution, which
       * is hypersensitive to tiny changes in variance and tells us nothing
       * about the metric's behaviour on real input. Giving the fixture real
       * spots puts the statistic in the regime it was written for.
       */
      const spot = SPOTS.reduce(
        (acc, [sx, sy, sr]) =>
          acc + 46 * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * sr * sr)),
        0,
      );
      data[i] = Math.max(0, Math.min(255, 214 * shade + grain - spot));
      data[i + 1] = Math.max(0, Math.min(255, 172 * shade + grain - spot * 0.92));
      data[i + 2] = Math.max(0, Math.min(255, 150 * shade + grain - spot * 0.8));
      data[i + 3] = 255;
    }
  }
  return { data, width: SIZE, height: SIZE, colorSpace: 'srgb' } as ImageData;
}

/** Multiplies each channel — an exposure or white-balance shift. */
function relight(src: ImageData, rGain: number, gGain: number, bGain: number): ImageData {
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, data[i] * rGain));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * gGain));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * bGain));
  }
  return { data, width: src.width, height: src.height, colorSpace: 'srgb' } as ImageData;
}

function measure(image: ImageData): SkinAppearanceMetrics {
  // The real pipeline normalises for light before it measures anything, and
  // that step is the entire reason these assertions can hold. Measuring without
  // it tests a path the app never takes — and fails loudly: dark-spot area
  // moved 29.7 points under a 12% exposure change, ten times its noise floor.
  const lit = { ...image, data: new Uint8ClampedArray(image.data) } as ImageData;
  normaliseInPlace(lit);
  const channels = buildChannels(lit);
  const rects = subdivide({ x: 0, y: 0, width: lit.width, height: lit.height, confidence: 1 });
  const regions: Partial<Record<FaceRegionKey, RegionStats>> = {};
  for (const key of FACE_REGIONS) {
    const rect = rects[key];
    if (rect) regions[key] = computeRegionStats(channels, rect);
  }
  return computeMetrics(channels, regions, rects);
}

/** Largest per-metric difference, as a multiple of that metric's noise floor. */
function worstDrift(a: SkinAppearanceMetrics, b: SkinAppearanceMetrics) {
  let worst = { key: SKIN_METRIC_KEYS[0], ratio: 0, delta: 0 };
  for (const key of SKIN_METRIC_KEYS) {
    const delta = Math.abs(a[key] - b[key]);
    const ratio = delta / METRIC_NOISE_FLOOR[key];
    if (ratio > worst.ratio) worst = { key, ratio, delta };
  }
  return worst;
}

describe('measurement stability under light', () => {
  const base = syntheticFace();

  it('is deterministic on identical input', () => {
    // If this ever fails, every trend in the app is partly random.
    expect(measure(base)).toEqual(measure(base));
  });

  it('holds within the noise floor across an exposure change', () => {
    // ±12% overall brightness: walking from a window to a lamp.
    for (const gain of [0.88, 1.12]) {
      const drift = worstDrift(measure(base), measure(relight(base, gain, gain, gain)));
      expect(
        drift.ratio,
        `${drift.key} moved ${drift.delta.toFixed(1)} points at gain ${gain}, ` +
          `floor is ${METRIC_NOISE_FLOOR[drift.key]}`,
      ).toBeLessThan(1);
    }
  });

  it('holds within the noise floor across a white-balance shift', () => {
    // Warm tungsten against cool daylight — the classic bathroom-vs-window case.
    const warm = worstDrift(measure(base), measure(relight(base, 1.06, 1.0, 0.94)));
    expect(
      warm.ratio,
      `${warm.key} moved ${warm.delta.toFixed(1)} points under warm light, ` +
        `floor is ${METRIC_NOISE_FLOOR[warm.key]}`,
    ).toBeLessThan(1);
  });
});

describe('the promise the atlas makes', () => {
  it('every metric names at least one region it is measured from', () => {
    // The scan atlas lights these on the user's own photograph. An empty list
    // would mean showing a face with nothing highlighted while still claiming
    // the number came from somewhere.
    for (const key of SKIN_METRIC_KEYS) {
      expect(METRIC_REGIONS[key].length, `${key} has no regions`).toBeGreaterThan(0);
    }
  });

  it('only names regions the analyser actually samples', () => {
    const known = new Set<string>(FACE_REGIONS);
    for (const key of SKIN_METRIC_KEYS) {
      for (const region of METRIC_REGIONS[key]) {
        expect(known.has(region), `${key} names unknown region ${region}`).toBe(true);
      }
    }
  });
});
