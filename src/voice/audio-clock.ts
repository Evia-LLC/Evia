import type { AudioSpeechFrame } from '@/character/speech.ts';

const ENVELOPE_HZ = 100;

/** A compact envelope indexed by audio time, not by when a timer happened to run. */
export function buildAudioEnvelope(buffer: AudioBuffer): Float32Array {
  const envelope = new Float32Array(Math.ceil(buffer.duration * ENVELOPE_HZ));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  let level = 0;
  for (let i = 0; i < envelope.length; i++) {
    const from = Math.floor(i * buffer.sampleRate / ENVELOPE_HZ);
    const to = Math.min(buffer.length, Math.floor((i + 1) * buffer.sampleRate / ENVELOPE_HZ));
    let sum = 0;
    for (const channel of channels) {
      for (let j = from; j < to; j++) sum += channel[j] * channel[j];
    }
    const rms = Math.sqrt(sum / Math.max(1, (to - from) * channels.length));
    const raw = Math.min(1, Math.pow(rms * 3.2, 0.75));
    // Brief smoothing is baked into the timeline, so its release does not
    // become longer when rendering or the browser's timer is throttled.
    level += (raw - level) * (raw > level ? 0.65 : 0.25);
    envelope[i] = level;
  }
  return envelope;
}

export function audioEnvelopeAt(envelope: Float32Array, elapsed: number, duration: number): number {
  if (elapsed < 0 || elapsed >= duration || !envelope.length) return 0;
  const at = elapsed * ENVELOPE_HZ;
  const index = Math.min(envelope.length - 1, Math.floor(at));
  const next = Math.min(envelope.length - 1, index + 1);
  return envelope[index] + (envelope[next] - envelope[index]) * (at - Math.floor(at));
}

/** getOutputTimestamp already includes device latency; do not subtract it again. */
export function audibleAudioTime(context: AudioContext): number {
  const stamp = context.getOutputTimestamp?.();
  if (stamp && typeof stamp.performanceTime === 'number' && stamp.performanceTime > 0 &&
      typeof stamp.contextTime === 'number' && stamp.contextTime >= 0) {
    const time = stamp.contextTime + Math.max(0, performance.now() - stamp.performanceTime) / 1000;
    return Math.min(context.currentTime, time);
  }
  return context.currentTime;
}

export interface AudioPlaybackChunk {
  startedAt: number;
  buffer: AudioBuffer;
  envelope: Float32Array;
  words: Array<{ word: string; at: number; duration?: number }>;
}

/** Select the current word directly, including after a long event-loop stall. */
export function readAudioPlayback(chunk: AudioPlaybackChunk | null, time: number): AudioSpeechFrame {
  if (!chunk) return { time, level: 0, word: null };
  const local = time - chunk.startedAt;
  const level = audioEnvelopeAt(chunk.envelope, local, chunk.buffer.duration);
  if (local < 0 || local >= chunk.buffer.duration) return { time, level: 0, word: null };
  let low = 0;
  let high = chunk.words.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (chunk.words[middle].at <= local) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const word = chunk.words[index];
  if (!word) return { time, level, word: null };
  const duration = word.duration ?? ((chunk.words[index + 1]?.at ?? chunk.buffer.duration) - word.at);
  if (local >= word.at + duration) return { time, level, word: null };
  return { time, level, word: { word: word.word, start: chunk.startedAt + word.at, duration } };
}
