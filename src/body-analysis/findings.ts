/**
 * What is worth saying about a body reading.
 *
 * Same shape and same discipline as the skin findings: only what is true of
 * this person, nothing to fill a slot, and "nothing to flag" is a real answer.
 *
 * Three rules are specific to the body half.
 *
 * 1. Two of the six metrics — shoulder-to-hip and waist-to-chest — are
 *    *proportions*, and a proportion has no correct value. A narrow build is
 *    not a defect. So those are never reported as concerns; they are reported
 *    only when they change, which is the only thing about them that carries
 *    information. Without this the app tells people their skeleton is the wrong
 *    shape, which is both useless and cruel.
 *
 * 2. The abdominal profile is never a concern either, for the same reason, but
 *    unlike the others it is always shown when it was measured. It is the thing
 *    a two-shot scan was taken to find out, and a reading the user deliberately
 *    turned sideways for should not be silently outranked by a shoulder tilt.
 *
 * 3. A waist may only be compared to a waist measured the same way. The traced
 *    and estimated figures differ by far more than any change a person would be
 *    trying to see, so a scan that had an outline and one that did not must not
 *    produce a trend between them. That guard is the `waistSource` check below.
 */
import {
  BODY_HIGHER_IS_BETTER,
  BODY_METRIC_KEYS,
  BODY_NOISE_FLOOR,
  type BodyMetricKey,
  type BodyMetrics,
  type WaistSource,
} from './metrics.ts';
import {
  PROFILE_HIGHER_IS_BETTER,
  PROFILE_METRIC_KEYS,
  PROFILE_NOISE_FLOOR,
  type ProfileMetricKey,
  type ProfileMetrics,
} from './profile.ts';

/** Metrics that describe build rather than condition. Change only. */
const PROPORTIONS: BodyMetricKey[] = ['shoulderHipRatio', 'waistRatio'];

/** How far the wrong side of good a posture reading has to be to mention. */
const CONCERN_THRESHOLD = 58;

/** At most this many, so the readout is never padded. */
export const BODY_SLOT_COUNT = 6;

/**
 * `tracked` is a measurement being reported because it was taken, not because
 * anything is wrong with it. Nothing else in the app produces one; the profile
 * reading is the only measurement the user asks for by name.
 */
export type BodyFindingKind = 'concern' | 'movement' | 'tracked';

export type AnyBodyMetricKey = BodyMetricKey | ProfileMetricKey;

export interface BodyFinding {
  key: AnyBodyMetricKey;
  kind: BodyFindingKind;
  weight: number;
}

/** The parts of a body reading that findings are drawn from. */
export interface BodyReadingInput {
  metrics: BodyMetrics;
  waistSource: WaistSource;
  /** Null on a front-only scan: no side view, no abdominal depth. */
  profile: ProfileMetrics | null;
}

function goodness(metrics: BodyMetrics, key: BodyMetricKey): number {
  return BODY_HIGHER_IS_BETTER[key] ? metrics[key] : 100 - metrics[key];
}

export function selectBodyFindings(
  current: BodyReadingInput | null,
  previous: BodyReadingInput | null,
): BodyFinding[] {
  if (!current) return [];
  const { metrics } = current;
  const found = new Map<AnyBodyMetricKey, BodyFinding>();

  const offer = (finding: BodyFinding) => {
    const existing = found.get(finding.key);
    if (!existing || finding.weight > existing.weight) found.set(finding.key, finding);
  };

  for (const key of BODY_METRIC_KEYS) {
    // Proportions are reported when they move, never because of their value.
    if (!PROPORTIONS.includes(key)) {
      const good = goodness(metrics, key);
      if (good < CONCERN_THRESHOLD) {
        offer({ key, kind: 'concern', weight: 1 + (CONCERN_THRESHOLD - good) / 100 });
      }
    }

    if (!previous) continue;
    // A traced waist and an estimated one are not the same measurement, and
    // the gap between them dwarfs anything a person could have changed.
    if (key === 'waistRatio' && previous.waistSource !== current.waistSource) continue;

    const delta = metrics[key] - previous.metrics[key];
    if (Math.abs(delta) >= BODY_NOISE_FLOOR[key]) {
      offer({ key, kind: 'movement', weight: 2 + Math.abs(delta) / 100 });
    }
  }

  const ranked = [...found.values()].sort((a, b) => b.weight - a.weight);
  const profile = profileFindings(current, previous);
  // The profile keeps its place rather than competing for one — see rule 2.
  return [...profile, ...ranked].slice(0, BODY_SLOT_COUNT);
}

/**
 * The abdominal reading, when there is one.
 *
 * Always returned if it was measured, and sorted ahead of the posture findings.
 * Reported as movement once there is something to compare it to, because the
 * difference is the useful part — a single depth ratio is a description, two of
 * them a month apart are the answer to the question the scan was taken to ask.
 */
function profileFindings(
  current: BodyReadingInput,
  previous: BodyReadingInput | null,
): BodyFinding[] {
  if (!current.profile) return [];
  const out: BodyFinding[] = [];
  for (const key of PROFILE_METRIC_KEYS) {
    const value = current.profile[key];
    const before = previous?.profile?.[key];
    if (before !== undefined && Math.abs(value - before) >= PROFILE_NOISE_FLOOR[key]) {
      out.push({ key, kind: 'movement', weight: 3 + Math.abs(value - before) / 100 });
    } else {
      out.push({ key, kind: 'tracked', weight: 1.5 });
    }
  }
  return out;
}

/** Whether the reading is a profile measurement rather than a posture one. */
export function isProfileKey(key: AnyBodyMetricKey): key is ProfileMetricKey {
  return (PROFILE_METRIC_KEYS as readonly string[]).includes(key);
}

/** The 0-100 goodness of any body finding, whichever family it belongs to. */
export function findingValue(reading: BodyReadingInput, key: AnyBodyMetricKey): number {
  if (isProfileKey(key)) {
    const value = reading.profile?.[key] ?? 0;
    return PROFILE_HIGHER_IS_BETTER[key] ? value : 100 - value;
  }
  return goodness(reading.metrics, key);
}

/**
 * Whether anything needs attention, as opposed to merely having been measured.
 *
 * `tracked` deliberately does not count. The abdominal reading is present on
 * every two-shot scan, and if it counted here then a body with nothing wrong
 * with it could never reach the all-clear card.
 */
export function hasBodyIssues(findings: BodyFinding[]): boolean {
  return findings.some((f) => f.kind !== 'tracked');
}

/** The whole posture reading on one scale, for the all-clear card. */
export function bodyAverage(metrics: BodyMetrics): number {
  const posture = BODY_METRIC_KEYS.filter((k) => !PROPORTIONS.includes(k));
  return posture.reduce((sum, key) => sum + goodness(metrics, key), 0) / posture.length;
}
