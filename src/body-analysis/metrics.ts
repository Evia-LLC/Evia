/**
 * What a photograph can honestly say about a body.
 *
 * Everything here is a *ratio between joints*. That constraint is the whole
 * design, and it is what separates this from the category it sits in.
 *
 * A single photo cannot give a body fat percentage. It cannot give a weight, a
 * BMI, or a muscle mass. Camera distance, lens, clothing, the angle you happen
 * to be standing at, and whether you breathed in all move those numbers more
 * than a month of training does — so an app that reports them is reporting its
 * own conditions and calling them your body. Several do. This one does not.
 *
 * Ratios survive all of that. Shoulder width divided by hip width is the same
 * number whether you shot it from two metres or three, on a phone or a camera,
 * because both measurements scale together. That is why the metrics below are
 * the ones that exist: not because they are the most impressive things to show,
 * but because they are the ones that are still true when the conditions change.
 *
 * The noise floors are correspondingly wide. A body is a soft, moving,
 * differently-posed thing photographed from a slightly different spot every
 * time, and the honest floors reflect that — see BODY_NOISE_FLOOR.
 */
import { POSE, type Landmark } from './pose.ts';
import { bandWidths, narrowest, torsoFrame, type Mask } from './silhouette.ts';
import { clamp } from '@/lib/math.ts';

/** Bumped whenever a formula below changes. Trends never cross versions. */
export const BODY_MODEL_VERSION = 'elohim-body-2.0.0';

/*
 * Defined in shared/, re-exported here.
 *
 * The server validates a body scan before it is stored and cannot import from
 * src/, so the canonical list lives where both halves can reach it. Everything
 * in this module still imports it from here, which keeps the body vocabulary
 * reading as one thing.
 */
import { BODY_METRIC_KEYS, type BodyMetricKey } from '@shared/types.ts';
export { BODY_METRIC_KEYS, type BodyMetricKey };

export type BodyMetrics = Record<BodyMetricKey, number>;

export const BODY_METRIC_LABELS: Record<BodyMetricKey, string> = {
  shoulderHipRatio: 'Shoulder-to-hip',
  waistRatio: 'Waist width',
  shoulderTilt: 'Shoulder level',
  hipTilt: 'Hip level',
  headForward: 'Head position',
  postureAlignment: 'Vertical alignment',
};

/** Whether a higher number is the better outcome. */
export const BODY_HIGHER_IS_BETTER: Record<BodyMetricKey, boolean> = {
  shoulderHipRatio: true,
  waistRatio: true,
  shoulderTilt: true,
  hipTilt: true,
  headForward: true,
  postureAlignment: true,
};

/**
 * How much a reading has to move before it is a change rather than a re-shoot.
 *
 * Deliberately wider than any of the skin floors. A face scan is a normalised
 * crop of a rigid structure; a body scan is a person standing slightly
 * differently, at a slightly different distance, in different clothes. Until a
 * real repeat-capture study runs (scripts/repeatability.mjs applies here too),
 * these are set generously on the principle that claiming nothing changed is
 * recoverable and claiming a change that was posture is not.
 */
export const BODY_NOISE_FLOOR: Record<BodyMetricKey, number> = {
  /*
   * Ten, not eight.
   *
   * Rotation is what dominates this one: turning fifteen degrees away from the
   * camera narrows apparent shoulder width by about 3%, which is six points on
   * this scale. A floor below that would report standing at a slight angle as a
   * change in build.
   */
  shoulderHipRatio: 10,
  waistRatio: 9,
  shoulderTilt: 10,
  hipTilt: 10,
  headForward: 12,
  postureAlignment: 10,
};

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Landmark, b: Landmark): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Maps a raw ratio onto 0-100 given the range it usefully varies over. */
export function scale(value: number, low: number, high: number): number {
  return clamp((value - low) / (high - low)) * 100;
}

