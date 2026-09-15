/**
 * What a side view can say that a front view cannot.
 *
 * A belly projects *forward*. A camera in front of you measures width, which is
 * the one direction abdominal protrusion does not happen in — which is why a
 * front photo can look unremarkable on a body that has plenty of it, and why
 * clinical waist assessment uses a tape or a profile rather than a front-on
 * picture. Everything in this file exists because of that geometry.
 *
 * From the side, the silhouette's horizontal extent is the torso's *depth*,
 * front to back. The reading is one number:
 *
 *     torso depth at the belly  /  torso depth at the chest
 *
 * A ratio again, for the same reason every other body metric is one: it is
 * unchanged by how far away the camera was, what lens it had, or how tall the
 * person is, because both terms scale together. A torso that tapers from chest
 * to waist lands below 1. One that does not lands above it.
 *
 * What this deliberately is not: a body fat percentage, a weight, or a verdict.
 * It is the sagittal proportion of a torso — a thing that can be measured from
 * a photograph and then measured again next month. The number that matters is
 * the second one minus the first.
 */
import { POSE, type Landmark } from './pose.ts';
import { scale } from './metrics.ts';
import { bandWidths, torsoFrame, typical, widest, type Mask } from './silhouette.ts';

/** Bumped whenever a formula here changes. Trends never cross versions. */
export const PROFILE_MODEL_VERSION = 'elohim-profile-1.0.0';

/*
 * Defined in shared/, re-exported here — same reason as the body metric keys:
 * the server validates a stored reading and cannot import from src/.
 */
import { PROFILE_METRIC_KEYS, type ProfileMetricKey } from '@shared/types.ts';
export { PROFILE_METRIC_KEYS, type ProfileMetricKey };
export type ProfileMetrics = Record<ProfileMetricKey, number>;

export const PROFILE_METRIC_LABELS: Record<ProfileMetricKey, string> = {
  abdominalProfile: 'Abdomen',
};

export const PROFILE_HIGHER_IS_BETTER: Record<ProfileMetricKey, boolean> = {
  abdominalProfile: true,
};

/**
 * How much this has to move to be a change rather than a Tuesday.
 *
 * Ten, and the arithmetic is worth writing down. Sagittal abdominal diameter
 * moves about 3-5% within a single day on the same body — a meal, a breath, the
 * hour it is. The scale below spans 0.78 to 1.30, so a 5% swing in the ratio is
 * roughly ten points on it. A tighter floor would report digestion as progress,
 * which is the specific failure this whole app exists to avoid.
 */
export const PROFILE_NOISE_FLOOR: Record<ProfileMetricKey, number> = {
  abdominalProfile: 10,
};

/*
 * Where to measure, as a fraction of the shoulder-to-hip span.
 *
 * The chest band sits just under the armpit, above where the ribcage starts to
 * narrow. The belly band spans navel height down toward the iliac crest, which
 * is where protrusion actually happens — read as the widest point in the band
 * rather than at a fixed height, because the apex sits differently on different
 * bodies and one fixed height would measure above it on some and below it on
 * others.
 */
const CHEST_BAND: readonly [number, number] = [0.1, 0.3];
const BELLY_BAND: readonly [number, number] = [0.55, 0.95];

/** The ratio's useful range: below is a strong taper, above is a full abdomen. */
const RATIO_RANGE: readonly [number, number] = [0.78, 1.3];

export interface ProfileReading {
  metrics: ProfileMetrics;
  /** The unmapped ratio, kept so a calibration study has something to fit. */
  depthRatio: number;
  chestDepth: number;
  bellyDepth: number;
}

/** Thrown when a frame cannot support a profile reading, carrying the reason. */
export class ProfileRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileRejected';
  }
}

function midpoint(a: Landmark, b: Landmark): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * How far apart the shoulders appear, in torso lengths.
 *
 * This is the number that says which way a person is facing. Front on, the
 * shoulders are as far apart as they ever get — around 0.7 to 1.1 torso
 * lengths. Turned side on they project almost onto each other and it collapses.
 * No other single quantity separates the two views as cleanly.
 */
export function shoulderSpread(landmarks: Landmark[]): number {
  const ls = landmarks[POSE.leftShoulder];
  const rs = landmarks[POSE.rightShoulder];
  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(landmarks[POSE.leftHip], landmarks[POSE.rightHip]);
  const torso = Math.max(0.01, Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y));
  return Math.abs(ls.x - rs.x) / torso;
}

