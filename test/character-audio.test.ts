import { describe, expect, it } from 'vitest';
import { AudioLockedSpeechTrack, EstimatedSpeechTrack, MutedSpeechTrack } from '../src/character/speech.ts';

const SILENT = { viseme: 'sil', weight: 0, level: 0 };

describe('audio authority over character motion', () => {
  it('reports exact silence during a real pause, even inside an estimated vowel', () => {
    const track = new AudioLockedSpeechTrack();
    track.beginWord('Beautiful', 0);
    track.setLevel(0.8);
    expect(track.advance(0.03).level).toBe(0.8);
    track.setLevel(0);
    expect(track.advance(0.03)).toEqual(SILENT);
    expect(track.advance(0.15)).toEqual(SILENT);
    expect(track.consumePhrase()).toBe(true);
    expect(track.consumePhrase()).toBe(false);
  });

  it('remains silent after the word estimate expires and resumes only with audio', () => {
    const track = new AudioLockedSpeechTrack();
    track.beginWord('Hi', 0);
    track.setLevel(0);
    expect(track.advance(2)).toEqual(SILENT);
    track.beginWord('Hello', 2);
    track.setLevel(0.4);
    const resumed = track.advance(0.02);
    expect(resumed.level).toBe(0.4);
    expect(resumed.weight).toBeGreaterThan(0);
  });

  it('cannot reopen after end or cancellation, even if a late level arrives', () => {
    const track = new AudioLockedSpeechTrack();
    track.beginWord('Welcome', 0);
    track.setLevel(0.7);
    track.advance(0.04);
    track.end();
    track.setLevel(0.9);
    expect(track.advance(0.01)).toEqual(SILENT);
    expect(track.finished).toBe(true);
  });

  it('treats an invalid measured level as silence rather than poisoning the rig', () => {
    const track = new AudioLockedSpeechTrack();
    track.beginWord('Hello', 0);
    track.setLevel(Number.NaN);
    expect(track.advance(0.01)).toEqual(SILENT);
  });

  it('retains boundary-only browser voice timing and keeps muted text tracks silent', () => {
    const audible = new AudioLockedSpeechTrack();
    audible.beginWord('Hello', 0);
    expect(audible.advance(0.03).level).toBeGreaterThan(0);
    const muted = new MutedSpeechTrack(new EstimatedSpeechTrack('Hello there.'));
    while (!muted.finished) expect(muted.advance(0.05)).toEqual(SILENT);
  });
});
