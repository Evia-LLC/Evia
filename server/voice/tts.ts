/**
 * One server-generated OpenAI voice for every line, including greetings.
 * Public scripted audio is cached by provider/model/voice/style/speed/text.
 * Personal replies are never read from or written to the durable global cache.
 * The API retains its
 * audio/words/duration/chunks contract. OpenAI supplies no word alignment, so
 * words stays empty and the browser estimates it against the decoded audio.
 */
import { createHash } from 'node:crypto';
import { row, run } from '../db/index.ts';
import { log } from '../lib/log.ts';
import { allShippedLines } from '../../src/lib/lines.ts';

const ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const SAMPLE_RATE = 24_000;
const MAX_CHARS = 1200;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const DEFAULT_INSTRUCTIONS = 'Speak as a warm, reassuring beauty consultant. Use natural conversational English, gentle confidence, a relaxed pace, and brief pauses. Avoid exaggerated enthusiasm, whispering, or a sales-pitch delivery. Read only the provided text.';

export interface VoiceConfig {
  apiKey: string;
  voiceId: string;
  endpoint: string;
  modelId: string;
  instructions: string;
  speed: number;
}

export function voiceConfig(): VoiceConfig | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const parsedSpeed = Number(process.env.OPENAI_TTS_SPEED ?? '1');
  return {
    apiKey,
    voiceId: process.env.OPENAI_TTS_VOICE?.trim() || 'marin',
    endpoint: ENDPOINT,
    modelId: process.env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts-2025-12-15',
    instructions: (process.env.OPENAI_TTS_INSTRUCTIONS?.trim() || DEFAULT_INSTRUCTIONS).slice(0, 4096),
    speed: Number.isFinite(parsedSpeed) && parsedSpeed >= 0.25 && parsedSpeed <= 4 ? parsedSpeed : 1,
  };
}

// Historical names remain for the health/route contract; this is a built-in
// AI-generated voice, not a claim of a cloned human speaker.
export function clonedVoiceAvailable(): boolean { return voiceConfig() !== null; }
export function guestVoiceAllowed(): boolean {
  return clonedVoiceAvailable() && process.env.ELOHIM_GUEST_VOICE !== '0';
}
export class VoiceUnavailable extends Error {
  constructor() {
    super('OpenAI voice is not configured (OPENAI_API_KEY unset). Replies remain available as text.');
    this.name = 'VoiceUnavailable';
  }
}

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
 * The sentence is the unit of synthesis and of caching: openers repeat
 * ("Right. Let's look.") where full replies almost never do, so per-sentence
 * rows actually get hits. Fragments under ~40 characters are merged forward
 * into their neighbour - a lone "No." is too short to synthesise well or to
 * pause after, and the merged unit is what both sides cache.
 *
 * Splits only where sentence punctuation is followed by whitespace, so
 * decimals and abbreviations stay whole. Mirrored in src/voice/cloned.ts;
 * the two copies must stay in lockstep so client chunks and server cache
 * rows describe the same pieces of text.
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
  // A short tail joins the sentence before it rather than dangling alone.
  if (merged.length > 1 && merged[merged.length - 1].length < MIN_SENTENCE_CHARS) {
    const short = merged.pop() as string;
    merged[merged.length - 1] += ` ${short}`;
  }
  return merged;
}

export interface SpokenWord {
  word: string;
  charIndex: number;
  charLength: number;
  start: number;
  end: number;
}
export interface SpokenChunk {
  text: string;
  audio: Buffer;
  contentType: string;
  /** Empty for OpenAI: no measured word alignment was returned. */
  words: SpokenWord[];
  duration: number;
  start: number;
  charOffset: number;
  cached: boolean;
}
export interface SpeakContext { previousText?: string; nextText?: string; }
export interface SpokenLine {
  audio: Buffer;
  contentType: string;
  words: SpokenWord[];
  duration: number;
  cached: boolean;
  chunks: SpokenChunk[];
}

/** Historical alignment shape retained for offline conversion helpers. OpenAI TTS does not supply this. */
interface AlignedResponse {
  audio_base64: string;
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  } | null;
  normalized_alignment?: AlignedResponse['alignment'];
}

/**
 * Word timings from a character alignment.
 *
 * The provider aligns every character, spaces included. Words are runs of
 * non-space characters; a word starts when its first character does and ends
 * when its last one does. The character indices are into the text *as sent*,
 * which is the cleaned sentence — the same string the client's own cleaning
 * and splitting produce, so its boundaries line up.
 */
export function wordsFromAlignment(
  text: string,
  alignment: NonNullable<AlignedResponse['alignment']>,
): SpokenWord[] {
  const words: SpokenWord[] = [];
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) {
      i++;
      continue;
    }
    const from = i;
    while (i < chars.length && !/\s/.test(chars[i])) i++;
    const word = chars.slice(from, i).join('');
    words.push({
      word,
      charIndex: from,
      charLength: i - from,
      start: starts[from] ?? 0,
      end: ends[i - 1] ?? starts[from] ?? 0,
    });
  }
  // The alignment's character stream is the text; if a provider ever
  // normalises it (numbers to words, say), indices drift. Fall back to the
  // text's own word positions, keeping the timings in order.
  if (words.length && chars.join('') !== text) {
    const own = [...text.matchAll(/\S+/g)];
    if (own.length === words.length) {
      own.forEach((m, k) => {
        words[k].charIndex = m.index ?? 0;
        words[k].charLength = m[0].length;
        words[k].word = m[0];
      });
    }
  }
  return words;
}