/**
 * Where a waist reading came from.
 *
 * Recorded, never inferred. A waist traced from the body outline and a waist
 * estimated from the joint positions are measurements of two different things
 * that happen to share a name, and the difference between them is far larger
 * than any change a person would be trying to track. So a trend may only ever
 * compare like with like — see the guard in `selectBodyFindings`.
 */
export type WaistSource = 'silhouette' | 'joints';

/** Where the waist actually is, as a fraction of the shoulder-to-hip span. */
const WAIST_BAND: readonly [number, number] = [0.45, 0.9];

/**
 * How close the torso outline may come to the elbows before the arms are in it.
 *
 * If a run measured through the torso reaches nearly as wide as the gap between
 * the elbows, the arms are touching the body and the outline is trunk plus
 * limbs. That is not a waist, and no amount of smoothing makes it one, so this
 * is the point where the silhouette route gives up and says so.
 */
const ARM_MERGE_RATIO = 0.9;

export interface WaistReading {
  ratio: number;
  source: WaistSource;
}

/**
 * The waist, traced from the outline when that is possible.
 *
 * Falls back to the joint estimate rather than failing, because the four
 * posture metrics in this file are perfectly good without a waist and refusing
 * the whole scan over one reading would be a bad trade.
 */
export function measureWaist(landmarks: Landmark[], mask: Mask | null): WaistReading {
  const ls = landmarks[POSE.leftShoulder];
  const rs = landmarks[POSE.rightShoulder];
  const shoulderWidth = distance(ls, rs);
  const hipWidth = distance(landmarks[POSE.leftHip], landmarks[POSE.rightHip]);
  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(landmarks[POSE.leftHip], landmarks[POSE.rightHip]);

  const frame = mask ? torsoFrame(shoulderMid, hipMid) : null;
  if (mask && frame) {
    /*
     * Measured against torso length, not against the silhouette's own chest.
     *
     * The chest reference was tried first and measured on a real detection. It
     * does not work, and the width profile down a standing body says why: from
     * the shoulders to about 40% of the way to the hips the outline *widens*
     * (0.21 to 0.27), because the arms are inside it. They only separate lower
     * down, where they start to angle away. A silhouette "chest" in any pose a
     * person naturally stands in is therefore torso plus two arms, and dividing
     * a clean waist by a contaminated reference produced a ratio of 0.48 —
     * which saturated the scale, and a saturated metric can never show a change.
     *
     * Torso length is immune to all of it. It is the distance between two joint
     * midpoints, so no limb can enter it, and it scales with camera distance
     * exactly as the waist width does — which is the property the whole body
     * pipeline is built on.
     */
    const torsoLength = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);
    const waist = narrowest(bandWidths(mask, frame, WAIST_BAND));
    const elbowSpan = Math.abs(landmarks[POSE.leftElbow].x - landmarks[POSE.rightElbow].x);
    const armsClear = elbowSpan > 0 && waist !== null && waist.width < elbowSpan * ARM_MERGE_RATIO;
    if (waist !== null && torsoLength > 0.01 && armsClear) {
      return { ratio: 1 - waist.width / torsoLength, source: 'silhouette' };
    }
  }

  /*
   * The old estimate, kept only as the fallback it always was.
   *
   * `(shoulderWidth + hipWidth) / 2` is the average of two other measurements
   * and contains no information about an abdomen whatsoever — it cannot detect
   * a change in one, because nothing in it is measured anywhere near one. It
   * stands in when there is no outline to trace, and it is labelled as such.
   */
  const waistWidth = (shoulderWidth + hipWidth) / 2;
  return { ratio: 1 - waistWidth / Math.max(0.01, shoulderWidth), source: 'joints' };
}

/**
 * The 0-100 range each waist source usefully spans.
 *
 * Two entries because they are two measurements. A traced waist over a traced
 * chest sits in a narrower band than the joint estimate does, and mapping both
 * through one range would squash the real one into a corner of the scale where
 * a genuine change could not show.
 */
