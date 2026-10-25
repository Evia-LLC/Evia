import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionDirector } from '../src/scene/director.ts';
import type { AudioLockedSpeechTrack, AudioSpeechFrame } from '../src/character/speech.ts';
import { VOICE_PREVIEW_LINE } from '../src/lib/lines.ts';

type Callbacks = {
  onStart?: () => void;
  onBoundary?: (value: { word: string; elapsed: number; charIndex: number; charLength: number; duration: number }) => void;
  onLevel?: (level: number) => void;
  onAudioClock?: (read: () => AudioSpeechFrame) => void;
  onEnd?: () => void;
  onFailed?: (reason: string) => void;
};
const engines = vi.hoisted(() => ({
  clonedReady: true,
  canSay: true,
  browserAvailable: true,
  cloneCalls: [] as Array<{ text: string; callbacks: Callbacks }>,
  browserCalls: [] as Array<{ text: string; callbacks: Callbacks }>,
  prepare: vi.fn((): Promise<boolean> => Promise.resolve(true)),
  cancelCloned: vi.fn(),
  cancelBrowser: vi.fn(),
  abortListener: vi.fn(),
}));
vi.mock('../src/voice/cloned.ts', () => ({ ClonedSpeaker: class {
  get ready() { return engines.clonedReady; }
  canSay() { return engines.canSay; }
  speak(text: string, callbacks: Callbacks) { engines.cloneCalls.push({ text, callbacks }); }
  cancel = engines.cancelCloned;
  prepare = vi.fn(async () => engines.clonedReady);
} }));
vi.mock('../src/voice/synthesis.ts', () => ({
  hasSynthesis: () => engines.browserAvailable,
  synthesisAvailable: () => engines.browserAvailable,
  listVoices: async () => [],
  Speaker: class {
    prepare = engines.prepare;
    cancel = engines.cancelBrowser;
    speak(text: string, callbacks: Callbacks) { engines.browserCalls.push({ text, callbacks }); }
  },
}));
vi.mock('../src/voice/recognition.ts', () => ({
  recognitionAvailable: () => false,
  Listener: class { listening = false; abort = engines.abortListener; },
}));
vi.mock('../src/state/session.svelte.ts', () => ({ session: {
  user: { preferences: { voiceEnabled: false } },
  speaking: false,
  listening: false,
  spokenChars: 0,
  voiceStatus: '',
} }));
vi.mock('../src/lib/sound.ts', () => ({ audioContext: () => ({ state: 'running' }) }));

import { VoiceController } from '../src/voice/controller.ts';
import { session } from '../src/state/session.svelte.ts';

