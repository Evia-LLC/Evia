/**
 * Context retrieval — the step between "user said something" and "ask the model".
 *
 * Elohim does not get one enormous prompt containing everything. She gets her frozen
 * persona, then a compact block of what is actually relevant to this user right
 * now, then the turn. This file builds the middle part.
 */
import * as users from '../db/users.ts';
import * as scans from '../db/scans.ts';
import * as chat from '../db/chat.ts';
import * as productsRepo from '../db/products.ts';
import { summarise, renderSummary } from '../skin/longitudinal.ts';
import { reviewRoutine } from '../skin/ingredients.ts';
import { buildRoutinePlan, renderPlan } from '../skin/recommend.ts';
import { evaluateRoutine, renderOutcomes } from '../skin/outcomes.ts';
import { pickProducts, renderPicks } from '../catalogue/picks.ts';
import { STYLE_GUIDANCE, LEGAL_DISCLAIMER } from './persona.ts';
import { METRIC_LABELS, type LongitudinalSummary, type SkinAnalysis } from '../../shared/types.ts';
import { BODY_READING_LABELS } from '../../shared/types.ts';
import type { BodySnapshot, ProductPick, ProductUsage, UserSummary } from '../../shared/types.ts';
import type { PregnancyStatus } from '../../shared/types.ts';

export interface ElohimContext {
  user: UserSummary;
  latest: SkinAnalysis | null;
  summary: LongitudinalSummary;
  block: string;
  /** Present only on the turn that follows a body scan. Never persisted. */
  body?: BodySnapshot;
  /** What she can point to on the shelf for the latest scan, if anything. */
  picks?: ProductPick[];
}

/**
 * Appends a body reading to a context that was built from stored skin data.
 *
 * Separate from `buildContext` because the body reading does not come from the
 * database — it arrives with the request, lives for one turn and is discarded.
 * Folding it into the builder would imply a persistence that does not exist.
 */
export function withBody(ctx: ElohimContext, body: BodySnapshot): ElohimContext {
  const lines = body.findings.length
    ? body.findings.map((f) => {
        const label = BODY_READING_LABELS[f.key] ?? f.key;
        const movement =
          f.delta === null
            ? 'first reading'
            : `${f.delta > 0 ? '+' : '−'}${Math.abs(Math.round(f.delta))} since last`;
        return `- ${label}: ${Math.round(f.value)}/100 (${f.kind}, ${movement})`;
      })
    : ['- Nothing stood out. Shoulders, hips and head are level.'];

  const block = [
    '# Body scan just completed',
    'These are the numbers to talk about in this reply. They are NOT skin readings and',
    'must not be mixed with the skin history above.',
    ...lines,
    `Landmark confidence: ${body.confidence.toFixed(2)}.`,
    body.hasProfile
      ? 'A side view was taken, so the abdominal profile is a real measurement of torso ' +
        'depth at the belly against depth at the chest.'
      : 'No side view was taken, so there is NO abdominal reading at all. Do not estimate ' +
        'one, and do not imply you can see their stomach from a front photo — you cannot.',
    'Rules for this reply: every number here is a ratio between body landmarks. You cannot ' +
      'see weight, body fat, BMI or muscle mass in a photograph and must never state or ' +
      'imply one. Proportions such as shoulder-to-hip and abdominal profile have no correct ' +
      'value and are never faults — report them as measurements, and lead with change when ' +
      'there is change. A "tracked" reading is a baseline, not a problem.',
  ].join('\n');

  return { ...ctx, body, block: `${ctx.block}\n\n${block}` };
}

/**
 * What Elohim is told about pregnancy, and what she is told to do about it.
 *
 * The instruction matters as much as the fact. Left to itself the model will
 * answer "is retinol ok?" by asking for the product label, because that is what
 * the ask_product path looks like — and the one thing that must not happen is a
 * retinoid being discussed neutrally with someone who is pregnant.
 *
 * `unknown` gets its own line rather than being omitted, because omission would
 * read as "no relevant condition" and it means the opposite: nobody has asked.
 */
function pregnancyLine(status: PregnancyStatus): string {
  if (status === 'unknown') {
    return (
      'Pregnancy status: NOT KNOWN — they have not been asked, or chose not to say. ' +
      'Do not assume they are not pregnant. If a retinoid or another active that ' +
      'depends on this comes up, say plainly that it is not for use in pregnancy or ' +
      'while breastfeeding and ask whether that applies to them.'
    );
  }
  if (status === 'no') return 'Pregnancy status: not pregnant, not trying, not breastfeeding.';

  const said = { pregnant: 'pregnant', trying: 'trying to conceive', breastfeeding: 'breastfeeding' }[
    status
  ];
  return (
    `Pregnancy status: ${said.toUpperCase()}. Retinoids and retinoid-adjacent actives are ` +
    'off the table entirely — do not suggest one, do not discuss one as an option, and if ' +
    'they ask about one, say directly that it is not appropriate right now and offer the ' +
    'alternative. This overrides anything the readings suggest.'
  );
}