const WAIST_RANGE: Record<WaistSource, readonly [number, number]> = {
  /*
   * Waist width between 0.35 and 0.85 torso lengths, expressed as taper.
   *
   * Anchored on one real detection, which measured 0.45 torso lengths on a
   * slim figure and lands at 79 on this scale — room above and below, which is
   * the property that matters. Provisional in the same way the shoulder-to-hip
   * range is: it wants a spread of real bodies before it means anything in
   * absolute terms, and it is reported as a position, never as a target.
   */
  silhouette: [0.15, 0.65],
  joints: [-0.15, 0.35],
};

export interface BodyReading {
  metrics: BodyMetrics;
  /** Which method the waist figure came from. Trends may not cross this. */
  waistSource: WaistSource;
}

/**
 * Turns landmarks into the six readings.
 *
 * Every one is normalised by a length measured in the same photograph, so
 * nothing here depends on how far away the camera was.
 *
 * The mask is optional and only the waist uses it — the other five are joint
 * geometry and need no outline.
 */
export function computeBodyMetrics(landmarks: Landmark[], mask: Mask | null = null): BodyReading {
  const ls = landmarks[POSE.leftShoulder];
  const rs = landmarks[POSE.rightShoulder];
  const lh = landmarks[POSE.leftHip];
  const rh = landmarks[POSE.rightHip];
  const nose = landmarks[POSE.nose];

  const shoulderWidth = distance(ls, rs);
  const hipWidth = distance(lh, rh);
  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);
  // Torso length is the reference for everything vertical — it is the longest
  // stable measurement available and it scales with the person, not the lens.
  const torso = Math.max(0.01, Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y));

  /*
   * Shoulder-to-hip. A proportion, not a judgement about size.
   *
   * The range is 1.0 to 2.0, which is wider than the textbook figure and
   * deliberately so. Anthropometry quotes about 1.2-1.6, but that measures the
   * iliac crest; MediaPipe's hip landmarks sit at the hip *joints*, which are
   * narrower, so every landmark-derived ratio runs high. The first real
   * detection measured 1.74 and saturated a scale topping out at 1.65 — and a
   * saturated metric can never show a change, which is the only thing this one
   * is for.
   *
   * Still a provisional range, like the skin calibration: it wants a spread of
   * real bodies before these numbers mean anything absolute. Reported as a
   * position, never as a target — there is no correct value here.
   */
  const shoulderHipRatio = scale(shoulderWidth / Math.max(0.01, hipWidth), 1.0, 2.0);

  /*
   * Waist width, traced from the body outline.
   *
   * No pose landmark is a waist, so this is measured rather than derived: the
   * narrowest point of the silhouette between the ribs and the hips, against
   * the length of the torso. See `measureWaist` — and its fallback, which is
   * the old joint estimate and is labelled as one.
   */
  const waist = measureWaist(landmarks, mask);
  const waistRatio = scale(waist.ratio, ...WAIST_RANGE[waist.source]);

  // Tilt: how level the two sides are, in units of the span between them.
  // 100 is level; the scale is inverted because less tilt is the better result.
  const shoulderTilt = 100 - scale(Math.abs(ls.y - rs.y) / Math.max(0.01, shoulderWidth), 0, 0.28);
  const hipTilt = 100 - scale(Math.abs(lh.y - rh.y) / Math.max(0.01, hipWidth), 0, 0.28);

  /*
   * Head position, forward of the shoulders.
   *
   * Measured horizontally against torso length, which is what makes it a
   * posture reading rather than a function of how tall the person is.
   */
  const headForward = 100 - scale(Math.abs(nose.x - shoulderMid.x) / torso, 0, 0.32);

  // How close the shoulder and hip midpoints are to sitting over each other.
  const postureAlignment = 100 - scale(Math.abs(shoulderMid.x - hipMid.x) / torso, 0, 0.3);

  return {
    metrics: {
      shoulderHipRatio,
      waistRatio,
      shoulderTilt,
      hipTilt,
      headForward,
      postureAlignment,
    },
    waistSource: waist.source,
  };
}