/**
 * Above this, the frame is not a side view however it was labelled.
 *
 * The number is an angle in disguise. Apparent shoulder separation falls off
 * with the cosine of how far a person has turned, so on a front-on spread of
 * about 0.8 torso lengths the scale reads:
 *
 *     0.80 = square on      0.57 = 45 degrees      0.30 = 68 degrees
 *     0.69 = 30 degrees     0.40 = 60 degrees      0.21 = 75 degrees
 *
 * 0.30 therefore admits anyone within about 22 degrees of a true profile and
 * turns away the half-turn at 60, which matters because a half-turn does not
 * measure depth — it measures a diagonal through both depth and width, and
 * reports it as depth.
 *
 * Provisional in the same way the metric ranges are: the geometry is sound but
 * the tolerance wants a spread of real captures behind it. Erring tight is the
 * recoverable direction — being asked to turn further costs a retake, while a
 * contaminated reading becomes a trend line.
 */
const MAX_PROFILE_SPREAD = 0.3;
/** And it has to be a clear turn from the front shot, not a slight angle. */
const MAX_RELATIVE_SPREAD = 0.45;

/**
 * Whether the second capture really is a profile, and really is usable.
 *
 * Worth being strict. Two front photos analysed as a front and a side do not
 * fail — they produce a depth ratio that is actually a width ratio, and it
 * looks like a perfectly reasonable number. The user would be tracking their
 * torso's width against their torso's width and wondering why it never moves.
 */
export function checkProfileView(
  side: Landmark[],
  front: Landmark[] | null,
): { ok: true } | { ok: false; reason: string } {
  const spread = shoulderSpread(side);
  if (spread > MAX_PROFILE_SPREAD) {
    return {
      ok: false,
      reason:
        'That is still close to a front view. I need you turned all the way side on, ' +
        'one shoulder toward the camera.',
    };
  }
  if (front && spread > shoulderSpread(front) * MAX_RELATIVE_SPREAD) {
    return {
      ok: false,
      reason: 'You are at an angle rather than fully side on. Turn a quarter turn further.',
    };
  }

  /*
   * Arms up, and checked rather than merely asked for.
   *
   * A hanging arm sits directly over the abdomen in a side view, and no
   * silhouette can separate a forearm from the belly behind it — the outline
   * genuinely is both. Hands on the head clears the torso completely. It also
   * makes the pose repeatable, which matters more here than anywhere else,
   * because this number's entire purpose is comparison against itself later.
   */
  const armsUp =
    side[POSE.leftWrist].y < side[POSE.leftShoulder].y &&
    side[POSE.rightWrist].y < side[POSE.rightShoulder].y;
  if (!armsUp) {
    return {
      ok: false,
      reason:
        'Put both hands on your head for this one — an arm hanging down sits right over ' +
        'the part I need to measure.',
    };
  }

  return { ok: true };
}

/**
 * Measures the torso's depth profile from a side-view mask.
 *
 * Throws rather than returning a low-confidence number. A depth ratio built on
 * rows where the mask found nothing is not a worse measurement of the same
 * thing, it is a measurement of something else.
 */
export function measureProfile(mask: Mask, landmarks: Landmark[]): ProfileReading {
  const shoulderMid = midpoint(landmarks[POSE.leftShoulder], landmarks[POSE.rightShoulder]);
  const hipMid = midpoint(landmarks[POSE.leftHip], landmarks[POSE.rightHip]);

  const frame = torsoFrame(shoulderMid, hipMid);
  if (!frame) {
    throw new ProfileRejected(
      'I cannot tell your shoulders from your hips there. Stand upright and step back a little.',
    );
  }

  const chestRows = bandWidths(mask, frame, CHEST_BAND);
  const bellyRows = bandWidths(mask, frame, BELLY_BAND);

  const chestDepth = typical(chestRows);
  const bellyPeak = widest(bellyRows);
  if (chestDepth === null || bellyPeak === null || chestDepth <= 0) {
    throw new ProfileRejected(
      'I could not trace your outline cleanly. A plainer background behind you should fix it.',
    );
  }

  const depthRatio = bellyPeak.width / chestDepth;
  return {
    metrics: { abdominalProfile: 100 - scale(depthRatio, RATIO_RANGE[0], RATIO_RANGE[1]) },
    depthRatio,
    chestDepth,
    bellyDepth: bellyPeak.width,
  };
}
