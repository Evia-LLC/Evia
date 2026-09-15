/**
 * Elohim's voice (brief §21).
 *
 * She has always spoken through the browser's own speech synthesis: free,
 * offline, no key — and unmistakably a robot reading a script. A licensed human
 * voice, cloned, is the difference between an app that talks and a person who
 * does.
 *
 * The problem it solves is that you cannot pre-record her. She says whatever
 * the conversation needs, so every line has to be synthesised on demand from a
 * model trained once on the licensed recording.
 *
 * Three rules this module exists to enforce:
 *
 *  1. The key stays on the server. A voice API key in the browser is a key
 *    anyone can lift and spend, exactly like `ANTHROPIC_API_KEY`.
 *  2. Absence is reported, never faked. With no key configured the app says so
 *    and falls back to the browser voice, the same way it already says so when
 *    there is no model and no blob key. It never silently substitutes.
 *  3. A line is paid for once. The audio and its word timings are cached in
 *    the database by (voice, model, sentence) — the sentence, not the reply,
 *    because openers and short acknowledgements repeat across conversations
 *    where whole replies never do. The greeting, the choreography and every
 *    repeated phrase cost nothing after the first time.
 *
 * Timing is the part that makes her mouth hers. The provider returns a
 * character-level alignment with the audio, which is reduced here to one start
 * time per word. The client fires its word boundaries from those, so the lips
 * follow the recording rather than an estimate spread over its length.
 */
import { createHash } from 'node:crypto';
import { row, run } from '../db/index.ts';
import { log } from '../lib/log.ts';

/** ElevenLabs. Overridable for a different provider with the same contract. */
const DEFAULT_ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';

export interface VoiceConfig {
  apiKey: string;
  voiceId: string;
  endpoint: string;
  modelId: string;
}

export function voiceConfig(): VoiceConfig | null {
  const apiKey = process.env.ELOHIM_VOICE_API_KEY;
  const voiceId = process.env.ELOHIM_VOICE_ID;
  if (!apiKey || !voiceId) return null;
  return {
    apiKey,
    voiceId,
    endpoint: process.env.ELOHIM_VOICE_ENDPOINT ?? DEFAULT_ENDPOINT,
    // Turbo for the live path: she answers in conversation, and the seconds
    // a richer model spends on a nicer render are seconds she stands silent.
    // The offline batch (scripts/voice-lines-synth.mjs) keeps multilingual/v3
    // for the shipped lines, where render quality wins and latency is free.
    // The env override still decides, when set.
    modelId: process.env.ELOHIM_VOICE_MODEL ?? 'eleven_turbo_v2_5',
  };
}

export function clonedVoiceAvailable(): boolean {
  return voiceConfig() !== null;
}

/** Whether someone without an account may hear the cloned voice. */
export function guestVoiceAllowed(): boolean {
  return clonedVoiceAvailable() && process.env.ELOHIM_GUEST_VOICE !== '0';
}

export class VoiceUnavailable extends Error {
  constructor() {
    super('No cloned voice is configured (ELOHIM_VOICE_API_KEY / ELOHIM_VOICE_ID unset).');
    this.name = 'VoiceUnavailable';
  }
}

/**
 * The longest line she will ever be asked to say.
 *
 * A cap rather than a trust: text length is the billing unit, and an unbounded
 * one is an unbounded bill. Her replies are conversational; anything past this
 * is a bug upstream, not a long sentence.
 */
const MAX_CHARS = 1200;

/**
 * What she actually says, from what the model wrote.
 *
 * The model decorates - an emoji here, a stray asterisk of markdown there -
 * and a voice reads decoration out loud ("sparkles") or stumbles over it.
 * Cleaning happens here, at the entry, because the cache keys on the cleaned
 * text: two replies that differ only in decoration are the same spoken line
 * and must land on the same row.
 *
 * Mirrored in src/voice/cloned.ts, which cleans before its own cache lookup.
 * The two copies must stay in lockstep or every client lookup misses.
 */
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

