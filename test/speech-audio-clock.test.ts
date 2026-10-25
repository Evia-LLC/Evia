import { describe, expect, it, vi } from 'vitest';
import { AudioLockedSpeechTrack, type AudioSpeechFrame } from '../src/character/speech.ts';
import { audibleAudioTime, buildAudioEnvelope, readAudioPlayback } from '../src/voice/audio-clock.ts';

function pcm(seconds: number, sample: (time: number) => number): AudioBuffer {
  const sampleRate = 1000;
  const data = Float32Array.from({ length: seconds * sampleRate }, (_, i) => sample(i / sampleRate));
  return {
    duration: seconds, sampleRate, length: data.length, numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

describe('recording-driven mouth timing', () => {
  it('has the same phoneme phase at 60 FPS, 5 FPS, and after a delayed first frame', () => {
    const sample = (frames: number[]) => {
      let time = 20;
      const track = new AudioLockedSpeechTrack();
      track.useAudioClock(() => ({ time, level: 0.6, word: { word: 'hello', start: 20, duration: 0.5 } }));
      let result;
      for (const actualStep of frames) {
        time += actualStep;
        // The renderer intentionally caps integration steps; audio does not.
        result = track.advance(Math.min(0.1, actualStep));
      }
      return result!;
    };
    const regular = sample(Array(24).fill(1 / 60));
    for (const delayed of [sample([0.2, 0.2]), sample([0.4])]) {
      expect(delayed.viseme).toBe('OH');
      expect(delayed.viseme).toBe(regular.viseme);
      expect(delayed.weight).toBeCloseTo(regular.weight, 10);
      expect(delayed.level).toBeCloseTo(regular.level, 10);
    }
  });

  it('skips missed words rather than restarting their phonemes when callbacks arrive late', () => {
    const buffer = pcm(1, () => 0.2);
    const chunk = {
      buffer, envelope: buildAudioEnvelope(buffer), startedAt: 5,
      words: [
        { word: 'me', at: 0, duration: 0.2 },
        { word: 'hello', at: 0.3, duration: 0.5 },
      ],
    };
    const track = new AudioLockedSpeechTrack();
    track.useAudioClock(() => readAudioPlayback(chunk, 5.7));
    // Simulate a throttled boundary timer delivering all missed callbacks.
    track.beginWord('me', 0, 0.2);
    track.beginWord('hello', 0.3, 0.5);
    expect(track.advance(0.016).viseme).toBe('OH');
    track.beginWord('me', 0, 0.2);
    expect(track.advance(0.016).viseme).toBe('OH');
  });

  it('reads current PCM loudness after a stall instead of retaining an old timer envelope', () => {
    const buffer = pcm(1, (t) => t < 0.3 ? 0.3 : 0);
    const chunk = {
      buffer, envelope: buildAudioEnvelope(buffer), startedAt: 0,
      words: [{ word: 'hello', at: 0, duration: 1 }],
    };
    let time = 0.1;
    const track = new AudioLockedSpeechTrack();
    track.useAudioClock(() => readAudioPlayback(chunk, time));
    expect(track.advance(0.016).weight).toBeGreaterThan(0.2);
    time = 0.8;
    track.setLevel(1); // Last timer callback is stale; it cannot reopen the lips.
    const silent = track.advance(0.1);
    expect(silent.weight).toBeLessThan(0.00001);
    expect(silent.level).toBeLessThan(0.00001);
  });

  it('closes on pause/cancel and resumes at the actual phase without restarting the word', () => {
    let frame: AudioSpeechFrame = { time: 10.1, level: 0.6, word: { word: 'hello', start: 10, duration: 0.5 } };
    const track = new AudioLockedSpeechTrack();
    track.useAudioClock(() => frame);
    expect(track.advance(0.1).weight).toBeGreaterThan(0);
    frame = { time: 10.1, level: 0, word: null };
    expect(track.advance(0.1)).toEqual({ viseme: 'sil', weight: 0, level: 0 });
    frame = { time: 10.4, level: 0.6, word: { word: 'hello', start: 10, duration: 0.5 } };
    expect(track.advance(0.016).viseme).toBe('OH');
    track.end();
    expect(track.advance(0.016)).toEqual({ viseme: 'sil', weight: 0, level: 0 });
  });

  it('closes in measured interword gaps and beyond the recording, including delayed onended', () => {
    const buffer = pcm(1, () => 0.3);
    const chunk = {
      buffer, envelope: buildAudioEnvelope(buffer), startedAt: 2,
      words: [{ word: 'hello', at: 0.1, duration: 0.3 }, { word: 'me', at: 0.7, duration: 0.2 }],
    };
    expect(readAudioPlayback(chunk, 2.05).word).toBeNull();
    expect(readAudioPlayback(chunk, 2.5).word).toBeNull();
    expect(readAudioPlayback(chunk, 2.8).word?.word).toBe('me');
    expect(readAudioPlayback(chunk, 3.2)).toEqual({ time: 3.2, level: 0, word: null });
  });

  it('preserves the boundary-driven browser speech fallback', () => {
    const track = new AudioLockedSpeechTrack();
    track.beginWord('hello', 0, 0.5);
    expect(track.advance(0.4).viseme).toBe('OH');
    expect(track.receivedTiming).toBe(true);
  });

  it('counts only the true quiet tail of a slow frame when detecting a phrase break', () => {
    let frame: AudioSpeechFrame = { time: 0.1, level: 0.6, word: { word: 'me', start: 0, duration: 0.2 } };
    const track = new AudioLockedSpeechTrack();
    track.useAudioClock(() => frame);
    track.advance(0.1);
    frame = { time: 0.25, level: 0, word: null };
    track.advance(0.1);
    expect(track.consumePhrase()).toBe(false);
    frame = { time: 0.34, level: 0, word: null };
    track.advance(0.09);
    expect(track.consumePhrase()).toBe(true);
  });
});

describe('audible output clock', () => {
  it('projects the output timestamp without subtracting latency twice', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1050);
    try {
      const context = {
        currentTime: 20.2, outputLatency: 0.1,
        getOutputTimestamp: () => ({ contextTime: 20, performanceTime: 1000 }),
      } as unknown as AudioContext;
      expect(audibleAudioTime(context)).toBeCloseTo(20.05);
    } finally { now.mockRestore(); }
  });

  it('falls back to the audio clock before output timestamps initialize or where unsupported', () => {
    expect(audibleAudioTime({ currentTime: 12 } as AudioContext)).toBe(12);
    expect(audibleAudioTime({ currentTime: 12, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) } as AudioContext)).toBe(12);
  });
});

