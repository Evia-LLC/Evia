/**
 * The Elohim orchestrator (ARCHITECTURE §6).
 *
 * The only module allowed to know about conversation, skin, products and storage
 * at the same time. Everything else stays in its lane and this file wires them:
 *
 *   classify -> retrieve context -> assemble prompt -> model -> validate -> persist
 */
import type Anthropic from '@anthropic-ai/sdk';
import { classify } from './classify.ts';
import { buildContext, withBody, type ElohimContext } from './context.ts';
import { PERSONA, TURN_SCHEMA } from './persona.ts';
import { modelAvailable, structuredTurn, describeApiError } from './claude.ts';
import * as budget from './budget.ts';
import * as fallback from './fallback.ts';
import * as chat from '../db/chat.ts';
import * as users from '../db/users.ts';
import { currentConsent } from '../db/consents.ts';
import { CONSENT_KEYS } from '../../shared/consent-keys.ts';
import { sanitiseDirective } from '../../shared/character-fsm.ts';
import { log } from '../lib/log.ts';
import {
  type BodySnapshot,
  type ElohimAction,
  type ElohimTurn,
  type ExplanationStyle,
  type MemoryWrite,
} from '../../shared/types.ts';

const HISTORY_TURNS = 16;

/**
 * Raised when something tries to reach the model without the user's consent.
 *
 * A thrown error rather than a silent `false` because reaching this means a
 * caller skipped the gate, and the safe outcome of a programming mistake here
 * is a failed request, never a quiet transmission.
 */
class CloudReasoningDenied extends Error {
  constructor() {
    super('cloud reasoning is not consented for this user');
  }
}

/**
 * Whether this user has agreed to their data leaving this server.
 *
 * The context block assembled for a model turn contains their name, stated
 * concerns, sensitivities, every remembered fact and their whole scan history.
 * PrivacyPanel tells them cloud reasoning is off by default, so it has to be
 * off by default *in the code that transmits*, not merely in the copy.
 *
 * Enforced here, on the server, from the stored consent row — never from a
 * flag the client sends, because a privacy control the client can assert is
 * not a control. A missing current decision resolves to false, so a user who has
 * never touched the toggle is off without inventing a withdrawal event.
 */
async function cloudReasoningAllowed(userId: string): Promise<boolean> {
  if (!modelAvailable()) return false;
  const consent = await currentConsent(userId, CONSENT_KEYS.CLOUD_REASONING);
  return consent?.state === 'granted';
}

/**
 * Consent and budget together: the two reasons a turn stays local.
 *
 * Consent is the user's; the budget is the operator's. Both are read fresh
 * on every turn, and a turn that fails either one is answered by the local
 * engine and labelled as such - never refused, never silently downgraded.
 */
async function modelTurnPermitted(userId: string): Promise<boolean> {
  if (!(await cloudReasoningAllowed(userId))) return false;
  const verdict = await budget.allowance(userId);
  if (!verdict.ok) {
    log.warn('orchestrator', 'model turn over budget, using local engine', {
      reason: verdict.reason,
    });
    return false;
  }
  return true;
}

/**
 * Events are things that happen *to* the conversation rather than things the
 * user said. They produce a turn from Elohim without inventing a user message —
 * putting "I just finished the scan" in the transcript as if the user typed it
 * would corrupt the history the model reads on every later turn.
 */
export type ConversationEvent = 'opened' | 'scan_complete' | 'body_scan_complete';

const EVENT_CUES: Record<ConversationEvent, string> = {
  opened:
    'The user just opened the app. Greet them the way you would greet someone you know, ' +
    'in one or two sentences, and leave the door open for them to say what is going on. ' +
    'The context block says when the last message was: acknowledge a gap in time ' +
    'naturally when there is one, and never pretend the conversation is continuous. ' +
    'If memory or the skin history holds an obvious open thread, pick up ONE — not a ' +
    'summary of everything. Do not open with analysis and do not offer a scan yet.',
  scan_complete:
    'The scan just finished and its results are in the context block above as the most ' +
    'recent scan. Tell them what you are seeing, conversationally, leading with whatever ' +
    'actually matters most. Mention at most two or three numbers. Then offer them the ' +
    'choice of a simple, detailed or Gen-Z explanation unless you already know which they ' +
    'prefer.',
  /*
   * A separate cue, because the skin one is actively wrong here.
   *
   * "The scan just finished and its results are in the context block above as
   * the most recent scan" points at the most recent *skin* scan — so a body
   * scan used to make her describe the user's pores. The body block is the last
   * thing in the context and this says so.
   */
  body_scan_complete:
    'A body scan just finished. Its results are in the "Body scan just completed" block at ' +
    'the end of the context, and those are the only readings to talk about in this reply — ' +
    'the skin history above is not what they just did. Lead with whatever actually matters ' +
    'most, mention at most two or three numbers, and follow the rules stated in that block ' +
    'about what a photograph can and cannot tell you about a body.',
};

