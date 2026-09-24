import { functionalStorageAllowed } from './cookie-preferences.ts';
/**
 * The first thirty seconds.
 *
 * Someone who has just signed in, or just chosen to look around, knows the
 * name and nothing else. Before the interface asks anything of them she
 * tells them what this is: in her voice, over her room, in five beats and
 * under twenty seconds. Then it gets out of the way and never plays again on
 * that device unless asked for.
 *
 * Built in the app rather than rendered as a video on purpose. A video is a
 * fixed file: it cannot use her real voice once one is configured, cannot be
 * re-timed, cannot follow the design, and costs money to change. This is a
 * dozen lines of copy and a timeline, and it is her.
 *
 * The narrations themselves live in lib/lines.ts with every other scripted
 * line, so the shipped audio for them can never silently go stale.
 */
import type { CharacterDirective } from '@shared/types.ts';
import { INTRO_LINES } from './lines.ts';

const STORAGE_KEY = 'elohim.intro.seen';

export interface IntroBeat {
  /** The words on screen. Captions, not a transcript - they may differ from the voice. */
  title: string;
  /** A quieter second line, or nothing. */
  sub?: string;
  /** What she says over it. Spoken by her voice when there is one. */
  narration: string;
  /** How long the beat holds when no voice is timing it, in seconds. */
  seconds: number;
  /** Small caps that arrive one by one under the title. */
  list?: string[];
  /** How she carries herself while saying it. Applied at beat start. */
  directive?: CharacterDirective;
  /**
   * A breath after the line lands, in seconds, before the next beat starts.
   * The pause is part of the delivery - a promise needs a beat to settle.
   */
  holdAfter?: number;
}

export const INTRO_BEATS: IntroBeat[] = [
  {
    title: 'Elohim',
    sub: 'A beauty consultant who can actually look at your skin.',
    narration: INTRO_LINES[0],
    seconds: 3.2,
    holdAfter: 0.4,
    directive: { state: 'SPEAKING', expression: 'smile', gesture: 'small_wave', intensity: 0.7 },
  },
  {
    title: 'She reads nine things.',
    sub: 'From your own camera, in a few seconds.',
    list: ['hydration', 'texture', 'redness', 'pores', 'tone', 'under-eye', 'dark spots', 'oiliness', 'breakouts'],
    narration: INTRO_LINES[1],
    seconds: 5.2,
    holdAfter: 0.4,
    directive: { state: 'EXPLAINING', expression: 'focused', gesture: 'lean_in', intensity: 0.6 },
  },
  {
    title: 'Measured here.',
    sub: 'On your device. The photo never leaves it unless you say so.',
    narration: INTRO_LINES[2],
    seconds: 4.4,
    holdAfter: 0.4,
    directive: { state: 'EXPLAINING', expression: 'warm', gesture: 'open_palms', intensity: 0.6 },
  },
  {
    title: 'And remembered.',
    sub: 'Next time, she shows you what changed — and what to do about it.',
    narration: INTRO_LINES[3],
    seconds: 4.4,
    // The longest hold in the sequence: this is the promise the product
    // stands on, and rushing off it undersells it.
    holdAfter: 0.9,
    directive: { state: 'SPEAKING', expression: 'warm', gesture: 'slow_nod', intensity: 0.6 },
  },
  {
    title: 'Say hello.',
    narration: INTRO_LINES[4],
    seconds: 2.6,
    directive: { state: 'IDLE', expression: 'smile', gesture: 'nod', intensity: 0.7 },
  },
];

export function introSeen(): boolean {
  try {
    return functionalStorageAllowed() && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markIntroSeen(): void {
  try {
    if (functionalStorageAllowed()) localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Nothing to remember it in; it will play again, which is harmless.
  }
}

/** For the "Play the introduction again" control on the You page. */
export function forgetIntro(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget.
  }
}

/*
 * Whether this session's intro was cut short before she introduced herself.
 *
 * Session-scoped on purpose: her opening line changes when the intro never
 * did its job, and that is a fact about this visit, not about the device.
 * The controller reads it when it raises `opened`.
 */
let skippedThisSession = false;

export function markIntroSkipped(): void {
  skippedThisSession = true;
}

export function introWasSkipped(): boolean {
  return skippedThisSession;
}
