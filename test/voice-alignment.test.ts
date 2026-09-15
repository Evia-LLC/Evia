/**
 * Word timings from a character alignment.
 *
 * The voice provider aligns every character of the line; her mouth needs one
 * start time per word. The reduction is simple and the failure modes are not:
 * a word that starts on the wrong character index moves every later viseme,
 * and a provider that normalises the text shifts every index at once.
 */
import { describe, expect, it } from 'vitest';
import { wordsFromAlignment } from '../server/voice/tts.ts';

function alignmentOf(text: string, secondsPerChar = 0.05) {
  const characters = text.split('');
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * secondsPerChar),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * secondsPerChar),
  };
}

describe('wordsFromAlignment', () => {
  it('starts each word at its first character and ends it at its last', () => {
    const text = 'Hi there, Ada.';
    const words = wordsFromAlignment(text, alignmentOf(text));
    expect(words.map((w) => w.word)).toEqual(['Hi', 'there,', 'Ada.']);
    expect(words[0]).toMatchObject({ charIndex: 0, charLength: 2, start: 0 });
    expect(words[1]).toMatchObject({ charIndex: 3, charLength: 6 });
    expect(words[1].start).toBeCloseTo(0.15);
    expect(words[2].end).toBeCloseTo(0.7);
  });

  it('skips runs of whitespace without inventing words', () => {
    const text = 'One   two\n three';
    const words = wordsFromAlignment(text, alignmentOf(text));
    expect(words.map((w) => w.word)).toEqual(['One', 'two', 'three']);
    expect(words[2].charIndex).toBe(text.indexOf('three'));
  });

  it('falls back to the text\'s own positions when the provider normalised the characters', () => {
    const text = 'Read 9 things.';
    // The provider spelled the number out: indices in its stream no longer match ours.
    const spoken = 'Read nine things.';
    const words = wordsFromAlignment(text, alignmentOf(spoken));
    expect(words.map((w) => w.word)).toEqual(['Read', '9', 'things.']);
    expect(words[1].charIndex).toBe(5);
    expect(words[2].charIndex).toBe(7);
    // Timings still come from the alignment, in order.
    expect(words[1].start).toBeGreaterThan(words[0].start);
    expect(words[2].start).toBeGreaterThan(words[1].start);
  });

  it('returns nothing for an empty line', () => {
    expect(wordsFromAlignment('', alignmentOf(''))).toEqual([]);
  });
});
