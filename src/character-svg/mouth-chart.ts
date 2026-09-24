/**
 * Which drawn mouth each viseme gets.
 *
 * The speech tracks (`character/speech.ts`) emit ten visemes; the SVG figure
 * draws a handful of mouths. This chart is the only place the two meet, and
 * it covers every viseme the tracks can emit - a missing entry would leave
 * the figure with no mouth to draw mid-sentence (`test/honesty.test.ts`
 * checks the coverage).
 *
 * The near neighbours share drawings on purpose. L is said with the jaw a
 * little open and the tongue out of sight, which reads as IH; S is teeth
 * together with the lips spread, which reads as EE. Fewer, clearer shapes held
 * a little longer read as speech; many near-identical ones swapped every few
 * frames read as trembling.
 *
 * Started by Foundation-A so the director and the test have something to
 * point at; the Character agent owns the drawings and may refine the chart,
 * as long as every viseme keeps an entry.
 */
import type { Expression } from '@shared/types.ts';
import type { Viseme } from '@/character/speech.ts';

/** Every mouth the figure draws. `rest` is closed and neutral; `smile` is closed and smiling. */
export const MOUTH_SHAPES = ['rest', 'AA', 'EE', 'IH', 'OH', 'OU', 'MBP', 'FV', 'smile'] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];

export const VISEME_MOUTH: Record<Viseme, MouthShape> = {
  sil: 'rest',
  AA: 'AA',
  EE: 'EE',
  IH: 'IH',
  OH: 'OH',
  OU: 'OU',
  MBP: 'MBP',
  FV: 'FV',
  L: 'IH',
  S: 'EE',
};

/**
 * Below this openness the mouth is drawn closed whatever the viseme says.
 * The tracks ease into and out of every phone, so the tail of each one is a
 * sliver of a shape; drawing it would flicker between a shape and rest.
 */
export const MOUTH_SILENT_BELOW = 0.18;

/** The closed mouth for an expression: a smile for the happy family, rest otherwise. */
export function restingMouth(expression: Expression): MouthShape {
  return expression === 'smile' || expression === 'grin' || expression === 'warm' ? 'smile' : 'rest';
}

/**
 * The mouth to draw right now, from what `director.character` publishes.
 *
 * `mouthOpen` is 0..1 (the track's weight). Silent or nearly closed falls
 * back to the expression's resting mouth.
 */
export function mouthShapeFor(viseme: Viseme, mouthOpen: number, expression: Expression): MouthShape {
  if (viseme === 'sil' || mouthOpen < MOUTH_SILENT_BELOW) return restingMouth(expression);
  return VISEME_MOUTH[viseme];
}