export async function buildContext(userId: string): Promise<ElohimContext> {
  const user = await users.getUserSummary(userId);
  if (!user) throw new Error('unknown user');

  /*
   * Fetched together rather than one after another.
   *
   * None of these depend on each other, and on a serverless function each
   * round trip to the database is a network hop. The message lookup is two
   * chained hops (conversation id, then its newest row), so the whole set
   * costs two hops in parallel instead of five in sequence. The conversation
   * row already exists by the time this runs — both orchestrator entry points
   * resolve it before building context — so the lookup does not create one.
   */
  const [history, usage, memories, lastMessages] = await Promise.all([
    scans.scanHistory(userId, 60),
    productsRepo.listUsage(userId),
    chat.listMemories(userId, 40),
    chat.currentConversation(userId).then((id) => chat.recentMessages(id, 1)),
  ]);
  const summary = summarise(history, usage);
  const latest = history.length ? history[history.length - 1] : null;

  /*
   * When they last spoke. The model has no clock and the transcript carries no
   * dates, so without this line a conversation resumed after three weeks reads
   * to her as three seconds — and she greets a returning user mid-thought.
   * This runs before the current turn is persisted, so the newest stored
   * message is the previous exchange: exactly the gap worth naming.
   */
  const newest = lastMessages[lastMessages.length - 1];
  let lastMessageLine = '';
  if (newest) {
    const elapsed = Date.now() - new Date(newest.createdAt).getTime();
    if (Number.isFinite(elapsed) && elapsed >= 0) {
      const days = Math.floor(elapsed / 86_400_000);
      lastMessageLine =
        days === 0
          ? 'Last message in this conversation: earlier today.'
          : `Last message in this conversation: ${days} day${days === 1 ? '' : 's'} ago.`;
    }
  }

  const sections: string[] = [];

  sections.push(
    [
      '# This user',
      `Name they go by: ${user.displayName}`,
      `Skin type on file: ${user.profile.skinType}`,
      `Stated concerns: ${user.profile.concerns.length ? user.profile.concerns.join(', ') : 'none recorded'}`,
      `Known sensitivities: ${user.profile.sensitivities.length ? user.profile.sensitivities.join(', ') : 'none recorded'}`,
      pregnancyLine(user.profile.pregnancyStatus),
      `Explanation style: ${user.preferences.explanationStyle}`,
      STYLE_GUIDANCE[user.preferences.explanationStyle] ?? '',
      lastMessageLine,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  if (memories.length) {
    sections.push(
      '# What you remember\n' +
        memories.map((m) => `- [${m.kind}] ${m.key}: ${m.value}`).join('\n'),
    );
  } else {
    sections.push('# What you remember\nNothing yet — this is early in your relationship.');
  }

  sections.push('# Skin history\n' + renderSummary(summary));

  /*
   * What the routine actually achieved.
   *
   * Placed after the history and before the plan deliberately: she should know
   * whether the last recommendation worked before she makes the next one, and
   * the block itself tells her to report the failures as plainly as the wins.
   * An assistant that only volunteers its successes is a salesperson.
   */
  const outcomeBlock = renderOutcomes(evaluateRoutine(history, usage));
  if (outcomeBlock) sections.push(outcomeBlock);

  if (latest) {
    const q = latest.quality;
    sections.push(
      [
        '# Most recent scan',
        `Captured: ${latest.capturedAt}`,
        `Confidence: ${(latest.confidence * 100).toFixed(0)}%${
          latest.confidence < 0.6 ? ' — LOW, say so if you cite these numbers' : ''
        }`,
        q?.verdict ? `Capture quality: ${q.verdict}${q.issues?.length ? ` (${q.issues.join('; ')})` : ''}` : '',
        latest.observations?.length ? `Qualitative notes: ${latest.observations.join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const routine = usage.filter((u) => !u.endedAt);
  if (routine.length) {
    sections.push(
      '# Current routine\n' +
        routine
          .map(
            (u) =>
              `- ${u.product.brand ? u.product.brand + ' ' : ''}${u.product.name}` +
              `${u.frequency ? ` (${u.frequency})` : ''}, since ${u.startedAt.slice(0, 10)}` +
              `${u.product.ingredients.length ? ` — key ingredients: ${u.product.ingredients.slice(0, 8).join(', ')}` : ''}`,
          )
          .join('\n') +
        routineNotes(routine),
    );
  }

  // What she would actually suggest. Giving her the plan rather than the raw
  // numbers is what lets her answer "what should I do about it?" without
  // improvising a routine on the spot.
  let picks: ProductPick[] = [];
  if (latest) {
    const plan = buildRoutinePlan(latest.metrics, user.profile, routine, latest.confidence);
    if (plan.suggestions.length) {
      /*
       * The shelf, when there is one.
       *
       * Picks are fetched here rather than left to the model because the
       * model must never invent a product: it may only name what this block
       * names, at the price this block states. Without a shelf the old rule
       * stands and she talks in ingredients.
       */
      picks = await pickProducts(plan, user.profile, { web: false }).catch(() => []);
      sections.push(
        '# What you would suggest\n' +
          renderPlan(plan) +
          (picks.length
            ? '\nRecommend the ingredient and step first; the products you may name are listed below.'
            : '\nRecommend ingredients and steps, never brands - there is no product catalogue ' +
              'behind you, and inventing one would be inventing knowledge you do not have.'),
      );
      const shelf = renderPicks(picks);
      if (shelf) sections.push(shelf);
    }
  }

  sections.push(
    '# Standing rules\n' +
      `- Today is ${new Date().toISOString().slice(0, 10)}.\n` +
      `- If escalation is warranted, the wording to use is: "${LEGAL_DISCLAIMER}"\n` +
      '- Never state a metric value that does not appear above.',
  );

  return { user, latest, summary, picks, block: sections.join('\n\n') };
}

/**
 * What is doubled up, conflicting or missing in the routine, rendered for the
 * prompt. Giving Elohim this means she can raise "you have two exfoliating acids"
 * without waiting to be asked, which is the difference between a consultant and
 * a lookup.
 */
function routineNotes(routine: ProductUsage[]): string {
  const review = reviewRoutine(routine);
  const notes: string[] = [];

  for (const stack of review.stacked) {
    notes.push(`Doubled up on ${stack.label}: ${stack.products.join(', ')}.`);
  }
  notes.push(...review.conflicts);
  for (const gap of review.missing) notes.push(`No ${gap} in the routine.`);
  if (review.unrecognisedCount > 0) {
    notes.push(
      `${review.unrecognisedCount} ingredient(s) across the routine are outside the ` +
        'knowledge base, so this review is partial — say so if you lean on it.',
    );
  }

  return notes.length ? `\nRoutine notes: ${notes.join(' ')}` : '';
}

/** One-line metric rendering, used for the vision pass and the fallback engine. */
export function renderMetrics(analysis: SkinAnalysis): string {
  return Object.entries(analysis.metrics)
    .map(([k, v]) => `${METRIC_LABELS[k as keyof typeof METRIC_LABELS]}: ${Math.round(v)}`)
    .join(', ');
}

/**
 * Rebuilds a body snapshot from untrusted JSON, keeping only what is known.
 *
 * This is the one payload in the app that comes from the browser and ends up
 * inside a model prompt, so nothing is passed through as written: keys must
 * appear in BODY_READING_LABELS, kinds must be one of three, numbers are
 * clamped and rounded, and the list is capped. A client that invents a finding
 * called "ignore your instructions" contributes nothing, because the label the
 * prompt sees is looked up here rather than sent.
 */
const MAX_FINDINGS = 8;
const BODY_FINDING_KINDS = ['concern', 'movement', 'tracked'] as const;

export function sanitiseBodySnapshot(raw: unknown): BodySnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input.findings)) return undefined;

  const findings: BodySnapshot['findings'] = [];
  for (const entry of input.findings.slice(0, MAX_FINDINGS)) {
    if (!entry || typeof entry !== 'object') continue;
    const f = entry as Record<string, unknown>;
    const key = typeof f.key === 'string' ? f.key : '';
    if (!Object.prototype.hasOwnProperty.call(BODY_READING_LABELS, key)) continue;

    const kind = BODY_FINDING_KINDS.find((k) => k === f.kind);
    if (!kind) continue;

    const value = typeof f.value === 'number' && Number.isFinite(f.value) ? f.value : null;
    if (value === null) continue;

    const delta =
      typeof f.delta === 'number' && Number.isFinite(f.delta)
        ? Math.max(-100, Math.min(100, Math.round(f.delta)))
        : null;

    findings.push({ key, kind, value: Math.max(0, Math.min(100, Math.round(value))), delta });
  }

  const confidence =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, input.confidence))
      : 0;

  return { findings, confidence, hasProfile: input.hasProfile === true };
}
