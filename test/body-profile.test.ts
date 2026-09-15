/**
 * The two-shot scan: does the side view actually measure an abdomen?
 *
 * This is the file that has to be right. A belly projects forward, so a front
 * camera — which measures width — barely sees one; the whole reason a second
 * capture exists is that the first cannot answer the question people ask of it.
 * If the profile maths is wrong, the app confidently reports a number about the
 * wrong axis and nobody can tell from looking at it.
 *
 * So the fixtures here are silhouettes with known geometry: a torso that tapers
 * from chest to waist, and one that does not. The measurement has to separate
 * them, and it has to refuse the frames it cannot honestly measure.
 */
import { describe, expect, it } from 'vitest';

import { POSE, type Landmark } from '../src/body-analysis/pose.ts';
import { computeBodyMetrics } from '../src/body-analysis/metrics.ts';

import {
  PROFILE_NOISE_FLOOR,
  ProfileRejected,
  checkProfileView,
  measureProfile,
  shoulderSpread,
} from '../src/body-analysis/profile.ts';
import { runAt, widthAt, type Mask } from '../src/body-analysis/silhouette.ts';
import { detectSize } from '../src/body-analysis/pipeline.ts';
import {
  hasBodyIssues,
  selectBodyFindings,
  type BodyReadingInput,
} from '../src/body-analysis/findings.ts';

const W = 320;
const H = 640;

/**
 * Paints a silhouette of known width at every height.
 *
 * `widthAtY` is the full body width in normalised units; `centreAtY` lets a
 * fixture lean, which is the case the torso axis exists to survive.
 */
function buildMask(
  widthAtY: (y: number) => number,
  centreAtY: (y: number) => number = () => 0.5,
  extra: (data: Float32Array) => void = () => {},
): Mask {
  const data = new Float32Array(W * H);
  for (let row = 0; row < H; row++) {
    const y = row / (H - 1);
    const width = widthAtY(y);
    if (width <= 0) continue;
    const centre = centreAtY(y);
    const x0 = Math.max(0, Math.round((centre - width / 2) * (W - 1)));
    const x1 = Math.min(W - 1, Math.round((centre + width / 2) * (W - 1)));
    for (let x = x0; x <= x1; x++) data[row * W + x] = 1;
  }
  extra(data);
  return { data, width: W, height: H };
}

/** A torso seen from the side: chest depth above, belly depth below. */
const sideTorso = (chest: number, belly: number) => (y: number) => {
  if (y < 0.2 || y > 0.95) return 0;
  if (y < 0.4) return chest;
  if (y < 0.44) return chest + (belly - chest) * ((y - 0.4) / 0.04);
  return belly;
};

function landmarks(points: Partial<Record<number, [number, number]>>): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => {
    const point = points[i] ?? [0.5, 0.5];
    return { x: point[0], y: point[1], z: 0, visibility: 0.95 };
  });
}

/** Turned side on, hands on head — the pose the profile reading asks for. */
const sidePose = landmarks({
  [POSE.nose]: [0.56, 0.12],
  [POSE.leftShoulder]: [0.5, 0.28],
  [POSE.rightShoulder]: [0.52, 0.28],
  [POSE.leftWrist]: [0.5, 0.14],
  [POSE.rightWrist]: [0.52, 0.14],
  [POSE.leftHip]: [0.5, 0.58],
  [POSE.rightHip]: [0.51, 0.58],
});

/** Square to the camera, arms down. */
const frontPose = landmarks({
  [POSE.nose]: [0.5, 0.12],
  [POSE.leftShoulder]: [0.38, 0.28],
  [POSE.rightShoulder]: [0.62, 0.28],
  [POSE.leftElbow]: [0.34, 0.44],
  [POSE.rightElbow]: [0.66, 0.44],
  [POSE.leftWrist]: [0.32, 0.58],
  [POSE.rightWrist]: [0.68, 0.58],
  [POSE.leftHip]: [0.41, 0.58],
  [POSE.rightHip]: [0.59, 0.58],
});