interface RawTurn {
  text: string;
  directive: unknown;
  memoryWrites?: MemoryWrite[];
  actions?: Array<{ type: string; reason?: string; metric?: string }>;
}

export async function handleTurn(userId: string, message: string): Promise<ElohimTurn> {
  const conversationId = await chat.currentConversation(userId);
  const history = await chat.recentMessages(conversationId, HISTORY_TURNS);

  // Read once per turn, before anything that could transmit. The model call
  // re-reads it as well; this copy is for the steps in front of it.
  const cloud = await cloudReasoningAllowed(userId);

  // 1. Intent + emotion + escalation. Deterministic, always available.
  const classification = await classify(
    message,
    history.map((m) => `${m.role}: ${m.content}`),
    { cloud },
  );
  log.debug('orchestrator', 'classified', classification);

  // 2. Context retrieval.
  const ctx = await buildContext(userId);

  // 3+4. Model, or the labelled local engine.
  let turn: ElohimTurn;
  if (cloud && (await modelTurnPermitted(userId))) {
    try {
      turn = await callModel(userId, message, classification, ctx, history);
    } catch (err) {
      log.error('orchestrator', 'model turn failed, using local engine', {
        error: describeApiError(err),
      });
      turn = fallback.respond(message, classification, ctx, history);
    }
  } else {
    turn = fallback.respond(message, classification, ctx, history);
  }

  // 5. Persist both sides of the exchange.
  await chat.appendMessage(conversationId, {
    role: 'user',
    content: message,
    emotion: classification.emotion,
    intent: classification.intent,
  });
  const stored = await chat.appendMessage(conversationId, {
    role: 'elohim',
    content: turn.text,
    directive: turn.directive,
    demo: turn.demo,
  });

  // 6. Promote durable facts. Preferences are a real setting, not just a memory.
  for (const write of turn.memoryWrites) {
    await chat.upsertMemory(userId, write, stored.id);
    if (write.kind === 'preference' && write.key === 'explanation_style') {
      const style = write.value as ExplanationStyle;
      if (['simple', 'detailed', 'genz', 'adaptive'].includes(style)) {
        await users.updatePreferences(userId, { explanationStyle: style });
      }
    }
  }

  return turn;
}

/**
 * Optional detail that travels with an event.
 *
 * `spokenNarration` is what she already said aloud about a scan — the client
 * can narrate results through the local engine immediately rather than sitting
 * silent through a model round trip. When it is present, the model turn must
 * extend that sentence, not restate it: hearing the same numbers read twice is
 * the fastest way to sound assembled.
 */
export interface EventExtras {
  spokenNarration?: string;
}

/** Produces a turn from an event rather than from a user message. */
export async function handleEvent(
  userId: string,
  event: ConversationEvent,
  body?: BodySnapshot,
  extras?: EventExtras,
): Promise<ElohimTurn> {
  const conversationId = await chat.currentConversation(userId);
  const history = await chat.recentMessages(conversationId, HISTORY_TURNS);
  const base = await buildContext(userId);
  // Body readings are not stored anywhere, so they arrive with the event and
  // are attached for exactly this turn.
  const ctx = body ? withBody(base, body) : base;

  const classification = {
    emotion: 'neutral' as const,
    intent: event === 'opened' ? ('greeting' as const) : ('request_results' as const),
    confidence: 1,
    // A UI event carries no user text, so neither safety flag can be raised
    // by one. These are false because there is nothing to read, not by default.
    escalate: false,
    urgent: false,
  };

  /*
   * The cue, plus the narration when there is one. Clamped and quoted rather
   * than passed through: the extras arrive over the API, and a system message
   * is no place for an unbounded string.
   */
  let cue = EVENT_CUES[event];
  const narration =
    event === 'scan_complete' && typeof extras?.spokenNarration === 'string'
      ? extras.spokenNarration.trim().slice(0, 600)
      : '';
  if (narration) {
    cue +=
      `\n\nShe has already said this aloud about these results, just now: "${narration}" ` +
      '— build on what she said rather than re-reading the same numbers back. Add what ' +
      'it left out, or move to what to do about it.';
  }

  let turn: ElohimTurn;
  if (await modelTurnPermitted(userId)) {
    try {
      turn = await callModel(userId, cue, classification, ctx, history, {
        isEvent: true,
      });
    } catch (err) {
      log.error('orchestrator', 'event turn failed, using local engine', {
        error: describeApiError(err),
      });
      turn = fallback.respondToEvent(event, classification, ctx);
    }
  } else {
    turn = fallback.respondToEvent(event, classification, ctx);
  }

  const stored = await chat.appendMessage(conversationId, {
    role: 'elohim',
    content: turn.text,
    directive: turn.directive,
    demo: turn.demo,
  });
  for (const write of turn.memoryWrites) await chat.upsertMemory(userId, write, stored.id);

  return turn;
}