/** One spoken word and when it starts, in seconds from the start of the audio. */
export interface SpokenWord {
  word: string;
  charIndex: number;
  charLength: number;
  start: number;
  end: number;
}

/** One synthesised sentence of a line. Indices and times are chunk-local. */
export interface SpokenChunk {
  /** The sentence as sent to the provider (already cleaned). */
  text: string;
  audio: Buffer;
  contentType: string;
  words: SpokenWord[];
  duration: number;
  /** Seconds from the start of the concatenated line to this chunk's audio. */
  start: number;
  /** Where this chunk's text begins in the cleaned line. */
  charOffset: number;
  cached: boolean;
}

/**
 * Text around the line, for prosody. A sentence read with its neighbours in
 * mind lands differently from one read cold; within a line the neighbours
 * are known here, and a caller speaking sentence-by-sentence can supply the
 * edges once the route forwards them.
 */
export interface SpeakContext {
  previousText?: string;
  nextText?: string;
}

export interface SpokenLine {
  /**
   * All chunks butt-joined. MPEG audio is a frame stream, so the
   * concatenation decodes as one continuous recording, and `words` below
   * carries line-global indices and times to match - which keeps this shape
   * byte-compatible with what the routes have always serialised.
   */
  audio: Buffer;
  contentType: string;
  words: SpokenWord[];
  duration: number;
  /** True only when every sentence came from the cache. */
  cached: boolean;
  /**
   * The per-sentence pieces, for a route that wants to stream them with
   * their own timings. The current routes serialise the flat fields above
   * and drop this - existing consumers see exactly what they always did.
   */
  chunks: SpokenChunk[];
}

/** What ElevenLabs returns from the with-timestamps endpoint. */
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

/** Evenly spread timings, for a provider that returned audio and nothing else. */
function estimatedWords(text: string, duration: number): SpokenWord[] {
  const matches = [...text.matchAll(/\S+/g)];
  const weights = matches.map((m) => m[0].length + 2.6);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return matches.map((m, k) => {
    const span = (weights[k] / total) * duration;
    const word = { word: m[0], charIndex: m.index ?? 0, charLength: m[0].length, start: t, end: t + span };
    t += span;
    return word;
  });
}

/** MP3 frame walk is overkill; the alignment's last end time is the duration we need. */
function durationOf(words: SpokenWord[], bytes: number): number {
  if (words.length) return words[words.length - 1].end;
  // ~128 kbps as a rough floor when nothing better is known.
  return bytes / 16_000;
}

function cacheKey(config: VoiceConfig, text: string): string {
  return createHash('sha256')
    .update(`${config.voiceId}\n${config.modelId}\n${text}`)
    .digest('hex');
}

interface CachedRow {
  audio: Buffer;
  content_type: string;
  words_json: string;
  duration: number;
}

/**
 * Synthesises one sentence — or serves it from the cache.
 *
 * The cache keys on the cleaned sentence, not the full reply: her openers
 * repeat across conversations where whole replies almost never do, so this
 * is where the hits actually are. (Rows keyed on full replies by the old
 * scheme are orphaned, not wrong — they simply stop being found.)
 */
