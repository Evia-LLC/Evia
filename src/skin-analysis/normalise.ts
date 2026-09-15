/**
 * Capture normalisation (ARCHITECTURE §3, step 2).
 *
 * This is the step that decides whether the longitudinal model is real.
 *
 * Without it, "your redness went up 6 points since last time" usually means the
 * user moved from daylight to a warm bulb. Grey-world white balance removes the
 * illuminant's colour cast, and exposure normalisation puts the skin at a fixed
 * working lightness, so the two captures being compared differ in skin rather
 * than in lighting.
 *
 * It cannot fix everything — hard directional light still casts shadow the
 * metrics will read as texture, which is why the quality gate rejects those
 * frames rather than trusting this to rescue them.
 */
import { luma } from './color.ts';

/** Target mean luminance after normalisation, 0..255. */
const TARGET_LUMA = 132;

/** Clamp on the per-channel gain, so a strongly tinted frame is not "corrected"
 *  into a completely different-looking face. */
const MAX_GAIN = 1.85;
const MIN_GAIN = 0.55;

export function normaliseInPlace(image: ImageData): void {
  const { data } = image;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let counted = 0;

  // Skip clipped pixels in both directions: blown highlights and crushed
  // shadows carry no colour information and would drag the estimate.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = luma(r, g, b);
    if (y < 18 || y > 244) continue;
    sumR += r;
    sumG += g;
    sumB += b;
    counted++;
  }

  if (counted === 0) return;

  const meanR = sumR / counted;
  const meanG = sumG / counted;
  const meanB = sumB / counted;
  const grey = (meanR + meanG + meanB) / 3;

  const gainR = clampGain(grey / Math.max(1, meanR));
  const gainG = clampGain(grey / Math.max(1, meanG));
  const gainB = clampGain(grey / Math.max(1, meanB));

  // Exposure: scale towards the target after the cast is removed, so the two
  // corrections do not fight each other.
  const meanLuma = luma(meanR * gainR, meanG * gainG, meanB * gainB);
  const exposure = clampGain(TARGET_LUMA / Math.max(1, meanLuma));

  const lutR = buildLut(gainR * exposure);
  const lutG = buildLut(gainG * exposure);
  const lutB = buildLut(gainB * exposure);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = lutR[data[i]];
    data[i + 1] = lutG[data[i + 1]];
    data[i + 2] = lutB[data[i + 2]];
  }
}

const clampGain = (g: number): number => Math.min(MAX_GAIN, Math.max(MIN_GAIN, g));

/** 256-entry lookup so the per-pixel loop is a table read, not arithmetic. */
function buildLut(gain: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = v * gain;
  return lut;
}
