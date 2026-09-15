/**
 * Did the routine actually do anything? (ARCHITECTURE §4)
 *
 * The app already recommends, and it already correlates products with whatever
 * moved while they were in use. What it never did was close the loop: nobody
 * ever went back and asked whether the thing she suggested for a reason
 * achieved the reason it was suggested for.
 *
 * That question is answerable from data already on disk, with no new input from
 * the user:
 *
 *   `RULES` in recommend.ts pairs an ingredient family with the one metric it
 *   is prescribed to move. `ProductUsage` says which product was on the shelf
 *   and between which dates. The scan history says what that metric did over
 *   the same window. `METRIC_NOISE_FLOOR` says whether the change was real.
 *
 * The honesty rules from §4 apply here more than anywhere else in the codebase,
 * because this is where the temptation to flatter is strongest:
 *
 *  1. A move smaller than the metric's noise floor is "no evidence", never a
 *     small win. Below the floor the number is measurement, not skin.
 *  2. A move the wrong way is reported as plainly as a move the right way. An
 *     app that only announces its successes is an advertisement.
 *  3. Too few scans, or too short a window, is "too early" — not a verdict.
 *  4. This is association, not proof, and every statement says so. Nothing here
 *     controls for season, sleep, hormones, or the four other things that
 *     changed in the same six weeks.
 */
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_LABELS,
  METRIC_NOISE_FLOOR,
  type ProductUsage,
  type SkinAnalysis,
  type OutcomeVerdict,
  type RoutineOutcome,
  type SkinMetricKey,
} from '../../shared/types.ts';
import { FAMILY_TARGETS, isUnscoredFamily } from './recommend.ts';
import { matchIngredients } from './ingredients.ts';

const DAY_MS = 86_400_000;

/** How long a product has to have been in use before the question is fair. */
const MIN_DAYS = 14;
/** And how many readings, since one point is not a trend. */
const MIN_SCANS = 2;

export type { OutcomeVerdict, RoutineOutcome };

/**
 * Which metric a product is *for*, via its actives' families.
 *
 * Returns the metric, or why there isn't one — the difference matters. "We do
 * not grade sunscreen on a number" and "we could not read this label" are
 * completely different things to tell someone about their routine.
 */
function targetMetric(
  usage: ProductUsage,
): { metric: SkinMetricKey } | { metric: null; reason: 'not_scored' | 'unrecognised' } {
  const actives = usage.product.ingredients ?? [];
  const { matches } = matchIngredients(actives);
  if (matches.length === 0) return { metric: null, reason: 'unrecognised' };

  // `matches` is ordered by position in the ingredient list, and position is a
  // rough proxy for concentration — so the first recognised active that has a
  // target is the one the product is most plausibly *for*.
  for (const match of matches) {
    const metric = FAMILY_TARGETS[match.rule.family];
    if (metric) return { metric };
  }
  // Recognised, but every active was inert or deliberately ungraded.
  return {
    metric: null,
    reason: matches.some((m) => isUnscoredFamily(m.rule.family)) ? 'not_scored' : 'unrecognised',
  };
}

/**
 * How far before the start date a scan still counts as the baseline.
 *
 * A reading taken the same day a product was started is the "before" — very
 * often it is the reading that *caused* it to be started. Bracketing strictly
 * from the start timestamp made whether it counted a race between two clocks,
 * so the same data could grade as `no_evidence` or `too_early` depending on
 * which millisecond the comparison ran in.
 */
const BASELINE_GRACE_MS = DAY_MS;

function bracket(history: SkinAnalysis[], from: number, to: number): SkinAnalysis[] {
  return history
    .filter((s) => {
      const t = new Date(s.capturedAt).getTime();
      return t >= from && t <= to;
    })
    .sort((a, b) => +new Date(a.capturedAt) - +new Date(b.capturedAt));
}

/**
 * One verdict per product in the routine.
 *
 * `history` may be in any order; only scans sharing the newest scan's model
 * version take part, for the same reason trends never cross versions — the
 * formulas changed, so a step in the line would be a change in the measurement
 * rather than in the skin.
 */
