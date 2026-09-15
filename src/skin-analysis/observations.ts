/**
 * Turning a measurement into something a person can act on.
 *
 * "Pores 49" is not a finding. Forty-nine what — a percentage, a percentile, a
 * comparison with whom? The number is real, and it is the right thing to store
 * and to compare against next month, but as the headline it invites a precision
 * the measurement does not have and a meaning the reader cannot recover.
 *
 * So the readout says what was seen and where, and keeps the number underneath
 * for the trend. Three rules make that honest rather than merely softer:
 *
 *  1. A band, not a score. Four bands wide enough that a few points of drift
 *     cannot move one — which is the same reason the noise floors exist.
 *
 *  2. A pinned scale is its own answer. Every metric is clamped to 0-100, so a
 *     reading at either extreme means the raw signal went past the end of the
 *     calibrated range. That is not "the worst possible skin", it is "outside
 *     what this measurement can describe", and saying so is the only truthful
 *     option. This is what turned a painted illustration into "Oiliness 100".
 *
 *  3. A locus only where one exists. Every metric is measured across a set of
 *     regions, and the per-region statistics carry the same raw signal the
 *     metric is built from — so "most visible across the T-zone" can be derived
 *     rather than written. Where no single per-region field drives the metric,
 *     no location is claimed. `pores` and `acneIndicators` are computed from
 *     whole-image passes with no per-region equivalent, and `evenness` is the
 *     variation *between* regions by construction: none of the three gets a
 *     locus, and inventing one for the sake of a complete-looking sentence
 *     would be the exact failure this file exists to prevent.
 */
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_LABELS,
  type FaceRegionKey,
  type RegionStats,
  type SkinAppearanceMetrics,
  type SkinMetricKey,
} from '@shared/types.ts';
import { METRIC_REGIONS } from './metrics.ts';

export type Severity = 'clear' | 'slight' | 'moderate' | 'marked' | 'beyond-range';

export interface SkinObservation {
  key: SkinMetricKey;
  /** "Oiliness" */
  label: string;
  severity: Severity;
  /** The word shown to the reader. */
  severityLabel: string;
  /** "Most visible across the T-zone." — or null when it is not localised. */
  locus: string | null;
  /** The 0-100 reading. Kept for trends; never the headline. */
  value: number;
}

/**
 * How much attention a reading asks for, regardless of which way it runs.
 *
 * Hydration and evenness are better when high and everything else is better
 * when low, so the bands are defined once against "concern" and each metric is
 * flipped into it.
 */
function concernOf(key: SkinMetricKey, value: number): number {
  return METRIC_HIGHER_IS_BETTER[key] ? 100 - value : value;
}

/**
 * Wide enough that drift cannot move a band.
 *
 * Twenty-five points apart, against noise floors that run from 3 to 8. A
 * reading has to move by more than any measurement error before the word the
 * user reads changes, which is the whole point of using a word.
 */
const BANDS: Array<[number, Severity, string]> = [
  [75, 'marked', 'Marked'],
  [50, 'moderate', 'Moderate'],
  [25, 'slight', 'Slight'],
  [0, 'clear', 'Clear'],
];

/** At or past the end of the calibrated range, in either direction. */
const PINNED = 99.5;

export function severityFor(key: SkinMetricKey, value: number): {
  severity: Severity;
  severityLabel: string;
} {
  const concern = concernOf(key, value);
  if (concern >= PINNED) {
    // Short, because this is the word printed where the number used to be.
    // The sentence that explains it is `EXPLANATION` below.
    return { severity: 'beyond-range', severityLabel: 'Off scale' };
  }
  for (const [floor, severity, severityLabel] of BANDS) {
    if (concern >= floor) return { severity, severityLabel };
  }
  return { severity: 'clear', severityLabel: 'Not detected' };
}

/**
 * Which per-region statistic each metric is actually built from.
 *
 * Only the metrics whose driving signal exists per region appear here. The
 * absent ones are absent on purpose: `pores` and `acneIndicators` come from
 * whole-image passes that have no per-region counterpart, and `evenness` is the
 * spread between regions, so no single region can be "where it is".
 *
 * `direction` says which end of that statistic is the concerning one, because
 * hydration is worse when high-frequency energy is high while under-eye is
 * worse when lightness is low.
 */
const REGION_SIGNAL: Partial<
  Record<SkinMetricKey, { field: keyof RegionStats; concerningEnd: 'high' | 'low' }>
