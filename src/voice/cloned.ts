/**
 * OpenAI audio playback. Historical class/module names remain for callers.
 * Every line, including fixed greetings, uses the server voice. Old shipped
 * ElevenLabs recordings and device synthesis are never substituted.
 *
 * OpenAI returns no word alignment. Approximate word/viseme timing follows
 * decoded audio duration; the actual waveform gates mouth movement in silence.
 */
import type { SpeakHandle, SpeechBoundary } from './synthesis.ts';
import { audioContext, audioRunning } from '@/lib/sound.ts';

const ENVELOPE_HZ = 40;
const WORD_OVERHEAD = 2.6;
const SENTENCE_GAP_MS = 180;

export function speakableOf(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|[\u{FE0F}\u{200D}]/gu, '')
    .replace(/\*+/g, '')
    .replace(/^[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Below this, a sentence rides with its neighbour rather than being its own chunk. */
const MIN_SENTENCE_CHARS = 40;

/**
 * Splits a line into the sentences she speaks it as.
 *
 * Mirrors `splitSentences` in server/voice/tts.ts — see the reasoning there.
 * The mirror must stay exact: the chunks requested here are the rows the
 * server caches, and different splits mean different rows.
 */
export function splitSentences(text: string): string[] {
  const pieces: string[] = [];
  const boundary = /[.!?…]+["')\]]*(?=\s|$)/g;
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    const to = match.index + match[0].length;
    const piece = text.slice(from, to).trim();
    if (piece) pieces.push(piece);
    from = to;
  }
  const tail = text.slice(from).trim();
  if (tail) pieces.push(tail);

  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged.length - 1;
    if (last >= 0 && merged[last].length < MIN_SENTENCE_CHARS) merged[last] += ` ${piece}`;
    else merged.push(piece);
  }
  if (merged.length > 1 && merged[merged.length - 1].length < MIN_SENTENCE_CHARS) {
    const short = merged.pop() as string;
    merged[merged.length - 1] += ` ${short}`;
  }
  return merged;
}

export interface ClonedVoiceHandlers {
  onBoundary?: (b: SpeechBoundary) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onLevel?: (level: number) => void;
  /** Provider/playback failure. The caller reveals text instead of changing voice. */
  onFailed?: (reason: string) => void;
}
export interface Word {
  charIndex: number;
  charLength: number;
  word: string;
  at: number;
  /** Estimated from audio duration; not provider phoneme alignment. */
  duration?: number;
}
interface SpokenLinePayload {
  audio: string;
  contentType: string;
  words: Array<{ word: string; charIndex: number; charLength: number; start: number; end: number }>;
  duration: number;
}
/** Splits a line into words with their positions, for boundary reporting. */
export function scanWords(text: string): Word[] {
  const words: Word[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    words.push({
      charIndex: match.index,
      charLength: match[0].length,
      word: match[0],
      at: 0,
    });
  }
  return words;
}

/** Spreads words across `duration`, weighted by how long each takes to say. */
export function scheduleWords(words: Word[], duration: number): void {
  const weights = words.map((w) => w.word.length + WORD_OVERHEAD);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let elapsed = 0;
  words.forEach((word, i) => {
    word.at = elapsed;
    word.duration = (weights[i] / total) * Math.max(0, duration);
    elapsed += word.duration;
  });
}

function bytesOf(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}
interface FetchedChunk { buffer: AudioBuffer; words: Word[]; }

/** Tiny quantization noise must not open the mouth during silent audio. */
export function envelopeLevel(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
  const rms = Math.sqrt(sum / samples.length);
  return rms < 0.008 ? 0 : Math.min(1, Math.pow(rms * 3.2, 0.75));
}

export class ClonedSpeaker {
  private context: AudioContext | null = null;
  private current: { stop: () => void } | null = null;
  private available = false;
  private route = '/api/voice/speak';
  private static readonly CACHE_CAP = 24;
  private lines = new Map<string, FetchedChunk>();
  private generation = 0;
  private preparation = 0;
  private preloads = new Set<AbortController>();

  /** Re-probe on prepare, so an unavailable service can recover without a reload. */
  async prepare(guest = false): Promise<boolean> {
    const mine = ++this.preparation;
    const route = guest ? '/api/public/voice/speak' : '/api/voice/speak';
    if (route !== this.route) {
      this.cancel(); this.lines.clear(); this.available = false; this.route = route;
    }
    try {
      const response = await fetch('/api/health', { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
      if (!response.ok) throw new Error('Voice status unavailable.');
      const body = await response.json() as { clonedVoice?: boolean; guestVoice?: boolean };
      if (mine === this.preparation) this.available = guest ? body.guestVoice === true : body.clonedVoice === true;
    } catch { if (mine === this.preparation) this.available = false; }
    return this.available;
  }
  canSay(text: string): boolean { return this.available && Boolean(speakableOf(text)); }
  get ready(): boolean { return this.available; }

  private remember(text: string, chunk: FetchedChunk): void {
    if (this.lines.size >= ClonedSpeaker.CACHE_CAP) {
      const oldest = this.lines.keys().next().value;
      if (oldest !== undefined) this.lines.delete(oldest);
    }
    this.lines.set(text, chunk);
  }
  private ctx(): AudioContext {
    this.context ??= audioContext();
    if (!this.context) throw new Error('No audio output is available in this browser.');
    return this.context;
  }
  private async fetchChunk(sentence: string, signal: AbortSignal): Promise<FetchedChunk> {
    signal.throwIfAborted();
    const known = this.lines.get(sentence);
    if (known) return known;
    if (!this.available) throw new Error('OpenAI voice is unavailable.');
    const response = await fetch(this.route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentence }), signal,
    });
    if (!response.ok) throw new Error(`Voice service is unavailable (${response.status}).`);
    const payload = await response.json() as SpokenLinePayload;
    signal.throwIfAborted();
    if (typeof payload.audio !== 'string' || !payload.audio) throw new Error('Voice returned no audio.');
    const buffer = await this.ctx().decodeAudioData(bytesOf(payload.audio));
    signal.throwIfAborted();
    if (!(buffer.duration > 0) || !Number.isFinite(buffer.duration)) throw new Error('Voice audio could not be decoded.');
    // The waveform duration is measured. Word placement is an explicit estimate;
    // do not treat legacy payload timings as OpenAI alignment.
    const words = scanWords(sentence);
    scheduleWords(words, buffer.duration);
    const chunk = { buffer, words };
    this.remember(sentence, chunk);
    return chunk;
  }
  async preload(text: string): Promise<boolean> {
    if (!this.available) return false;
    const generation = this.generation;
    const controller = new AbortController();
    this.preloads.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]);
    const sentences = splitSentences(speakableOf(text));
    try {
      for (const sentence of sentences) {
        if (generation !== this.generation) return false;
        await this.fetchChunk(sentence, signal);
      }
      return sentences.length > 0;
    } catch { return false; }
    finally { this.preloads.delete(controller); }
  }
  cancel(): void {
    this.generation++;
    for (const controller of this.preloads) controller.abort();
    this.preloads.clear();
    this.current?.stop();
    this.current = null;
  }
  clearCache(): void { this.cancel(); this.lines.clear(); }

  speak(text: string, handlers: ClonedVoiceHandlers = {}): SpeakHandle {
    this.cancel();
    const mine = this.generation;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
    let done = false, started = false;
    let source: AudioBufferSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let tick = 0, gap = 0;
    const live = () => !done && mine === this.generation && !controller.signal.aborted;
    const finish = (failure?: string) => {
      if (done) return;
      done = true;
      controller.abort();
      window.clearInterval(tick); window.clearTimeout(gap);
      if (source) {
        source.onended = null;
        try { source.stop(); } catch { /* Already ended. */ }
        source.disconnect(); source = null;
      }
      analyser?.disconnect(); analyser = null;
      handlers.onLevel?.(0);
      if (this.current === handle) this.current = null;
      if (failure) handlers.onFailed?.(failure);
      else handlers.onEnd?.();
      resolveFinished();
    };
    const handle = { stop: () => finish() };
    // Installed before fetch/decode, so cancelling settles finished immediately.
    this.current = handle;
    const run = async () => {
      const cleaned = speakableOf(text);
      const sentences = splitSentences(cleaned);
      if (!sentences.length) { finish(); return; }
      let cursor = 0;
      const offsets = sentences.map((sentence) => {
        const offset = cleaned.indexOf(sentence, cursor);
        cursor = offset + sentence.length;
        return offset;
      });
      const pending = new Map<number, Promise<FetchedChunk>>();
      const get = (index: number) => {
        let promise = pending.get(index);
        if (!promise) {
          promise = this.fetchChunk(sentences[index], signal);
          pending.set(index, promise);
          void promise.catch(() => {});
        }
        return promise;
      };
      const firstRequest = get(0);
      if (sentences.length > 1) void get(1);
      const first = await firstRequest;
      if (!live()) return;
      if (!(await audioRunning())) throw new Error('Tap the page to enable audio playback.');
      if (!live()) return;
      const context = this.ctx();
      analyser = context.createAnalyser(); analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35; analyser.connect(context.destination);
      const samples = new Uint8Array(analyser.fftSize);
      let playing: { chunk: FetchedChunk; at: number; next: number; offset: number } | null = null;
      let level = 0;
      tick = window.setInterval(() => {
        if (!live() || !analyser) return;
        analyser.getByteTimeDomainData(samples);
        const raw = playing ? envelopeLevel(samples) : 0;
        // Silence closes immediately; smoothing applies only to voiced energy.
        level = raw === 0 ? 0 : level + (raw - level) * (raw > level ? 0.55 : 0.2);
        handlers.onLevel?.(level);
        if (!playing) return;
        const elapsed = context.currentTime - playing.at;
        while (playing.next < playing.chunk.words.length && playing.chunk.words[playing.next].at <= elapsed) {
          const word = playing.chunk.words[playing.next++];
          handlers.onBoundary?.({ word: word.word, charIndex: playing.offset + word.charIndex,
            charLength: word.charLength, elapsed, duration: word.duration });
        }
      }, 1000 / ENVELOPE_HZ);
      const play = (index: number, chunk: FetchedChunk) => {
        if (!live() || !analyser) return;
        source = context.createBufferSource(); source.buffer = chunk.buffer; source.connect(analyser);
        const currentSource = source;
        playing = { chunk, at: context.currentTime, next: 0, offset: offsets[index] };
        currentSource.onended = () => {
          currentSource.disconnect();
          if (source === currentSource) source = null;
          playing = null; level = 0; handlers.onLevel?.(0);
          if (!live()) return;
          if (index + 1 === sentences.length) { finish(); return; }
          gap = window.setTimeout(() => {
            void get(index + 1).then((next) => { if (live()) play(index + 1, next); })
              .catch((error: Error) => { if (live()) finish(error.message); });
          }, SENTENCE_GAP_MS);
        };
        currentSource.start();
        if (!started) { started = true; handlers.onStart?.(); }
        if (index + 2 < sentences.length && live()) void get(index + 2);
      };
      play(0, first);
    };
    void run().catch((error: Error) => { if (live()) finish(error.message); });
    return { cancel: () => finish(), finished };
  }
  dispose(): void {
    this.preparation++; this.cancel(); this.available = false;
    this.context = null; this.lines.clear();
  }
}
