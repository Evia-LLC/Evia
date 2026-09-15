/**
 * What she says as the regions light.
 *
 * The reveal on the hologram lights one region at a time; this writes the
 * line she speaks over it. One short clause per lit region, in the order
 * they light, built from the same observations the cards print - the voice
 * and the readout come from one source and cannot disagree.
 *
 * Deterministic on purpose: the same scan produces the same sentence, so
 * with a cloned voice the line is synthesised once and cached, and every
 * later reveal of that scan is instant. The variants below exist so she does
 * not say the identical sentence about every face - the pick is seeded from
 * the scan itself, never from Math.random, or the cache would miss.
 *
 * The return carries where each clause begins in the speakable text, so the
 * controller can light `clause.key` the moment her voice crosses
 * `clause.charStart`. The strings here are plain - no emoji, no markdown,
 * single spaces - which makes them their own speakable text: the cleaning in
 * voice/tts.ts (strip emoji and markdown, collapse whitespace) leaves them
 * untouched, so the offsets survive it.
 */
import { selectFindings, hasIssues } from '@/holograms/presented.ts';
import { observationsFor, type Severity } from '@/skin-analysis/observations.ts';
import { SCAN_ALL_CLEAR } from '@/lib/lines.ts';
import { METRIC_HIGHER_IS_BETTER, METRIC_NOISE_FLOOR, type SkinAnalysis, type SkinMetricKey } from '@shared/types.ts';

export type ScanSentiment = 'improving' | 'declining' | 'steady';

export interface ScanNarration {
  /** The whole line, ready to speak. */
  text: string;
  /** Each region clause, and where it starts in the speakable text. */
  clauses: Array<{ key: SkinMetricKey; charStart: number }>;
}

/** The region words, for the clauses that speak about a metric by name. */
const SUBJECT: Record<string, { word: string; plural: boolean }> = {
  hydration: { word: 'hydration', plural: false },
  oiliness: { word: 'the T-zone', plural: false },
  redness: { word: 'the cheeks', plural: true },
  texture: { word: 'texture', plural: false },
  pores: { word: 'pores', plural: true },
  darkSpots: { word: 'the dark spots', plural: true },
  evenness: { word: 'tone', plural: false },
  underEye: { word: 'the under-eyes', plural: true },
  acneIndicators: { word: 'breakout signs', plural: true },
};

/**
 * Spoken clauses per metric, per band. Two or three each, all verb phrases
 * with contractions - things a person says while pointing, not card labels.
 */
const CLAUSES: Record<string, Record<'slight' | 'moderate' | 'marked', string[]>> = {
  hydration: {
    slight: ["hydration's running a touch low today", 'hydration is sitting a little low'],
    moderate: ['hydration is running low today', "your skin's reading on the dry side"],
    marked: ['hydration is running properly low today', 'your skin is reading dry — genuinely dry'],
  },
  oiliness: {
    slight: ["there's a little shine coming through the T-zone", 'the T-zone is showing a touch of oil'],
    moderate: ['the T-zone is running oily today', "there's a fair amount of shine through the T-zone"],
    marked: ['the T-zone is properly oily today', "there's a lot of shine coming off the T-zone"],
  },
  redness: {
    slight: ["there's a little redness through the cheeks", 'the cheeks are carrying a touch of redness'],
    moderate: ["there's a fair bit of redness through the cheeks", 'the cheeks are running warm today'],
    marked: ["there's real redness through the cheeks", 'the cheeks are running hot today'],
  },
  texture: {
    slight: ["texture's a little uneven", 'texture is showing just a touch'],
    moderate: ["texture is rougher than I'd like", "there's some unevenness in the texture"],
    marked: ['texture is properly uneven today', 'the texture is asking for some attention'],
  },
  pores: {
    slight: ['pores are showing a little', 'pores are just visible'],
    moderate: ['pores are more visible than usual', "pores are showing more than I'd like"],
    marked: ['pores are very visible today', 'pores are asking for attention'],
  },
  darkSpots: {
    slight: ['dark spots are showing faintly', "there's a hint of dark spots"],
    moderate: ['dark spots are showing through', 'the dark spots are more visible today'],
    marked: ['dark spots are standing out today', 'the dark spots are hard to miss today'],
  },
  evenness: {
    slight: ["tone's a touch uneven", 'tone is close to even, not quite there'],
    moderate: ['tone is running uneven today', "there's some patchiness in your tone"],
    marked: ['tone is properly uneven today', "your tone is patchier than I'd like"],
  },
  underEye: {
    slight: ["there's a little shadow under the eyes", 'the under-eyes are a touch dark'],
    moderate: ["there's noticeable shadow under the eyes", 'the under-eyes are running dark today'],
    marked: ['the under-eyes are properly dark today', "there's deep shadow under the eyes"],
  },
  acneIndicators: {
    slight: ['there are faint breakout signs', 'breakout signs are just showing'],
    moderate: ['there are some breakout signs coming through', 'breakout signs are showing today'],
    marked: ['breakout signs are properly active today', "there's a real breakout brewing"],
  },
};

