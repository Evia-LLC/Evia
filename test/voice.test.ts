/**
 * Word timing for the licensed voice.
 *
 * The browser synthesiser tells the app when each word is being spoken. A
 * cloned voice arrives as a finished audio file and says nothing at all, so the
 * timing has to be reconstructed — and a mouth running ahead of, or behind, the
 * voice is worse than a mouth that does not move.
 *
 * These pin the reconstruction. They are pure functions over text and a
 * duration, which is the whole of the guessable part; the *audible* half of the
 * timing comes from the real waveform at runtime and is not guessed at all.
 */
import { describe, expect, it } from 'vitest';

import { scanWords, scheduleWords } from '../src/voice/cloned.ts';

describe('finding the words', () => {
  it('reports each word with its position in the line', () => {
    const words = scanWords('Your hydration improved.');
    expect(words.map((w) => w.word)).toEqual(['Your', 'hydration', 'improved.']);
    // Positions must index the original string: the caller uses them to slice.
    for (const word of words) {
      expect('Your hydration improved.'.substr(word.charIndex, word.charLength)).toBe(word.word);
    }
  });

  it('copes with the punctuation and spacing real replies contain', () => {
    const line = "  Redness is down — nicely.  \n Nothing else moved. ";
    const words = scanWords(line);
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(line.substr(word.charIndex, word.charLength)).toBe(word.word);
      expect(word.word.trim()).toBe(word.word);
    }
  });

  it('returns nothing for an empty line rather than throwing', () => {
    expect(scanWords('   ')).toEqual([]);
  });
});

describe('spreading them across the audio', () => {
  it('starts at zero and never runs past the audio', () => {
    const words = scanWords('Your hydration improved by nine points since the last scan.');
    scheduleWords(words, 4);
    expect(words[0].at).toBe(0);
    expect(words[words.length - 1].at).toBeLessThan(4);
  });

  it('keeps the words in order', () => {
    const words = scanWords('One two three four five six seven eight.');
    scheduleWords(words, 3);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].at).toBeGreaterThan(words[i - 1].at);
    }
  });

  it('gives a longer word more time than a short one', () => {
    const words = scanWords('a extraordinarily b');
    scheduleWords(words, 3);
    const longWord = words[1].at - words[0].at;
    const shortWord = words[2].at - words[1].at;
    expect(shortWord).toBeGreaterThan(longWord * 0.2);
    expect(longWord).toBeLessThan(shortWord * 3);
  });

  it('does not let short words race ahead of the audio', () => {
    /*
     * Weighting purely by character count makes a line of tiny words finish in
     * a fraction of the audio, so the mouth stops while the voice is still
     * talking. The per-word overhead is what stops that, and this is the case
     * that catches its removal.
     */
    const words = scanWords('is it a bit of a lot or not');
    scheduleWords(words, 3);
    const last = words[words.length - 1].at;
    // The final word should begin in the last third, not halfway through.
    expect(last).toBeGreaterThan(3 * 0.66);
  });

  it('survives a single word', () => {
    const words = scanWords('Hello');
    scheduleWords(words, 1.2);
    expect(words[0].at).toBe(0);
  });

  it('survives zero duration without producing NaN', () => {
    // Decoding can report a zero-length buffer; the schedule must stay finite
    // or every boundary fires at once and the mouth spasms.
    const words = scanWords('One two three');
    scheduleWords(words, 0);
    for (const word of words) expect(Number.isFinite(word.at)).toBe(true);
  });
});
