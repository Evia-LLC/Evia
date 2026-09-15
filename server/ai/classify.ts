/**
 * Intent, emotion and escalation detection.
 *
 * This runs *before* context retrieval, so it has to be fast and it has to work
 * when the model is unreachable. It is therefore deterministic by default.
 *
 * Escalation in particular is deliberately not delegated to the model: whether a
 * user just described something that needs a doctor is a safety control, and a
 * safety control that only works when the API is up is not a control.
 */
import type { TurnClassification } from '../../shared/types.ts';
import { classifyTurn } from './claude.ts';
import { log } from '../lib/log.ts';

/** Phrases that should route to a clinician instead of to a score. */
import { classifyLocally } from '../../shared/classify-local.ts';

export { classifyLocally };

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['emotion', 'intent', 'confidence'],
  properties: {
    emotion: {
      type: 'string',
      enum: [
        'happy', 'excited', 'frustrated', 'worried', 'sad',
        'confused', 'curious', 'embarrassed', 'neutral', 'playful',
      ],
    },
    intent: {
      type: 'string',
      enum: [
        'greeting', 'small_talk', 'venting', 'describe_concern', 'ask_question',
        'request_scan', 'request_results', 'request_progress', 'ask_product',
        'update_routine', 'set_preference', 'goodbye', 'other',
      ],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

/**
 * Optional model-backed classification, enabled with ELOHIM_MODEL_CLASSIFIER=1.
 * The deterministic escalation flag is preserved regardless of what it returns.
 *
 * `cloud` is whether this user has consented to their words leaving the
 * server. The classifier prompt carries the message and the last few turns,
 * which is exactly the data the consent is about, so without it this is the
 * local pass and nothing else - the gate on the main model call would
 * otherwise have a side door.
 */
export async function classify(
  message: string,
  recent: string[],
  opts: { cloud?: boolean } = {},
): Promise<TurnClassification> {
  const local = classifyLocally(message);
  if (process.env.ELOHIM_MODEL_CLASSIFIER !== '1') return local;
  if (opts.cloud !== true) return local;

  try {
    const prompt =
      `Classify the emotional state and intent of the final user message in a skincare ` +
      `consultation.\n\nRecent turns:\n${recent.slice(-4).join('\n')}\n\n` +
      `Final user message:\n${message}`;
    const out = await classifyTurn<Omit<TurnClassification, 'escalate' | 'urgent'>>(
      prompt,
      CLASSIFY_SCHEMA,
    );
    // Both safety flags stay local: a control the model can talk its way out of
    // is not a control.
    return { ...out, escalate: local.escalate, urgent: local.urgent };
  } catch (err) {
    log.warn('ai', 'model classifier failed, using local', { error: (err as Error).message });
    return local;
  }
}