describe('spoken shapes for Evia’s neutral recorded phrases', () => {
  const shapes = (word: string) => {
    const track = new AudioLockedSpeechTrack();
    track.beginWord(word, 0, 1);
    const sequence: string[] = [];
    for (let i = 0; i < 99; i++) {
      const state = track.advance(0.01);
      if (sequence.at(-1) !== state.viseme) sequence.push(state.viseme);
    }
    return sequence;
  };

  it('gives right one spoken diphthong instead of articulating the silent gh', () => {
    expect(shapes('right')).toEqual(['AA', 'IH']);
  });

  it('does not pronounce silent final e in here or have', () => {
    expect(shapes('here.')).toEqual(['IH']);
    expect(shapes('have')).toEqual(['AA', 'FV']);
  });

  it('holds ee and oo as one vowel, including the estimated spelling fallback', () => {
    expect(shapes('need?')).toEqual(['IH', 'EE', 'IH']);
    expect(shapes('soon')).toEqual(['S', 'OU', 'IH']);
  });

  it('keeps the voiced contractions and terminal vowel in the readiness phrase', () => {
    expect(shapes('I’m')).toEqual(shapes("I'm"));
    expect(shapes("you're")).toEqual(['IH', 'OU', 'IH']);
    expect(shapes('ready.').at(-1)).toBe('EE');
  });
});