describe('reading a silhouette', () => {
  it('measures the width it was painted', () => {
    const mask = buildMask(() => 0.25);
    expect(widthAt(mask, 0.5, 0.5)).toBeCloseTo(0.25, 2);
  });

  it('follows a torso that leans instead of walking off it', () => {
    // Centre drifts from 0.35 at the top to 0.65 at the bottom. A fixed centre
    // line would leave the body entirely and measure nothing.
    const mask = buildMask(
      () => 0.2,
      (y) => 0.35 + 0.3 * y,
    );
    expect(widthAt(mask, 0.8, 0.35 + 0.3 * 0.8)).toBeCloseTo(0.2, 2);
  });

  it('excludes an arm that has air between it and the trunk', () => {
    /*
     * The measurement that matters most and is easiest to get wrong. A waist
     * traced from the leftmost to the rightmost lit pixel is a waist plus two
     * forearms — on this fixture that is 0.46 rather than 0.2, which would read
     * as a completely different body.
     */
    const mask = buildMask(
      () => 0.2,
      () => 0.5,
      (data) => {
        for (let row = 0; row < H; row++) {
          for (let x = 0; x < W; x++) {
            const nx = x / (W - 1);
            if (nx > 0.72 && nx < 0.78) data[row * W + x] = 1;
            if (nx > 0.22 && nx < 0.28) data[row * W + x] = 1;
          }
        }
      },
    );
    expect(runAt(mask, 0.5, 0.5)).toBeCloseTo(0.2, 2);
  });
});

describe('the profile reading separates the thing it exists to separate', () => {
  it('scores a tapered torso better than a protruding one', () => {
    const tapered = measureProfile(buildMask(sideTorso(0.22, 0.18)), sidePose);
    const protruding = measureProfile(buildMask(sideTorso(0.22, 0.28)), sidePose);

    expect(tapered.depthRatio).toBeLessThan(1);
    expect(protruding.depthRatio).toBeGreaterThan(1);
    expect(tapered.metrics.abdominalProfile).toBeGreaterThan(
      protruding.metrics.abdominalProfile,
    );
    // And by enough to survive the noise floor, or it could never be tracked.
    expect(
      tapered.metrics.abdominalProfile - protruding.metrics.abdominalProfile,
    ).toBeGreaterThan(PROFILE_NOISE_FLOOR.abdominalProfile);
  });

  it('does not depend on how far away the camera was', () => {
    /*
     * The claim the whole body pipeline rests on. Both terms of the ratio are
     * lengths in the same photograph, so photographing the same torso smaller
     * has to leave the reading alone.
     */
    const near = measureProfile(buildMask(sideTorso(0.3, 0.36)), sidePose);
    const far = measureProfile(buildMask(sideTorso(0.15, 0.18)), sidePose);
    expect(near.depthRatio).toBeCloseTo(far.depthRatio, 1);
  });

  it('refuses a frame where it cannot tell shoulders from hips', () => {
    const collapsed = landmarks({
      [POSE.leftShoulder]: [0.5, 0.4],
      [POSE.rightShoulder]: [0.52, 0.4],
      [POSE.leftHip]: [0.5, 0.41],
      [POSE.rightHip]: [0.51, 0.41],
    });
    expect(() => measureProfile(buildMask(sideTorso(0.22, 0.22)), collapsed)).toThrow(
      ProfileRejected,
    );
  });
});

