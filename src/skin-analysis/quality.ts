/**
 * The capture quality gate (ARCHITECTURE §3, step 1).
 *
 * This is load-bearing rather than polish. Every longitudinal claim the product
 * makes — "your hydration improved 18%" — is only true if the two captures being
 * compared were taken under comparable conditions. A blurry, backlit, or
 * far-away frame produces numbers that look precise and mean nothing, and
 * storing them silently poisons the trend for months.
 *
 * So: refuse early, and say why in words a person would use.
 */
import { luma } from './color.ts';
import type { CaptureQuality, CaptureVerdict } from '@shared/types.ts';
import { clamp } from '@/lib/math.ts';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 — how confident the region finder is that this is a face. */
  confidence: number;
}

/** Mean luminance, normalised 0..1. */
export function measureBrightness(image: ImageData): number {
  const { data } = image;
  let total = 0;
  // Every 4th pixel: enough samples for a mean, a quarter of the work.
  for (let i = 0; i < data.length; i += 16) {
    total += luma(data[i], data[i + 1], data[i + 2]);
  }
  return total / (data.length / 16) / 255;
}

/**
 * Variance of the Laplacian — the standard focus measure. Normalised against an
 * empirical ceiling so the result is a 0..1 score rather than an arbitrary
 * magnitude.
 */
export function measureSharpness(image: ImageData): number {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = luma(data[i], data[i + 1], data[i + 2]);
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const lap =
        -4 * gray[p] + gray[p - 1] + gray[p + 1] + gray[p - width] + gray[p + width];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  // ~600 is a comfortably sharp phone selfie at this working resolution.
  return clamp(Math.sqrt(Math.max(0, variance)) / 24);
}

/**
 * Below these, the signal the metrics are built on is gone rather than weak.
 *
 * Named and shared so the sentence the user reads and the decision to refuse
 * can never drift apart — the app must not say "it's quite dark" and then
 * measure it anyway.
 */
const MIN_BRIGHTNESS = 0.22;
const MIN_SHARPNESS = 0.28;

export function assessCapture(image: ImageData, face: FaceBox | null): CaptureQuality {
  const brightness = measureBrightness(image);
  const sharpness = measureSharpness(image);
  const issues: string[] = [];

  let faceHeightFraction = 0;
  let centeringError = 1;

  if (!face) {
    issues.push("I can't find a face in that one");
  } else {
    faceHeightFraction = face.height / image.height;
    const cx = (face.x + face.width / 2) / image.width;
    const cy = (face.y + face.height / 2) / image.height;
    centeringError = Math.hypot(cx - 0.5, cy - 0.46) * 2;

    if (faceHeightFraction < 0.28) issues.push("you're a bit far from the camera");
    if (faceHeightFraction > 0.95) issues.push("you're very close — pull back slightly");
    if (centeringError > 0.5) issues.push('try centring your face in the frame');
    if (
      face.x < image.width * 0.02 ||
      face.y < image.height * 0.02 ||
      face.x + face.width > image.width * 0.98 ||
      face.y + face.height > image.height * 0.98
    ) {
      issues.push('part of your face is cut off');
    }
  }

  if (brightness < MIN_BRIGHTNESS) issues.push("it's quite dark where you are");
  else if (brightness > 0.82) issues.push("you're a bit backlit or over-exposed");
  if (sharpness < MIN_SHARPNESS) issues.push("it's a little blurry — hold still for a second");

  // Score is the product of per-factor scores, so one bad factor dominates —
  // which is correct: a sharp, well-lit photo of nothing is still useless.
  const brightnessScore = 1 - clamp(Math.abs(brightness - 0.5) / 0.42);
  const sharpnessScore = clamp((sharpness - 0.2) / 0.5);
  const sizeScore = face ? clamp((faceHeightFraction - 0.2) / 0.3) : 0;
  const centreScore = face ? clamp(1 - centeringError) : 0;
  const score = clamp(
    Math.pow(brightnessScore * sharpnessScore * sizeScore * centreScore, 0.5) *
      (face?.confidence ?? 0),
  );

  /*
   * Darkness and blur are refusals, not warnings.
   *
   * The old gate only refused when there was no face at all, or when the
   * combined score fell under 0.3. Everything above that was measured and
   * printed. That is defensible for framing problems — a face slightly off
   * centre still has readable skin — and indefensible for these two, because
   * they do not make the readings *less certain*, they make them wrong in a
   * specific and confident-looking direction.
   *
   * A dark, high-ISO frame has sensor noise everywhere, so local variance goes
   * to the ceiling (texture 100), the noise reads as dark blobs (dark spots
   * 100), and there are no specular highlights left to find (oiliness 0). That
   * is not a face with bad skin. That is a photograph of a dark room, and the
   * app printed it as a finding.
   *
   * The thresholds are the same ones that already produce the two sentences
   * below — this only stops the scan continuing past them.
   */
  const tooDark = brightness < MIN_BRIGHTNESS;
  const tooBlurry = sharpness < MIN_SHARPNESS;

  let verdict: CaptureVerdict = 'pass';
  if (!face || score < 0.3 || tooDark || tooBlurry) verdict = 'fail';
  else if (issues.length > 0 || score < 0.62) verdict = 'warn';

  return {
    verdict,
    score,
    brightness,
    sharpness,
    faceHeightFraction,
    centeringError,
    issues,
  };
}