/** Wrap raw mono 24 kHz signed 16-bit PCM in a browser-decodable WAV file. */
export function wavFromPCM(pcm: Buffer): Buffer {
  if (!pcm.length || pcm.length % 2) throw new Error('Voice returned invalid PCM audio.');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function pcmOfWav(audio: Buffer): Buffer {
  if (audio.length < 46 || audio.toString('ascii', 0, 4) !== 'RIFF' ||
      audio.toString('ascii', 8, 12) !== 'WAVE' || audio.toString('ascii', 36, 40) !== 'data' ||
      audio.readUInt32LE(24) !== SAMPLE_RATE || audio.readUInt16LE(22) !== 1 ||
      audio.readUInt16LE(34) !== 16 || audio.readUInt32LE(40) !== audio.length - 44 ||
      (audio.length - 44) % 2) throw new Error('Voice cache contains invalid audio.');
  return audio.subarray(44);
}

export function voiceCacheKey(config: VoiceConfig, text: string): string {
  return createHash('sha256').update(JSON.stringify([
    'openai-pcm24-wav-v1', config.modelId, config.voiceId, config.instructions, config.speed, text,
  ])).digest('hex');
}
interface CachedRow { audio: Buffer; content_type: string; words_json: string; duration: number; }
type SentenceAudio = Pick<SpokenChunk, 'audio' | 'contentType' | 'words' | 'duration' | 'cached'>;
const PUBLIC_SENTENCES = new Set(allShippedLines().flatMap((line) => splitSentences(speakableOf(line))));
const inFlight = new Map<string, Promise<SentenceAudio>>();

async function readAudio(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error('Voice returned no audio.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw new Error('Voice audio exceeded its size limit.');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function synthesiseSentence(config: VoiceConfig, sentence: string): Promise<SentenceAudio> {
  const key = voiceCacheKey(config, sentence);
  // Exact, source-owned lines only. Do not use prefixes, caller flags, or a
  // "guest" marker: any dynamic reply may contain personal observations.
  const persist = PUBLIC_SENTENCES.has(sentence);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = (async (): Promise<SentenceAudio> => {
    const hit = persist
      ? await row<CachedRow>('SELECT audio, content_type, words_json, duration FROM voice_lines WHERE key = ?', key)
        .catch(() => undefined)
      : undefined;
    if (hit) {
      try {
        const audio = Buffer.isBuffer(hit.audio) ? hit.audio : Buffer.from(hit.audio);
        const duration = pcmOfWav(audio).length / (SAMPLE_RATE * 2);
        void run('UPDATE voice_lines SET hits = hits + 1 WHERE key = ?', key).catch(() => {});
        return { audio, contentType: 'audio/wav', words: [], duration, cached: true };
      } catch { /* Invalid legacy/corrupt audio must be generated again. */ }
    }
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.modelId, voice: config.voiceId, input: sentence,
        instructions: config.instructions, speed: config.speed, response_format: 'pcm', stream_format: 'audio' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      log.warn('voice', 'OpenAI synthesis failed', { status: response.status });
      throw new Error(`Voice synthesis failed (${response.status}).`);
    }
    const pcm = await readAudio(response);
    const audio = wavFromPCM(pcm);
    const duration = pcm.length / (SAMPLE_RATE * 2);
    if (persist) await run(
      `INSERT INTO voice_lines (key, voice_id, model_id, text, audio, content_type, words_json, duration, hits, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT (key) DO NOTHING`,
      key, config.voiceId, config.modelId, sentence, audio, 'audio/wav', '[]', duration, new Date().toISOString(),
    ).catch((err: Error) => log.warn('voice', 'could not cache line', { error: err.message }));
    return { audio, contentType: 'audio/wav', words: [], duration, cached: false };
  })();
  inFlight.set(key, request);
  try { return await request; }
  finally { if (inFlight.get(key) === request) inFlight.delete(key); }
}

/** Neighbour text is accepted for compatibility but never changes the cached voice instruction. */
export async function speakLine(text: string, _context: SpeakContext = {}): Promise<SpokenLine> {
  const config = voiceConfig();
  if (!config) throw new VoiceUnavailable();
  const cleaned = speakableOf(text).slice(0, MAX_CHARS);
  if (!cleaned) throw new Error('Nothing speakable in that line.');
  const sentences = splitSentences(cleaned);
  const chunks: SpokenChunk[] = [];
  let clock = 0, cursor = 0;
  for (const sentence of sentences) {
    const piece = await synthesiseSentence(config, sentence);
    const found = cleaned.indexOf(sentence, cursor);
    const charOffset = found >= 0 ? found : cursor;
    chunks.push({ ...piece, text: sentence, start: clock, charOffset });
    clock += piece.duration; cursor = charOffset + sentence.length;
  }
  // WAV headers cannot be concatenated. Join PCM and produce one valid header.
  const audio = chunks.length === 1 ? chunks[0].audio : wavFromPCM(Buffer.concat(chunks.map((c) => pcmOfWav(c.audio))));
  return { audio, contentType: 'audio/wav', words: [], duration: clock,
    cached: chunks.every((c) => c.cached), chunks };
}
export async function synthesise(text: string): Promise<{ audio: Buffer; contentType: string }> {
  const line = await speakLine(text);
  return { audio: line.audio, contentType: line.contentType };
}