describe('a side view has to actually be one', () => {
  it('collapses shoulder spread when a person turns', () => {
    expect(shoulderSpread(frontPose)).toBeGreaterThan(0.6);
    expect(shoulderSpread(sidePose)).toBeLessThan(0.2);
  });

  it('accepts a genuine profile with the arms cleared', () => {
    expect(checkProfileView(sidePose, frontPose)).toEqual({ ok: true });
  });

  it('rejects a second front view sold as a side view', () => {
    /*
     * The failure this check exists for. Two front photographs do not error —
     * they produce a depth ratio that is really a width ratio: a plausible
     * number, stable between scans, and about the wrong axis entirely. The user
     * would track their width against their width and wonder why it never
     * moved.
     */
    const result = checkProfileView(frontPose, frontPose);
    expect(result.ok).toBe(false);
  });

  it('rejects a half turn', () => {
    const angled = landmarks({
      [POSE.leftShoulder]: [0.44, 0.28],
      [POSE.rightShoulder]: [0.56, 0.28],
      [POSE.leftWrist]: [0.44, 0.14],
      [POSE.rightWrist]: [0.56, 0.14],
      [POSE.leftHip]: [0.46, 0.58],
      [POSE.rightHip]: [0.54, 0.58],
    });
    expect(checkProfileView(angled, frontPose).ok).toBe(false);
  });

  it('rejects a side view with an arm hanging over the abdomen', () => {
    // No silhouette can separate a forearm from the belly behind it — the
    // outline genuinely is both. So this is refused rather than measured.
    const armsDown = landmarks({
      [POSE.leftShoulder]: [0.5, 0.28],
      [POSE.rightShoulder]: [0.52, 0.28],
      [POSE.leftWrist]: [0.5, 0.56],
      [POSE.rightWrist]: [0.52, 0.56],
      [POSE.leftHip]: [0.5, 0.58],
      [POSE.rightHip]: [0.51, 0.58],
    });
    const result = checkProfileView(armsDown, frontPose);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('hands on your head');
  });
});

describe('the front waist is traced when it can be', () => {
  /** A front view: chest wide, waist narrower, hips between. */
  const frontTorso = (chest: number, waist: number) => (y: number) => {
    if (y < 0.2 || y > 0.95) return 0;
    if (y < 0.4) return chest;
    if (y < 0.46) return chest + (waist - chest) * ((y - 0.4) / 0.06);
    return waist;
  };

  it('reports a silhouette source when the arms are clear of the trunk', () => {
    const reading = computeBodyMetrics(frontPose, buildMask(frontTorso(0.24, 0.19)));
    expect(reading.waistSource).toBe('silhouette');
  });

  it('falls back to joints when the arms are merged into the outline', () => {
    /*
     * The elbows in `frontPose` are 0.32 apart. An outline 0.34 wide at waist
     * height therefore contains them, and what it describes is a trunk plus two
     * arms. That is not a waist, so the traced route stands down and says so
     * rather than reporting the number anyway.
     */
    const reading = computeBodyMetrics(frontPose, buildMask(frontTorso(0.36, 0.34)));
    expect(reading.waistSource).toBe('joints');
  });

  it('says joints when there is no outline at all', () => {
    expect(computeBodyMetrics(frontPose, null).waistSource).toBe('joints');
  });

  it('separates a tapered waist from a straight one', () => {
    const tapered = computeBodyMetrics(frontPose, buildMask(frontTorso(0.24, 0.18)));
    const straight = computeBodyMetrics(frontPose, buildMask(frontTorso(0.24, 0.235)));
    expect(tapered.metrics.waistRatio).toBeGreaterThan(straight.metrics.waistRatio);
  });
});

describe('what the readout is allowed to say about an abdomen', () => {
  const METRICS = {
    shoulderHipRatio: 70,
    waistRatio: 68,
    shoulderTilt: 88,
    hipTilt: 86,
    headForward: 84,
    postureAlignment: 87,
  };
  const reading = (over: Partial<BodyReadingInput> = {}): BodyReadingInput => ({
    metrics: { ...METRICS },
    waistSource: 'silhouette',
    profile: null,
    ...over,
  });

  it('always reports the profile when one was measured', () => {
    // The user turned sideways to have this taken. It does not compete for a
    // slot with a shoulder tilt they did not ask about.
    const found = selectBodyFindings(reading({ profile: { abdominalProfile: 40 } }), null);
    expect(found[0].key).toBe('abdominalProfile');
    expect(found[0].kind).toBe('tracked');
  });

  it('never calls an abdomen a concern, however it reads', () => {
    const found = selectBodyFindings(reading({ profile: { abdominalProfile: 0 } }), null);
    const profile = found.find((f) => f.key === 'abdominalProfile');
    expect(profile?.kind).not.toBe('concern');
  });

  it('leaves the all-clear reachable on a body with nothing wrong with it', () => {
    /*
     * If a tracked reading counted as an issue, every two-shot scan would have
     * one and the all-clear card could never appear — the app would be unable
     * to tell anyone their posture is fine.
     */
    const found = selectBodyFindings(reading({ profile: { abdominalProfile: 30 } }), null);
    expect(found.length).toBeGreaterThan(0);
    expect(hasBodyIssues(found)).toBe(false);
  });

  it('reports a real change as movement', () => {
    const before = reading({ profile: { abdominalProfile: 30 } });
    const after = reading({
      profile: { abdominalProfile: 30 + PROFILE_NOISE_FLOOR.abdominalProfile + 5 },
    });
    const found = selectBodyFindings(after, before);
    expect(found.find((f) => f.key === 'abdominalProfile')?.kind).toBe('movement');
  });

  it('holds its tongue about a change inside the noise floor', () => {
    // Sagittal abdominal diameter moves a few percent within one day. A floor
    // under that reports digestion as progress.
    const before = reading({ profile: { abdominalProfile: 30 } });
    const after = reading({
      profile: { abdominalProfile: 30 + PROFILE_NOISE_FLOOR.abdominalProfile - 1 },
    });
    const found = selectBodyFindings(after, before);
    expect(found.find((f) => f.key === 'abdominalProfile')?.kind).toBe('tracked');
  });

  it('says nothing about an abdomen it did not photograph', () => {
    const found = selectBodyFindings(reading(), null);
    expect(found.map((f) => f.key)).not.toContain('abdominalProfile');
  });
});