async function callModel(
  userId: string,
  message: string,
  classification: Awaited<ReturnType<typeof classify>>,
  ctx: ElohimContext,
  history: Awaited<ReturnType<typeof chat.recentMessages>>,
  opts: { isEvent?: boolean } = {},
): Promise<ElohimTurn> {
  /*
   * Checked again, immediately before the data leaves.
   *
   * The callers already gate on this. Re-reading it here means the consent is
   * enforced by the function that does the transmitting rather than by every
   * caller remembering to ask — so a new call site added later is safe by
   * default instead of unsafe by default.
   */
  if (!(await cloudReasoningAllowed(userId))) throw new CloudReasoningDenied();

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }));

  if (opts.isEvent) {
    // A mid-conversation system message carries operator authority without
    // pretending the user said anything. It must follow a user turn, so seed one
    // when the conversation is still empty.
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      messages.push({ role: 'user', content: '(no message — an app event occurred)' });
    }
    messages.push({ role: 'system', content: message } as Anthropic.MessageParam);
  } else {
    // The reading of this turn goes in with the turn itself, not in the cached
    // context block — it changes every message.
    const cue =
      `[turn signals — emotion: ${classification.emotion}, intent: ${classification.intent}` +
      (classification.escalate
        ? ', ESCALATION: the user described something that needs a dermatologist; recommend one rather than analysing'
        : '') +
      ']\n\n';
    messages.push({ role: 'user', content: cue + message });
  }

  const { value, usage } = await structuredTurn<RawTurn>({
    personaPrefix: PERSONA,
    contextBlock: ctx.block,
    messages,
    schema: TURN_SCHEMA,
    maxTokens: 2000,
    effort: classification.escalate ? 'high' : 'medium',
  });

  log.info('orchestrator', 'model turn', {
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    output: usage.output,
  });
  await budget.record(userId, usage);

  const { directive, rejected } = sanitiseDirective(value.directive);
  if (rejected.length) {
    log.warn('orchestrator', 'rejected directive fields', { rejected });
  }

  return {
    text: typeof value.text === 'string' ? value.text.trim() : '',
    directive,
    classification,
    memoryWrites: sanitiseMemoryWrites(value.memoryWrites),
    actions: sanitiseActions(value.actions),
    demo: false,
  };
}

const MEMORY_KINDS = new Set(['skin', 'routine', 'preference', 'product', 'context']);

function sanitiseMemoryWrites(input: unknown): MemoryWrite[] {
  if (!Array.isArray(input)) return [];
  const out: MemoryWrite[] = [];
  for (const raw of input.slice(0, 8)) {
    const w = raw as Partial<MemoryWrite>;
    if (!w || typeof w.key !== 'string' || typeof w.value !== 'string') continue;
    if (!MEMORY_KINDS.has(String(w.kind))) continue;
    if (w.key.length > 64 || w.value.length > 500) continue;
    out.push({
      kind: w.kind as MemoryWrite['kind'],
      key: w.key.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
      value: w.value,
      confidence: typeof w.confidence === 'number' ? Math.min(1, Math.max(0, w.confidence)) : 0.6,
    });
  }
  return out;
}

const ACTION_TYPES = new Set([
  'offer_scan',
  'enter_clinical',
  'show_progress',
  'show_history',
  'ask_explanation_style',
]);

function sanitiseActions(input: unknown): ElohimAction[] {
  if (!Array.isArray(input)) return [];
  const out: ElohimAction[] = [];
  for (const raw of input.slice(0, 3)) {
    const a = raw as { type?: string; reason?: string; metric?: string };
    if (!a?.type || !ACTION_TYPES.has(a.type)) continue;
    if (a.type === 'offer_scan') out.push({ type: 'offer_scan', reason: a.reason ?? '' });
    else if (a.type === 'show_progress')
      out.push({ type: 'show_progress', metric: a.metric as never });
    else out.push({ type: a.type } as ElohimAction);
  }
  return out;
}