/** How a worsening delta is said, where "more" reads wrong. */
const WORSE_WORD: Partial<Record<string, string>> = {
  hydration: 'lower',
  evenness: 'less even',
  underEye: 'darker',
  texture: 'rougher',
};

/** How she opens the reveal. Picked once per scan. */
const LEAD_INS = [
  "Alright — here's what I'm seeing.",
  "Right — here's what I found.",
  "Okay — here's how it reads today.",
];

/**
 * A small stable hash, so a scan always picks the same variants.
 * `capturedAt` is the scan's identity on both a stored and a guest reading.
 */
function seedOf(stamp: string, key: string): number {
  const s = `${stamp}|${key}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const pick = (variants: readonly string[], seed: number) => variants[seed % variants.length];

function clauseFor(
  key: SkinMetricKey,
  severity: Severity | 'noted',
  seed: number,
  hasPrevious: boolean,
  significant: boolean,
): string {
  const subject = SUBJECT[key] ?? { word: key, plural: false };
  const be = subject.plural ? 'are' : 'is';

  if (severity === 'beyond-range') {
    return pick(
      [`${subject.word} went past what I can read from a photo`, `${subject.word} ${be} off the top of my scale`],
      seed,
    );
  }
  if (severity === 'clear') {
    return pick([`${subject.word} ${be} reading clear`, `nothing showing on ${subject.word}`], seed);
  }
  if (severity === 'noted' || !CLAUSES[key]) {
    // The old fallback band said "noted", which is a stamp, not a sentence.
    return pick([`${subject.word} ${be} worth watching`, `${subject.word} ${be} one to watch`], seed);
  }

  const band = severity === 'slight' || severity === 'moderate' || severity === 'marked' ? severity : 'slight';
  const variants = [...CLAUSES[key][band]];
  // A mild reading that has a history and did not move gets the steadiest
  // phrasing available - the news is precisely that there is none.
  if (band === 'slight' && hasPrevious && !significant) {
    variants.push(`${subject.word} ${be} holding steady`);
  }
  return pick(variants, seed);
}

export function narrationFor(
  analysis: SkinAnalysis,
  previous: SkinAnalysis | null,
): ScanNarration | null {
  const findings = selectFindings(analysis, previous);
  if (!findings.length) return null;
  if (!hasIssues(findings)) return { text: SCAN_ALL_CLEAR, clauses: [] };

  const observations = observationsFor(analysis.metrics, analysis.regions ?? {});
  const parts: Array<{ key: SkinMetricKey; clause: string }> = [];

  for (const finding of findings) {
    if (finding.kind === 'strength') continue;
    const key = finding.key;
    const observed = observations.find((o) => o.key === key);
    const value = analysis.metrics[key];
    const prev = previous?.metrics[key];
    const delta = prev === undefined ? null : value - prev;
    const significant = delta !== null && Math.abs(delta) >= METRIC_NOISE_FLOOR[key];
    const better = delta !== null && (METRIC_HIGHER_IS_BETTER[key] ? delta > 0 : delta < 0);
    const seed = seedOf(analysis.capturedAt, key);

    let clause = clauseFor(key, observed?.severity ?? 'noted', seed, previous !== null, significant);
    if (significant) {
      // The delta as a natural comparative, hung off the end of the clause.
      const tail = better
        ? pick(['better than last time', 'an improvement on last time'], seed >> 3)
        : `${WORSE_WORD[key] ?? 'more'} than last time`;
      clause = `${clause} — ${tail}`;
    }
    parts.push({ key, clause });
    if (parts.length >= 5) break;
  }

  if (!parts.length) return null;

  // Commas between clauses, an "and" before the last, one full stop.
  let text = `${pick(LEAD_INS, seedOf(analysis.capturedAt, 'lead'))} `;
  const clauses: ScanNarration['clauses'] = [];
  parts.forEach((part, i) => {
    if (i > 0) text += i === parts.length - 1 ? ', and ' : ', ';
    const rendered = i === 0 ? part.clause.charAt(0).toUpperCase() + part.clause.slice(1) : part.clause;
    clauses.push({ key: part.key, charStart: text.length });
    text += rendered;
  });
  text += '.';

  return { text, clauses };
}

/**
 * Which way the scan moved, net, for the staging to colour.
 *
 * Counted over the findings that actually cleared a noise floor - the same
 * movements the cards call out - so the mood of the room and the words on the
 * cards can never point in opposite directions.
 */
export function scanSentiment(analysis: SkinAnalysis, previous: SkinAnalysis | null): ScanSentiment {
  if (!previous) return 'steady';
  let net = 0;
  for (const finding of selectFindings(analysis, previous)) {
    if (finding.kind !== 'movement') continue;
    const delta = analysis.metrics[finding.key] - previous.metrics[finding.key];
    net += (METRIC_HIGHER_IS_BETTER[finding.key] ? delta > 0 : delta < 0) ? 1 : -1;
  }
  return net > 0 ? 'improving' : net < 0 ? 'declining' : 'steady';
}