> = {
  oiliness: { field: 'specular', concerningEnd: 'high' },
  texture: { field: 'sigmaL', concerningEnd: 'high' },
  darkSpots: { field: 'darkFraction', concerningEnd: 'high' },
  redness: { field: 'a', concerningEnd: 'high' },
  hydration: { field: 'highFreq', concerningEnd: 'high' },
  underEye: { field: 'L', concerningEnd: 'low' },
};

/** How a region, or a group of them, is said out loud. */
const REGION_PHRASE: Record<FaceRegionKey, string> = {
  forehead: 'across the forehead',
  glabella: 'between the brows',
  nose: 'around the nose',
  cheekLeft: 'on the cheeks',
  cheekRight: 'on the cheeks',
  periorbitalLeft: 'under the eyes',
  periorbitalRight: 'under the eyes',
  perioral: 'around the mouth',
  chin: 'around the chin',
};

const TZONE_SET = new Set<FaceRegionKey>(['forehead', 'glabella', 'nose']);
const CHEEK_SET = new Set<FaceRegionKey>(['cheekLeft', 'cheekRight']);

/**
 * How far above the rest a region has to sit before it is called out.
 *
 * A face is not uniform, so the highest region is always higher than the mean —
 * naming it regardless would produce a confident location for a reading that is
 * actually even. A quarter above the others is the point at which a person
 * looking in a mirror would agree it is concentrated there.
 */
const LOCUS_RATIO = 1.25;

export function locusFor(
  key: SkinMetricKey,
  regions: Partial<Record<FaceRegionKey, RegionStats>>,
): string | null {
  const signal = REGION_SIGNAL[key];
  if (!signal) return null;

  const measured = (METRIC_REGIONS[key] ?? [])
    .map((region) => {
      const stats = regions[region];
      if (!stats || stats.samples <= 0) return null;
      const raw = stats[signal.field];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
      // Flip so a bigger number always means "more concerning here".
      return { region, score: signal.concerningEnd === 'high' ? raw : -raw };
    })
    .filter((entry): entry is { region: FaceRegionKey; score: number } => entry !== null);

  if (measured.length < 2) return null;

  const sorted = [...measured].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const rest = sorted.slice(1);
  const restMean = rest.reduce((sum, r) => sum + r.score, 0) / rest.length;

  // Ratios need a consistent sign; shift both onto the same positive footing.
  const offset = Math.min(0, ...sorted.map((s) => s.score)) * -1 + 0.001;
  if (top.score + offset < (restMean + offset) * LOCUS_RATIO) {
    return 'Fairly even across the face.';
  }

  /*
   * A group beats a single region when the group leads together.
   *
   * "Across the T-zone" is what someone recognises about their own face;
   * "on the glabella" is a word from an anatomy textbook. So if the leading
   * regions are all part of one familiar group, the group is named.
   */
  const leaders = sorted.filter((s) => s.score + offset >= (restMean + offset) * LOCUS_RATIO);
  const leaderSet = new Set(leaders.map((l) => l.region));
  const inTzone = [...leaderSet].filter((r) => TZONE_SET.has(r)).length;
  const inCheeks = [...leaderSet].filter((r) => CHEEK_SET.has(r)).length;

  if (inTzone >= 2 && inTzone === leaderSet.size) return 'Most visible across the T-zone.';
  if (inCheeks === 2 && leaderSet.size === 2) return 'Most visible on the cheeks.';

  return `Most visible ${REGION_PHRASE[top.region]}.`;
}

/**
 * The sentence under each reading when there is no location to give.
 *
 * `beyond-range` needs one most: "Off scale" on its own invites the reading
 * "off the scale bad", which is the opposite of what it means. It means the
 * signal left the range this measurement was calibrated over, and the only
 * honest thing to do with it is decline.
 */
export const EXPLANATION: Partial<Record<Severity, string>> = {
  'beyond-range': 'Past the range I can read from a photo — no number for this one.',
  clear: 'Nothing standing out here.',
};

/** Every metric, described. Order follows the metric list, not severity. */
export function observationsFor(
  metrics: SkinAppearanceMetrics,
  regions: Partial<Record<FaceRegionKey, RegionStats>>,
): SkinObservation[] {
  return (Object.keys(metrics) as SkinMetricKey[]).map((key) => {
    const value = metrics[key];
    const { severity, severityLabel } = severityFor(key, value);
    return {
      key,
      label: METRIC_LABELS[key],
      severity,
      severityLabel,
      // Nothing was detected, so there is nowhere for it to be.
      locus: severity === 'clear' ? null : locusFor(key, regions),
      value,
    };
  });
}
