import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ context: null as any, running: vi.fn(), session: {
  guest: false,
  user: { id: 'account-a', preferences: { voiceEnabled: true }, consents: { cloud_reasoning: true } },
  voiceStatus: '', spokenChars: 0, speaking: false, listening: false,
} }));
vi.mock('@/lib/sound.ts', () => ({ audioContext: () => state.context, audioRunning: state.running }));
vi.mock('@/state/session.svelte.ts', () => ({ session: state.session }));
import { ClonedSpeaker, envelopeLevel } from '../src/voice/cloned.ts';
import { VoiceController } from '../src/voice/controller.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
class Source {
  onended: (() => void) | null = null;
  buffer: unknown;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
  end() { this.onended?.(); }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const response = () => new Response(JSON.stringify({ audio: btoa('test-audio'), contentType: 'audio/wav', words: [], duration: 99 }));
let sources: Source[];
let analyser: { fftSize: number; sample: number; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; getByteTimeDomainData: (values: Uint8Array) => void };
beforeEach(() => {
  vi.useFakeTimers(); sources = [];
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout });
  analyser = { fftSize: 512, sample: 128, connect: vi.fn(), disconnect: vi.fn(),
    getByteTimeDomainData(values) { values.fill(this.sample); } };
  state.context = { currentTime: 0, destination: {},
    decodeAudioData: vi.fn(async () => ({ duration: 2 })),
    createAnalyser: () => analyser,
    createBufferSource: () => { const source = new Source(); sources.push(source); return source; },
  };
  state.running.mockReset(); state.running.mockResolvedValue(true);
  state.session.user.preferences.voiceEnabled = true; state.session.speaking = false; state.session.spokenChars = 0;
  state.session.guest = false; state.session.user.id = 'account-a'; state.session.user.consents.cloud_reasoning = true;
  vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async (url) => String(url) === '/api/health'
    ? new Response(JSON.stringify({ clonedVoice: true, guestVoice: true })) : response()));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('OpenAI playback lifecycle', () => {
  it('gets fixed greeting lines from the server and never loads legacy manifests', async () => {
    const speaker = new ClonedSpeaker(); await speaker.prepare();
    const handle = speaker.speak('Hello, welcome.'); await flush();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/health', '/api/voice/speak']);
    expect(sources[0].start).toHaveBeenCalledTimes(1); sources[0].end(); await handle.finished;
  });
  it('uses decoded duration for approximate word timing and actual waveform for silence', async () => {
    const speaker = new ClonedSpeaker(); await speaker.prepare();
    const onBoundary = vi.fn(), onLevel = vi.fn();
    const handle = speaker.speak('Hello there', { onBoundary, onLevel }); await flush();
    vi.advanceTimersByTime(25);
    expect(onBoundary.mock.calls[0][0].duration).toBeCloseTo(1);
    expect(onLevel).toHaveBeenLastCalledWith(0);
    analyser.sample = 160; vi.advanceTimersByTime(25); expect(onLevel.mock.lastCall![0]).toBeGreaterThan(0);
    analyser.sample = 128; vi.advanceTimersByTime(25); expect(onLevel).toHaveBeenLastCalledWith(0);
    sources[0].end(); await handle.finished;
  });
  it('settles immediately and never plays when stopped during decode', async () => {
    const decode = deferred<{ duration: number }>(); state.context.decodeAudioData.mockReturnValueOnce(decode.promise);
    const speaker = new ClonedSpeaker(); await speaker.prepare();
    const onStart = vi.fn(), onEnd = vi.fn();
    const handle = speaker.speak('Hello there', { onStart, onEnd }); await flush();
    speaker.cancel(); await handle.finished; expect(onEnd).toHaveBeenCalledTimes(1);
    decode.resolve({ duration: 2 }); await flush();
    expect(sources).toHaveLength(0); expect(onStart).not.toHaveBeenCalled();
  });
  it('aborts pending HTTP work and does not report cancellation as failure', async () => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementation(async (url) => String(url) === '/api/health'
      ? new Response(JSON.stringify({ clonedVoice: true })) : pending.promise);
    const speaker = new ClonedSpeaker(); await speaker.prepare();
    const onFailed = vi.fn(); const handle = speaker.speak('Pending request', { onFailed }); await flush();
    const signal = vi.mocked(fetch).mock.calls[1][1]!.signal!;
    handle.cancel(); await handle.finished; expect(signal.aborted).toBe(true);
    pending.resolve(response()); await flush(); expect(onFailed).not.toHaveBeenCalled(); expect(sources).toHaveLength(0);
  });
  it('overlapping decodes play only the latest line and old handles cannot cancel it', async () => {
    const oldDecode = deferred<{ duration: number }>(); state.context.decodeAudioData.mockReturnValueOnce(oldDecode.promise);
    const speaker = new ClonedSpeaker(); await speaker.prepare();
    const first = speaker.speak('Older words'); await flush();
    const second = speaker.speak('Newer words'); await flush();
    expect(sources).toHaveLength(1); first.cancel(); expect(sources[0].stop).not.toHaveBeenCalled();
    oldDecode.resolve({ duration: 2 }); await flush(); expect(sources).toHaveLength(1);
    sources[0].end(); await Promise.all([first.finished, second.finished]);
  });
  it('dispose while audio unlock is pending prevents a late start', async () => {
    const unlock = deferred<boolean>(); state.running.mockReturnValueOnce(unlock.promise);
    const speaker = new ClonedSpeaker(); await speaker.prepare();
    const handle = speaker.speak('Wait for unlock'); await flush(); speaker.dispose();
    await handle.finished; unlock.resolve(true); await flush(); expect(sources).toHaveLength(0);
  });
  it('natural completion fires once and releases nodes', async () => {
    const speaker = new ClonedSpeaker(); await speaker.prepare(); const onEnd = vi.fn();
    const handle = speaker.speak('Finish naturally', { onEnd }); await flush();
    sources[0].end(); sources[0].end(); await handle.finished;
    expect(onEnd).toHaveBeenCalledTimes(1); expect(analyser.disconnect).toHaveBeenCalledTimes(1);
  });
  it('quantization noise is silent but audible waveform produces a bounded level', () => {
    expect(envelopeLevel(new Uint8Array(512).fill(128))).toBe(0);
    expect(envelopeLevel(new Uint8Array(512).fill(129))).toBe(0);
    expect(envelopeLevel(new Uint8Array(512).fill(160))).toBeGreaterThan(0);
    expect(envelopeLevel(new Uint8Array(512).fill(255))).toBeLessThanOrEqual(1);
  });
  it('provider failure reveals all text, closes the mouth, and never calls browser speech', async () => {
    const controller = new VoiceController(); const stopMouth = vi.fn();
    controller.attach({ stopMouth, useSpeechTrack: vi.fn() } as any); await controller.prepare();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('failed', { status: 502 }));
    const line = 'The reply remains available in full.';
    await controller.speakAndWait(line);
    expect(state.session.spokenChars).toBe(line.length); expect(state.session.speaking).toBe(false);
    expect(state.session.voiceStatus).toContain('full reply'); expect(stopMouth).toHaveBeenCalled();
    expect(speechSynthesis.speak).not.toHaveBeenCalled(); controller.dispose();
  });
  it('unconfigured voice stays text-only and discloses the AI voice when available', async () => {
    const controller = new VoiceController(); await controller.prepare();
    expect(state.session.voiceStatus).toContain('AI-generated'); expect(await controller.availableVoices()).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ clonedVoice: false })));
    const capabilities = await controller.prepare(); expect(capabilities.canSpeak).toBe(false);
    expect(controller.willSpeak('Hello')).toBe('none'); controller.preview(null);
    expect(speechSynthesis.speak).not.toHaveBeenCalled(); controller.dispose();
  });
  it('does not preload or speak guest greetings before explicit voice opt-in', async () => {
    state.session.guest = true; state.session.user.preferences.voiceEnabled = false;
    const controller = new VoiceController(); await controller.prepare('en', null, true);
    await controller.preload(['Hi, I am Elohim.']); controller.preview(null); await controller.speakAndWait('Hello there.');
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/health']);
    expect(sources).toHaveLength(0); expect(controller.willSpeak('Hello')).toBe('none'); controller.dispose();
  });
  it('requires account cloud consent even when voice is enabled and cached', async () => {
    const controller = new VoiceController(); await controller.prepare();
    await controller.preload(['Previously opted-in reply.']);
    vi.mocked(fetch).mockClear(); state.session.user.consents.cloud_reasoning = false;
    await controller.preload(['New private reply.']); controller.preview(null); await controller.speakAndWait('Previously opted-in reply.');
    expect(fetch).not.toHaveBeenCalled(); expect(sources).toHaveLength(0); controller.dispose();
  });
  it('does not preload personal narration while the voice preference is off', async () => {
    const controller = new VoiceController(); await controller.prepare();
    state.session.user.preferences.voiceEnabled = false;
    await controller.preload(['Your personal skin observations.']);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/health']); controller.dispose();
  });
  it('explicitly opted-in guest uses the public route', async () => {
    state.session.guest = true; state.session.user.consents.cloud_reasoning = false;
    const controller = new VoiceController(); await controller.prepare('en', null, true);
    controller.speak('Hello there.'); await flush();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/health', '/api/public/voice/speak']);
    expect(sources).toHaveLength(1); controller.dispose();
  });
  it('cancels pending preload and prevents repopulating the cache after withdrawal', async () => {
    const decode = deferred<{ duration: number }>(); state.context.decodeAudioData.mockReturnValueOnce(decode.promise);
    const speaker = new ClonedSpeaker(); await speaker.prepare();
    const preloading = speaker.preload('Private cached words.'); await flush();
    const signal = vi.mocked(fetch).mock.calls[1][1]!.signal!;
    speaker.clearCache(); expect(signal.aborted).toBe(true);
    decode.resolve({ duration: 2 }); expect(await preloading).toBe(false);
    await speaker.preload('Private cached words.');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/voice/speak')).toHaveLength(2); speaker.dispose();
  });
  it('clears decoded audio across account identities', async () => {
    const controller = new VoiceController(); await controller.prepare();
    await controller.preload(['A repeated private reply.']);
    state.session.user.id = 'account-b'; await controller.prepare();
    await controller.preload(['A repeated private reply.']);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/voice/speak')).toHaveLength(2); controller.dispose();
  });
});
