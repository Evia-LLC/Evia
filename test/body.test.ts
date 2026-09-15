/**
 * Body readings, and what they refuse to be.
 *
 * The design constraint is that every metric is a ratio between joints, so that
 * none of them change when the camera does. These tests exist to hold that
 * line: the same pose photographed from twice the distance must produce the
 * same numbers, or the app is reporting its own conditions as your body.
 */
import { describe, expect, it } from 'vitest';

import {
  BODY_METRIC_KEYS,
  BODY_NOISE_FLOOR,
  computeBodyMetrics,
  type BodyMetrics,
} from '../src/body-analysis/metrics.ts';
import { POSE, type Landmark } from '../src/body-analysis/pose.ts';
import { METRIC_NOISE_FLOOR } from '../shared/types.ts';

/**
 * The six posture readings alone.
 *
 * `computeBodyMetrics` also reports where the waist figure came from, and every
 * assertion in this file is about the numbers rather than their provenance —
 * the source is covered in body-profile.test.ts. Called with no mask, so the
 * waist here is the joint fallback, which is what these fixtures can support.
 */
const bodyMetrics = (landmarks: Landmark[]): BodyMetrics =>
  computeBodyMetrics(landmarks).metrics;

/** A neutral standing pose in normalised image coordinates. */
function standing(overrides: Partial<Record<number, [number, number]>> = {}): Landmark[] {
  const base: Record<number, [number, number]> = {
    [POSE.nose]: [0.5, 0.12],
    [POSE.leftShoulder]: [0.38, 0.28],
    [POSE.rightShoulder]: [0.62, 0.28],
    [POSE.leftElbow]: [0.34, 0.44],
    [POSE.rightElbow]: [0.66, 0.44],
    [POSE.leftWrist]: [0.32, 0.58],
    [POSE.rightWrist]: [0.68, 0.58],
    [POSE.leftHip]: [0.41, 0.58],
    [POSE.rightHip]: [0.59, 0.58],
    [POSE.leftKnee]: [0.42, 0.78],
    [POSE.rightKnee]: [0.58, 0.78],
    [POSE.leftAnkle]: [0.42, 0.96],
    [POSE.rightAnkle]: [0.58, 0.96],
  };
  const merged = { ...base, ...overrides };
  return Array.from({ length: 33 }, (_, i) => {
    const point = merged[i] ?? [0.5, 0.5];
    return { x: point[0], y: point[1], z: 0, visibility: 0.95 };
  });
}

/** Re-photographs the same pose smaller and off-centre. */
function reframe(landmarks: Landmark[], scale: number, dx: number, dy: number): Landmark[] {
  return landmarks.map((p) => ({
    ...p,
    x: 0.5 + (p.x - 0.5) * scale + dx,
    y: 0.5 + (p.y - 0.5) * scale + dy,
  }));
}

function worstDrift(a: BodyMetrics, b: BodyMetrics) {
  let worst = { key: BODY_METRIC_KEYS[0], delta: 0 };
  for (const key of BODY_METRIC_KEYS) {
    const delta = Math.abs(a[key] - b[key]);
    if (delta > worst.delta) worst = { key, delta };
  }
  return worst;
}

describe('independence from the camera', () => {
  const pose = standing();

  it('gives the same readings at half the distance', () => {
    const drift = worstDrift(bodyMetrics(pose), bodyMetrics(reframe(pose, 2, 0, 0)));
    expect(drift.delta, `${drift.key} moved ${drift.delta.toFixed(1)}`).toBeLessThan(0.5);
  });

  it('gives the same readings when the subject is off-centre', () => {
    const drift = worstDrift(
      bodyMetrics(pose),
      bodyMetrics(reframe(pose, 1, 0.12, -0.08)),
    );
    expect(drift.delta, `${drift.key} moved ${drift.delta.toFixed(1)}`).toBeLessThan(0.5);
  });

  it('produces readings in range for a plausible pose', () => {
    const metrics = bodyMetrics(pose);
    for (const key of BODY_METRIC_KEYS) {
      expect(metrics[key], key).toBeGreaterThanOrEqual(0);
      expect(metrics[key], key).toBeLessThanOrEqual(100);
    }
  });
});

describe('it measures what it says it measures', () => {
  it('scores a level pose better than a tilted one', () => {
    const level = bodyMetrics(standing());
    const tilted = bodyMetrics(
      standing({ [POSE.leftShoulder]: [0.38, 0.24], [POSE.rightShoulder]: [0.62, 0.32] }),
    );
    expect(tilted.shoulderTilt).toBeLessThan(level.shoulderTilt);
  });

  it('scores a forward head worse than a stacked one', () => {
    const stacked = bodyMetrics(standing());
    const forward = bodyMetrics(standing({ [POSE.nose]: [0.62, 0.12] }));
    expect(forward.headForward).toBeLessThan(stacked.headForward);
  });

  it('reads wider shoulders as a higher shoulder-to-hip ratio', () => {
    const narrow = bodyMetrics(standing());
    const broad = bodyMetrics(
      standing({ [POSE.leftShoulder]: [0.32, 0.28], [POSE.rightShoulder]: [0.68, 0.28] }),
    );
    expect(broad.shoulderHipRatio).toBeGreaterThan(narrow.shoulderHipRatio);
  });
});

describe('room to move', () => {
  it('does not saturate on a real landmark-derived ratio', () => {
    /*
     * MediaPipe's hip landmarks are at the joints, not the iliac crest, so the
     * ratio it produces runs higher than the textbook figure. The first real
     * detection measured 1.74; a scale that clips there can never report a
     * change, which is the only thing a proportion metric is good for.
     */
    const wide = bodyMetrics(
      standing({
        [POSE.leftShoulder]: [0.372, 0.39],
        [POSE.rightShoulder]: [0.645, 0.39],
        [POSE.leftHip]: [0.418, 0.8],
        [POSE.rightHip]: [0.575, 0.8],
      }),
    );
    expect(wide.shoulderHipRatio).toBeGreaterThan(2);
    expect(wide.shoulderHipRatio).toBeLessThan(98);
  });
});

describe('honesty about precision', () => {
  it('holds every body floor wider than the widest skin floor', () => {
    // A body is a soft, differently-posed thing photographed from a slightly
    // different spot each time. Claiming body changes at skin precision would
    // be reporting posture as progress.
    const widestSkin = Math.max(...Object.values(METRIC_NOISE_FLOOR));
    for (const key of BODY_METRIC_KEYS) {
      expect(BODY_NOISE_FLOOR[key], key).toBeGreaterThan(widestSkin);
    }
  });

  it('has a floor for every metric', () => {
    for (const key of BODY_METRIC_KEYS) {
      expect(BODY_NOISE_FLOOR[key], key).toBeGreaterThan(0);
    }
  });
});
