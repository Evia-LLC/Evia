/**
 * Which metrics get a slot in the holographic display.
 *
 * Deliberately a separate module from `rig.ts`: the rig pulls in three.js and is
 * lazy-loaded with the clinical environment, while this is needed by the
 * controller on the ordinary path. Importing it from `rig.ts` would statically
 * pull the whole hologram bundle — and three with it — back into the initial
 * chunk, silently undoing the code splitting in ARCHITECTURE §9.
 *
 * Nothing in this file may import three.
 */
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_NOISE_FLOOR,
  SKIN_METRIC_KEYS,
  type SkinAnalysis,
  type SkinMetricKey,
} from '@shared/types.ts';

/**
 * At most six. Elohim is the interpreter; the holograms are her whiteboard, and a
 * whiteboard with every number on it communicates nothing.
 *
 * At *most* — not exactly. A whiteboard that always has six things on it is
 * also communicating nothing, because the sixth is only there to fill a slot.
 */
export const SLOT_COUNT = 6;

/**
 * How far from good a reading has to be before it is worth saying out loud.
 *
 * On the 0-100 scale every metric is normalised onto, where 100 is the good
 * end. 62 is deliberately not the midpoint: a reading a little the wrong side
 * of average is the normal condition of normal skin, and flagging it is how an
 * app teaches people to find fault with a face that is fine.
 */
const CONCERN_THRESHOLD = 62;

/** How good a reading has to be before it is worth saying so. */
const STRENGTH_THRESHOLD = 78;

/**
 * How many strengths are worth mentioning.
 *
 * Capped, because six of them is the same failure as six concerns: a display
 * that is always full is describing its own layout. Two is enough to tell
 * someone what is going well without turning the readout into a compliment.
 */
const MAX_STRENGTHS = 2;

/** How good a reading has to be, on its own scale, whichever way it runs. */
function goodness(analysis: SkinAnalysis, key: SkinMetricKey): number {
  const value = analysis.metrics[key];
  return METRIC_HIGHER_IS_BETTER[key] ? value : 100 - value;
}

/**
 * The whole face on one 0-100 scale, where 100 is good.
 *
 * Only used when nothing was flagged, to give the all-clear card a number to
 * show. It is deliberately not offered as a headline score the rest of the
 * time: averaging nine separate measurements into one figure is exactly the
 * kind of tidy, meaningless number this app is trying not to produce.
 */
export function averageGoodness(analysis: SkinAnalysis): number {
  const total = SKIN_METRIC_KEYS.reduce((sum, key) => sum + goodness(analysis, key), 0);
  return total / SKIN_METRIC_KEYS.length;
}

export type FindingKind = 'concern' | 'movement' | 'strength';

export interface Finding {
  key: SkinMetricKey;
  kind: FindingKind;
  /** Higher sorts earlier. Comparable across kinds. */
  weight: number;
}

/**
 * What is actually worth saying about this scan.
 *
 * The old version pinned hydration, redness and texture in place whoever you
 * were and filled the rest from a default list, so a person with clear skin was
 * still shown "Breakout signs 22" as though 22 were a finding. That is a
 * template wearing the costume of a diagnosis: it looks like a reading, it is
 * identical for everyone, and its only real content is that the app has six
 * slots.
 *
 * This returns only what is true of *this* face, in three flavours:
 *
 *   concern    a reading far enough the wrong side of good to mention
 *   movement   a change since last time that cleared the noise floor
 *   strength   a reading good enough to be worth telling someone about
 *
 * and if none of those apply it returns nothing, which is a real and reportable
 * result. "I looked and there is nothing to flag" is a better thing for a skin
 * app to be able to say than most of what it usually says.
 */
