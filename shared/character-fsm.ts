/**
 * The character state machine and the sanitiser that guards it.
 *
 * This is shared by the server (which validates what the model produced) and the
 * client (which validates again before touching the rig). Two checks rather than
 * one, because the rule from the brief is absolute: the AI may only select from a
 * closed vocabulary, and an unrecognised value must never reach the renderer.
 */
import {
  CHARACTER_STATES,
  DEFAULT_DIRECTIVE,
  EXPRESSIONS,
  GESTURES,
  type CharacterDirective,
  type CharacterState,
  type Expression,
  type Gesture,
} from './types.ts';

/** Conversational states are freely interchangeable — a conversation moves fast. */
const CONVERSATIONAL: CharacterState[] = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'HAPPY',
  'CONCERNED',
  'EXCITED',
  'CONFUSED',
  'EXPLAINING',
  'GOODBYE',
];

/**
 * Allowed edges. Clinical states are gated: you cannot jump straight from IDLE
 * into ANALYSIS_COMPLETE, because that would let a malformed directive skip the
 * whole analysis and claim a result that was never computed.
 */
export const CHARACTER_TRANSITIONS: Record<CharacterState, CharacterState[]> = {
  IDLE: [...CONVERSATIONAL, 'CLINICAL_ANALYSIS'],
  LISTENING: [...CONVERSATIONAL, 'CLINICAL_ANALYSIS'],
  THINKING: [...CONVERSATIONAL, 'CLINICAL_ANALYSIS'],
  SPEAKING: [...CONVERSATIONAL, 'CLINICAL_ANALYSIS'],
  HAPPY: CONVERSATIONAL,
  CONCERNED: CONVERSATIONAL,
  EXCITED: CONVERSATIONAL,
  CONFUSED: CONVERSATIONAL,
  EXPLAINING: [...CONVERSATIONAL, 'CLINICAL_ANALYSIS'],
  GOODBYE: ['IDLE', 'LISTENING'],
  CLINICAL_ANALYSIS: ['ANALYSIS_COMPLETE', 'CONCERNED', 'IDLE'],
  ANALYSIS_COMPLETE: ['EXPLAINING', 'HAPPY', 'CONCERNED', 'EXCITED', 'IDLE', 'SPEAKING'],
};

/** Cross-fade time in seconds when entering each state. */
export const STATE_BLEND_SECONDS: Record<CharacterState, number> = {
  IDLE: 0.6,
  LISTENING: 0.35,
  THINKING: 0.4,
  SPEAKING: 0.25,
  HAPPY: 0.3,
  CONCERNED: 0.45,
  EXCITED: 0.25,
  CONFUSED: 0.35,
  EXPLAINING: 0.3,
  GOODBYE: 0.5,
  CLINICAL_ANALYSIS: 0.9,
  ANALYSIS_COMPLETE: 0.7,
};

export function canTransition(from: CharacterState, to: CharacterState): boolean {
  if (from === to) return true;
  return CHARACTER_TRANSITIONS[from].includes(to);
}

const STATE_SET = new Set<string>(CHARACTER_STATES);
const EXPRESSION_SET = new Set<string>(EXPRESSIONS);
const GESTURE_SET = new Set<string>(GESTURES);

export interface SanitiseResult {
  directive: CharacterDirective;
  /** Fields that were rejected, for logging. Empty when the input was clean. */
  rejected: string[];
}

/**
 * Coerces anything into a valid directive. Unknown values fall back to the
 * default for that field and are reported — never passed through, never thrown
 * on. A bad directive should degrade the performance, not break the app.
 */
export function sanitiseDirective(input: unknown): SanitiseResult {
  const rejected: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  let state = DEFAULT_DIRECTIVE.state;
  if (typeof raw.state === 'string' && STATE_SET.has(raw.state)) {
    state = raw.state as CharacterState;
  } else if (raw.state !== undefined) {
    rejected.push(`state=${String(raw.state)}`);
  }

  let expression = DEFAULT_DIRECTIVE.expression;
  if (typeof raw.expression === 'string' && EXPRESSION_SET.has(raw.expression)) {
    expression = raw.expression as Expression;
  } else if (raw.expression !== undefined) {
    rejected.push(`expression=${String(raw.expression)}`);
  }

  let gesture = DEFAULT_DIRECTIVE.gesture;
  if (typeof raw.gesture === 'string' && GESTURE_SET.has(raw.gesture)) {
    gesture = raw.gesture as Gesture;
  } else if (raw.gesture !== undefined) {
    rejected.push(`gesture=${String(raw.gesture)}`);
  }

  let intensity = DEFAULT_DIRECTIVE.intensity;
  if (typeof raw.intensity === 'number' && Number.isFinite(raw.intensity)) {
    intensity = Math.min(1, Math.max(0, raw.intensity));
  } else if (raw.intensity !== undefined) {
    rejected.push(`intensity=${String(raw.intensity)}`);
  }

  return { directive: { state, expression, gesture, intensity }, rejected };
}

/**
 * Resolves a target directive against the current state. An illegal edge keeps
 * the current state but still adopts the expression and gesture, so Elohim reacts
 * even when the requested pose was not reachable.
 */
export function resolveDirective(
  current: CharacterState,
  target: CharacterDirective,
): { directive: CharacterDirective; blocked: boolean } {
  if (canTransition(current, target.state)) return { directive: target, blocked: false };
  return { directive: { ...target, state: current }, blocked: true };
}