export function evaluateRoutine(
  history: SkinAnalysis[],
  usage: ProductUsage[],
): RoutineOutcome[] {
  if (history.length === 0) return [];
  const newest = [...history].sort(
    (a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt),
  )[0];
  const comparable = history.filter((s) => s.modelVersion === newest.modelVersion);

  const out: RoutineOutcome[] = [];
  for (const use of usage) {
    const start = new Date(use.startedAt).getTime();
    const end = use.endedAt ? new Date(use.endedAt).getTime() : Date.now();
    const days = Math.round((end - start) / DAY_MS);
    const during = bracket(comparable, start - BASELINE_GRACE_MS, end);
    const name = use.product.brand
      ? `${use.product.brand} ${use.product.name}`
      : use.product.name;

    const target = targetMetric(use);
    const metric = target.metric;
    const base = {
      productId: use.product.id,
      productName: name,
      metric,
      metricLabel: metric ? METRIC_LABELS[metric] : null,
      startedAt: use.startedAt,
      daysInUse: days,
      scansDuringUse: during.length,
      valueAtStart: null,
      valueNow: null,
      delta: null,
      noiseFloor: metric ? METRIC_NOISE_FLOOR[metric] : null,
    };

    if (!metric) {
      const reason = (target as { reason: 'not_scored' | 'unrecognised' }).reason;
      out.push({
        ...base,
        verdict: reason,
        statement:
          reason === 'not_scored'
            ? `${name} is not graded on a number here. It was never suggested because ` +
              `a reading was bad, so there is no reading it promised to move — which ` +
              `is not the same as it doing nothing.`
            : `Nothing in ${name}'s ingredient list matched what this app knows, so ` +
              `there is nothing to check it against. That is a gap here, not a ` +
              `judgement on the product.`,
      });
      continue;
    }

    if (during.length < MIN_SCANS || days < MIN_DAYS) {
      out.push({
        ...base,
        verdict: 'too_early',
        statement:
          `Too early to say. ${name} is meant to move ${METRIC_LABELS[metric].toLowerCase()}, ` +
          `and that needs at least ${MIN_DAYS} days and two scans in the window — ` +
          `so far there ${during.length === 1 ? 'is 1 scan' : `are ${during.length} scans`} ` +
          `across ${days} day${days === 1 ? '' : 's'}.`,
      });
      continue;
    }

    const first = during[0].metrics[metric];
    const last = during[during.length - 1].metrics[metric];
    const delta = Math.round((last - first) * 10) / 10;
    const floor = METRIC_NOISE_FLOOR[metric];
    const label = METRIC_LABELS[metric].toLowerCase();
    const magnitude = Math.abs(Math.round(delta));

    const filled = { ...base, valueAtStart: first, valueNow: last, delta, noiseFloor: floor };

    if (Math.abs(delta) < floor) {
      out.push({
        ...filled,
        verdict: 'no_evidence',
        statement:
          `No evidence either way. Across ${days} days on ${name}, ${label} moved ` +
          `${magnitude} point${magnitude === 1 ? '' : 's'} — inside the ${floor}-point ` +
          `range this measurement is noisy to, so it is not a change I can stand behind.`,
      });
      continue;
    }

    const better = METRIC_HIGHER_IS_BETTER[metric] ? delta > 0 : delta < 0;
    out.push({
      ...filled,
      verdict: better ? 'working' : 'wrong_way',
      statement: better
        ? `${label[0].toUpperCase()}${label.slice(1)} improved by ${magnitude} points ` +
          `over ${days} days on ${name} — past the ${floor}-point noise floor. ` +
          `That is association, not proof: other things changed in the same window.`
        : `${label[0].toUpperCase()}${label.slice(1)} went the wrong way by ${magnitude} points ` +
          `over ${days} days on ${name}. Worth questioning whether it earns its place. ` +
          `That is association, not proof — but it is not the direction we wanted.`,
    });
  }

  // Loudest first: things that moved, then things that are still pending.
  const rank: Record<OutcomeVerdict, number> = {
    wrong_way: 0,
    working: 1,
    no_evidence: 2,
    too_early: 3,
    not_scored: 4,
    unrecognised: 5,
  };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict]);
}

/** Compact rendering for the model context block. */
export function renderOutcomes(outcomes: RoutineOutcome[]): string {
  if (outcomes.length === 0) return '';
  const lines = outcomes.map((o) => `- ${o.statement}`);
  return (
    '# Whether the routine is working\n' +
    'Say these plainly, including the ones that did not work.\n' +
    lines.join('\n')
  );
}