export function selectFindings(
  analysis: SkinAnalysis | null,
  previous: SkinAnalysis | null,
): Finding[] {
  if (!analysis) return [];
  const found = new Map<SkinMetricKey, Finding>();

  const offer = (finding: Finding) => {
    const existing = found.get(finding.key);
    // One row per metric: a metric that both moved and reads badly is a single
    // thing to talk about, ranked by whichever fact is louder.
    if (!existing || finding.weight > existing.weight) found.set(finding.key, finding);
  };

  for (const key of SKIN_METRIC_KEYS) {
    const good = goodness(analysis, key);

    if (good < CONCERN_THRESHOLD) {
      // Weighted by how far past the threshold, so the worst reading leads.
      offer({ key, kind: 'concern', weight: 1 + (CONCERN_THRESHOLD - good) / 100 });
    } else if (good >= STRENGTH_THRESHOLD) {
      offer({ key, kind: 'strength', weight: (good - STRENGTH_THRESHOLD) / 200 });
    }

    if (previous) {
      const delta = analysis.metrics[key] - previous.metrics[key];
      if (Math.abs(delta) >= METRIC_NOISE_FLOOR[key]) {
        // Movement outranks a static reading: a number that changed is news,
        // and a number that has always been where it is mostly is not.
        offer({
          key,
          kind: 'movement',
          weight: 2 + Math.abs(delta) / 100,
        });
      }
    }
  }

  const ranked = [...found.values()].sort((a, b) => b.weight - a.weight);

  // Concerns and movements first, then at most two strengths behind them.
  const issues = ranked.filter((f) => f.kind !== 'strength');
  const strengths = ranked.filter((f) => f.kind === 'strength').slice(0, MAX_STRENGTHS);
  return [...issues, ...strengths].slice(0, SLOT_COUNT);
}

/**
 * Whether this scan found anything that needs attention.
 *
 * A face with only strengths on it is a clear face — the display says so and
 * shows what is going well, rather than leading with "Dark spots 18" as though
 * an excellent reading were a finding.
 */
export function hasIssues(findings: Finding[]): boolean {
  return findings.some((f) => f.kind !== 'strength');
}

/**
 * Which metrics get a slot.
 *
 * Kept as a thin wrapper over `selectFindings` because the rig, the layout
 * solver and the model context all want the plain list. It can legitimately
 * come back empty, and everything downstream has to cope with that rather than
 * assume six.
 */
export function selectPresented(
  analysis: SkinAnalysis | null,
  previous: SkinAnalysis | null,
): SkinMetricKey[] {
  return selectFindings(analysis, previous).map((f) => f.key);
}

/** The metric the trend line under the face model plots, when there is one. */
export const HEADLINE_METRIC: SkinMetricKey = 'hydration';

/** What the headline slot says about itself. */
export interface Headline {
  key: SkinMetricKey;
  /** Why this one is at the top — drawn as the card's eyebrow. */
  eyebrow: string;
  /** One line of plain language under the bar. */
  note: string;
}

/**
 * Picks which of the presented metrics leads.
 *
 * The selection above returns the core three first, so the top slot was always
 * hydration no matter what the scan actually found — a display whose most
 * prominent element is fixed in advance is a template, not a reading. This asks
 * the scan instead: the biggest real movement leads; failing that, the reading
 * furthest from where it should be; failing that, the first reading taken.
 */
export function headlineOf(
  chosen: SkinMetricKey[],
  analysis: SkinAnalysis,
  previous: SkinAnalysis | null,
): Headline | null {
  // Nothing was found, so there is no headline. The caller says so plainly
  // rather than picking a metric at random to fill the biggest card.
  if (chosen.length === 0) return null;
  if (previous) {
    const movers = chosen
      .map((key) => {
        const delta = analysis.metrics[key] - previous.metrics[key];
        const better = METRIC_HIGHER_IS_BETTER[key] ? delta > 0 : delta < 0;
        return { key, magnitude: Math.abs(delta), better };
      })
      .filter((m) => m.magnitude >= METRIC_NOISE_FLOOR[m.key])
      .sort((a, b) => b.magnitude - a.magnitude);

    const lead = movers[0];
    if (lead) {
      return {
        key: lead.key,
        eyebrow: lead.better ? 'biggest gain' : 'biggest change',
        // Short on purpose: the card is 40cm wide in world space and this
        // line has about forty characters before it starts being trimmed.
        note: lead.better ? 'Your largest gain this scan.' : 'Your largest move this scan.',
      };
    }
  }

  // Nothing moved past the noise floor, so lead with whatever is furthest from
  // a good result — the thing worth talking about when nothing has changed.
  const worst = [...chosen].sort((a, b) => score(analysis, a) - score(analysis, b))[0];
  return {
    key: worst,
    eyebrow: previous ? 'most worth watching' : 'first reading',
    note: previous
      ? 'Nothing moved past the noise floor.'
      : 'First scan — nothing to compare yet.',
  };
}

/** How good a reading is, on one scale, whichever direction the metric runs. */
function score(analysis: SkinAnalysis, key: SkinMetricKey): number {
  const value = analysis.metrics[key];
  return METRIC_HIGHER_IS_BETTER[key] ? value : 100 - value;
}