async function synthesiseSentence(
  config: VoiceConfig,
  sentence: string,
  context: SpeakContext,
): Promise<{ audio: Buffer; contentType: string; words: SpokenWord[]; duration: number; cached: boolean }> {
  const key = cacheKey(config, sentence);

  const hit = await row<CachedRow>(
    'SELECT audio, content_type, words_json, duration FROM voice_lines WHERE key = ?',
    key,
  ).catch(() => undefined);
  if (hit) {
    void run('UPDATE voice_lines SET hits = hits + 1 WHERE key = ?', key).catch(() => {});
    return {
      audio: Buffer.isBuffer(hit.audio) ? hit.audio : Buffer.from(hit.audio),
      contentType: hit.content_type,
      words: JSON.parse(hit.words_json) as SpokenWord[],
      duration: hit.duration,
      cached: true,
    };
  }

  const response = await fetch(
    `${config.endpoint}/${config.voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: sentence,
        model_id: config.modelId,
        // The neighbouring sentences, so each chunk is read as part of the
        // line rather than cold: intonation falls where the thought actually
        // ends, not at every chunk boundary.
        ...(context.previousText ? { previous_text: context.previousText } : {}),
        ...(context.nextText ? { next_text: context.nextText } : {}),
        voice_settings: {
          // Directed rather than flat. Lower stability and more style than
          // the launch settings, because a consultant who never varies her
          // delivery reads as a kiosk; the sentence-level pauses and context
          // above keep the expressiveness from tipping into performance.
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    log.error('voice', 'synthesis failed', {
      status: response.status,
      detail: detail.slice(0, 300),
    });
    throw new Error(`Voice synthesis failed (${response.status}).`);
  }

  const payload = (await response.json()) as AlignedResponse;
  const audio = Buffer.from(payload.audio_base64, 'base64');
  const alignment = payload.alignment ?? payload.normalized_alignment ?? null;
  let words = alignment ? wordsFromAlignment(sentence, alignment) : [];
  const duration = durationOf(words, audio.length);
  if (!words.length) words = estimatedWords(sentence, duration);

  await run(
    `INSERT INTO voice_lines (key, voice_id, model_id, text, audio, content_type, words_json, duration, hits, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT (key) DO NOTHING`,
    key,
    config.voiceId,
    config.modelId,
    sentence,
    audio,
    'audio/mpeg',
    JSON.stringify(words),
    duration,
    new Date().toISOString(),
  ).catch((err: Error) => log.warn('voice', 'could not cache line', { error: err.message }));

  log.info('voice', 'line synthesised', { chars: sentence.length, words: words.length, duration });
  return { audio, contentType: 'audio/mpeg', words, duration, cached: false };
}

/**
 * Synthesises `text` — or serves it from the cache — with word timings.
 *
 * The line is cleaned, split into sentences, and synthesised (and cached)
 * per sentence, each with its neighbours as prosody context. The flat fields
 * of the result are the concatenation, indistinguishable from the old
 * single-request shape; `chunks` carries the per-sentence pieces for a route
 * that wants to hand them out one at a time.
 *
 * Throws `VoiceUnavailable` when unconfigured so the caller can degrade
 * honestly rather than returning silence that looks like a failed download.
 */
export async function speakLine(text: string, context: SpeakContext = {}): Promise<SpokenLine> {
  const config = voiceConfig();
  if (!config) throw new VoiceUnavailable();

  const cleaned = speakableOf(text).slice(0, MAX_CHARS);
  if (!cleaned) throw new Error('Nothing speakable in that line.');
  const sentences = splitSentences(cleaned);

  const chunks: SpokenChunk[] = [];
  let clock = 0;
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const piece = await synthesiseSentence(config, sentence, {
      previousText: i > 0 ? sentences[i - 1] : context.previousText,
      nextText: i < sentences.length - 1 ? sentences[i + 1] : context.nextText,
    });
    // Sentences are verbatim slices of the cleaned text, so indexOf finds
    // each one; the cursor keeps a repeated sentence from matching twice.
    const found = cleaned.indexOf(sentence, cursor);
    const charOffset = found >= 0 ? found : cursor;
    chunks.push({ ...piece, text: sentence, start: clock, charOffset });
    clock += piece.duration;
    cursor = charOffset + sentence.length;
  }

  const words = chunks.flatMap((chunk) =>
    chunk.words.map((w) => ({
      ...w,
      charIndex: w.charIndex + chunk.charOffset,
      start: w.start + chunk.start,
      end: w.end + chunk.start,
    })),
  );

  return {
    audio: Buffer.concat(chunks.map((c) => c.audio)),
    contentType: chunks[0]?.contentType ?? 'audio/mpeg',
    words,
    duration: clock,
    cached: chunks.every((c) => c.cached),
    chunks,
  };
}

/** Kept for callers that only want bytes. */
export async function synthesise(text: string): Promise<{ audio: Buffer; contentType: string }> {
  const line = await speakLine(text);
  return { audio: line.audio, contentType: line.contentType };
}