let voice: VoiceController;
let director: {
  useSpeechTrack: ReturnType<typeof vi.fn>;
  stopMouth: ReturnType<typeof vi.fn>;
  elohimSpoke: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.clearAllMocks();
  engines.cloneCalls.length = engines.browserCalls.length = 0;
  engines.clonedReady = engines.canSay = engines.browserAvailable = true;
  engines.prepare.mockImplementation(() => Promise.resolve(true));
  session.user!.preferences.voiceEnabled = false;
  session.speaking = session.listening = false;
  session.spokenChars = 0;
  session.voiceStatus = '';
  director = { useSpeechTrack: vi.fn(), stopMouth: vi.fn(), elohimSpoke: vi.fn() };
  voice = new VoiceController();
  voice.attach(director as unknown as SessionDirector);
});
afterEach(() => {
  voice.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('explicit Evia voice sample', () => {
  it('installs the recording clock and rejects clocks delivered by retired samples', () => {
    voice.sample();
    const first = engines.cloneCalls[0].callbacks;
    let audioTime = 20.2;
    const readFirst = vi.fn((): AudioSpeechFrame => ({
      time: audioTime, level: 0.6,
      word: { word: 'hello', start: 20, duration: 0.5 },
    }));
    first.onAudioClock!(readFirst);
    first.onStart!();
    const firstTrack = director.useSpeechTrack.mock.calls.at(-1)![0] as AudioLockedSpeechTrack;
    expect(firstTrack.advance(0.1).viseme).toBe('EE');
    audioTime = 20.4;
    // A 5 FPS renderer caps its integration step at .1, while audio advances .2.
    // A late boundary must not rewind the installed recording's word phase.
    first.onBoundary!({ word: 'hello', elapsed: 0, charIndex: 0, charLength: 5, duration: 0.5 });
    first.onLevel!(1);
    expect(firstTrack.advance(0.1)).toMatchObject({ viseme: 'OH', level: 0.6 });
    expect(readFirst).toHaveBeenCalledTimes(2);

    const oldClock = vi.spyOn(firstTrack, 'useAudioClock');
    voice.sample();
    const second = engines.cloneCalls[1].callbacks;
    second.onAudioClock!(() => ({ time: 30.25, level: 0.7, word: { word: 'you', start: 30, duration: 0.5 } }));
    second.onStart!();
    const secondTrack = director.useSpeechTrack.mock.calls.at(-1)![0] as AudioLockedSpeechTrack;
    const staleReader = vi.fn(() => readFirst());
    first.onAudioClock!(staleReader);
    expect(oldClock).not.toHaveBeenCalled();
    expect(secondTrack.advance(0.1)).toMatchObject({ viseme: 'OU', level: 0.7 });
    expect(staleReader).not.toHaveBeenCalled();

    const currentClock = vi.spyOn(secondTrack, 'useAudioClock');
    voice.stopSample();
    second.onAudioClock!(staleReader);
    expect(currentClock).not.toHaveBeenCalled();
    expect(session.speaking).toBe(false);
  });

  it('plays a shipped line with speech disabled without changing the reply preference', () => {
    voice.speak('An ordinary reply.');
    expect(engines.cloneCalls).toHaveLength(0);
    expect(engines.browserCalls).toHaveLength(0);

    voice.sample();
    expect(engines.cloneCalls).toHaveLength(1);
    expect(engines.cloneCalls[0].text).toBe(VOICE_PREVIEW_LINE);
    expect(engines.cloneCalls[0].text).not.toContain('Elohim');
    expect(session.user!.preferences.voiceEnabled).toBe(false);
    expect(director.elohimSpoke).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'SPEAKING', gesture: 'none' }),
      engines.cloneCalls[0].text,
    );
    expect(session.speaking).toBe(false);
    expect(director.useSpeechTrack).not.toHaveBeenCalled();

    const { callbacks } = engines.cloneCalls[0];
    callbacks.onStart!();
    expect(session.speaking).toBe(true);
    const track = director.useSpeechTrack.mock.calls[0][0] as AudioLockedSpeechTrack;
    callbacks.onBoundary!({ word: 'right', elapsed: 0.2, charIndex: 4, charLength: 5, duration: 0.4 });
    const levels = vi.spyOn(track, 'setLevel');
    callbacks.onLevel!(0.7);
    expect(track.receivedTiming).toBe(true);
    expect(levels).toHaveBeenCalledWith(0.7);
    expect(track.advance(0.15).level).toBeGreaterThan(0);
    expect(session.spokenChars).toBe(9);
    callbacks.onEnd!();
    expect(session.speaking).toBe(false);
    expect(track.finished).toBe(true);
    expect(track.advance(0.1)).toEqual({ viseme: 'sil', weight: 0, level: 0 });
    expect(session.voiceStatus).toBe('Voice sample finished.');
    expect(session.user!.preferences.voiceEnabled).toBe(false);
  });

  it('retires late audio events when the user stops a pending sample', () => {
    voice.sample();
    const { callbacks } = engines.cloneCalls[0];
    voice.stopSpeaking();
    const stoppedChars = session.spokenChars;
    callbacks.onStart!();
    callbacks.onBoundary!({ word: 'right', elapsed: 0.2, charIndex: 4, charLength: 5, duration: 0.4 });
    callbacks.onEnd!();
    expect(session.speaking).toBe(false);
    expect(session.spokenChars).toBe(stoppedChars);
    expect(director.useSpeechTrack).not.toHaveBeenCalled();
    expect(director.stopMouth).toHaveBeenCalled();
    expect(session.voiceStatus).not.toBe('Voice sample finished.');
  });

  it('does not let the end of a superseded sample close the new audio track', () => {
    voice.sample();
    const first = engines.cloneCalls[0].callbacks;
    first.onStart!();
    voice.sample();
    expect(session.speaking).toBe(false);
    const second = engines.cloneCalls[1].callbacks;
    second.onStart!();
    const newTrack = director.useSpeechTrack.mock.calls.at(-1)![0] as AudioLockedSpeechTrack;
    first.onEnd!();
    expect(session.speaking).toBe(true);
    expect(newTrack.finished).toBe(false);
    expect(session.voiceStatus).toContain('playing');
    second.onEnd!();
    expect(session.speaking).toBe(false);
    expect(newTrack.finished).toBe(true);
  });

  it('reports failed audio without miming or silently substituting a device voice', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    voice.sample();
    engines.cloneCalls[0].callbacks.onFailed!('network unavailable');
    vi.advanceTimersByTime(700);
    expect(engines.cloneCalls).toHaveLength(2);
    engines.cloneCalls[1].callbacks.onFailed!('network unavailable');
    expect(director.useSpeechTrack).not.toHaveBeenCalled();
    expect(session.speaking).toBe(false);
    expect(session.voiceStatus).toContain('could not play');
    expect(engines.browserCalls).toHaveLength(0);
  });

  it('prevents a scheduled audio retry from reviving a cancelled sample', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    voice.sample();
    engines.cloneCalls[0].callbacks.onFailed!('network unavailable');
    voice.stopSpeaking();
    vi.advanceTimersByTime(1000);
    expect(engines.cloneCalls).toHaveLength(1);
    expect(session.speaking).toBe(false);
  });

  it('does not start a late device preview after Stop', async () => {
    engines.clonedReady = false;
    let finishPrepare!: (ready: boolean) => void;
    engines.prepare.mockImplementation(() => new Promise((resolve) => { finishPrepare = resolve; }));
    voice.preview('test-device-voice');
    voice.stopSpeaking();
    finishPrepare(true);
    await Promise.resolve();
    expect(engines.browserCalls).toHaveLength(0);
    expect(director.useSpeechTrack).not.toHaveBeenCalled();
  });

  it('stops an active audition through its dedicated Stop control', () => {
    voice.sample();
    const { callbacks } = engines.cloneCalls[0];
    callbacks.onStart!();
    voice.stopSample();
    expect(session.speaking).toBe(false);
    expect(session.voiceStatus).toBe('Voice sample stopped.');
    callbacks.onEnd!();
    expect(session.voiceStatus).toBe('Voice sample stopped.');
  });

  it('does not let demo cleanup cancel a newer conversation reply', () => {
    voice.sample();
    engines.cloneCalls[0].callbacks.onStart!();
    session.user!.preferences.voiceEnabled = true;
    voice.speak('A new conversation reply.');
    engines.cloneCalls[1].callbacks.onStart!();
    const cancellations = engines.cancelCloned.mock.calls.length;
    voice.stopSample();
    expect(engines.cancelCloned).toHaveBeenCalledTimes(cancellations);
    expect(session.speaking).toBe(true);
  });

  it('keeps the completion status when demo cleanup runs after the sample ended', () => {
    voice.sample();
    engines.cloneCalls[0].callbacks.onStart!();
    engines.cloneCalls[0].callbacks.onEnd!();
    voice.stopSample();
    expect(session.voiceStatus).toBe('Voice sample finished.');
  });

  it('uses the same animated sample path for the existing Profile preview control', () => {
    voice.preview(null);
    expect(engines.cloneCalls).toHaveLength(1);
    engines.cloneCalls[0].callbacks.onStart!();
    expect(director.useSpeechTrack).toHaveBeenCalledTimes(1);
    expect(session.speaking).toBe(true);
  });
});