describe('a waist is only ever compared to a waist measured the same way', () => {
  const base = {
    shoulderHipRatio: 70,
    waistRatio: 40,
    shoulderTilt: 88,
    hipTilt: 86,
    headForward: 84,
    postureAlignment: 87,
  };

  it('reports movement between two traced waists', () => {
    const before: BodyReadingInput = {
      metrics: { ...base },
      waistSource: 'silhouette',
      profile: null,
    };
    const after: BodyReadingInput = {
      metrics: { ...base, waistRatio: 70 },
      waistSource: 'silhouette',
      profile: null,
    };
    expect(selectBodyFindings(after, before).map((f) => f.key)).toContain('waistRatio');
  });

  it('refuses to compare a traced waist with an estimated one', () => {
    /*
     * The two differ by far more than any change a person could make, so a
     * trend across them would be reporting a change of method as a change of
     * body — and it would look exactly like progress.
     */
    const before: BodyReadingInput = {
      metrics: { ...base },
      waistSource: 'joints',
      profile: null,
    };
    const after: BodyReadingInput = {
      metrics: { ...base, waistRatio: 70 },
      waistSource: 'silhouette',
      profile: null,
    };
    expect(selectBodyFindings(after, before).map((f) => f.key)).not.toContain('waistRatio');
  });
});

describe('the frame handed to the detector', () => {
  it('always has a width and height divisible by four', () => {
    /*
     * The MediaPipe vision wasm aborts on a frame whose width is not a multiple
     * of four — measured on a real detection: 356x640, 360x640 and 352x632 all
     * work, 357x640 kills the module. A 1536x2752 phone photo scaled to a
     * 640 long edge lands on exactly 357, so this is the difference between
     * body scanning working on real captures and working only on square ones.
     */
    const shapes: [number, number][] = [
      [1536, 2752], // the fixture that found this
      [1080, 1920], // a phone, portrait
      [3024, 4032], // a phone, 3:4
      [4032, 3024],
      [1024, 1024],
      [999, 1777],
      [7, 13], // smaller than the target, so no downscale happens
    ];
    for (const [w, h] of shapes) {
      const size = detectSize(w, h, 640);
      expect(size.width % 4).toBe(0);
      expect(size.height % 4).toBe(0);
      expect(size.width).toBeGreaterThanOrEqual(4);
      expect(size.height).toBeGreaterThanOrEqual(4);
    }
  });

  it('never scales a frame up past the long edge', () => {
    expect(detectSize(1536, 2752, 640).height).toBeLessThanOrEqual(640);
    expect(detectSize(4032, 3024, 640).width).toBeLessThanOrEqual(640);
  });

  it('keeps the aspect ratio within a pixel of the original', () => {
    const size = detectSize(1536, 2752, 640);
    expect(size.width / size.height).toBeCloseTo(1536 / 2752, 2);
  });
});
