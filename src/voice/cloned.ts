/**
 * Evia in a real voice.
 *
 * Same shape as `Speaker` in synthesis.ts, so the character engine cannot tell
 * which one is talking — it asks for `speak(text, handlers)` and gets word
 * boundaries back either way.
 *
 * Producing those boundaries is the whole problem. The browser's synthesiser
 * fires `onboundary` as it voices each word. A cloned voice arrives as a
 * finished audio file, and the server sends the word timings the provider
 * measured alongside it — where each word actually starts in the recording.
 * The boundaries fire from those, so the lips follow the voice, not a guess.
 *
 * A line is spoken sentence by sentence. Waiting for a whole reply to
 * synthesise before the first word is the single longest silence in the app,
 * so the first sentence is requested alone and plays the moment it arrives
 * while the rest are still being made; between sentences she leaves a short
 * deliberate pause, which is where her sentence rhythm comes from. The
 * splitting mirrors the server's exactly — the server caches per sentence,
 * and matching chunks is what makes those cache rows hit.
 *
 * Two things are still read off the audio itself:
 *
 *   loudness — a WebAudio analyser samples the real envelope forty times a
 *   second, so the mouth opens when there is sound and closes in the gaps,
 *   including pauses the text gives no hint of;
 *
 *   a fallback — if a line ever arrives without timings, the words are spread
 *   across the measured duration weighted by their length, which is the old
 *   behaviour and still better than a frozen face.
 */
import type { SpeakHandle, SpeechBoundary } from './synthesis.ts';
import { audioContext, audioRunning } from '@/lib/sound.ts';

/** How often the envelope is sampled, in Hz. Fast enough for syllables. */
const ENVELOPE_HZ = 40;

/**
 * Weighting for how long a word takes to say, for the fallback schedule.
 *
 * Characters are a decent proxy, but every word carries a fixed cost too — the
 * gap between them — so a line of short words takes longer than its letter
 * count suggests.
 */
const WORD_OVERHEAD = 2.6;

/**
 * The pause she leaves between sentences, in milliseconds.
 *
 * Deliberate silence, not a buffering artefact: 250–350 ms is the band where
 * a gap reads as a breath rather than a stall, and the mouth settles closed
 * in it because the envelope really is silent. Kept in the middle of the
 * band; the next chunk is usually decoded and waiting well before it ends.
 */
const SENTENCE_GAP_MS = 300;

/**
 * What she actually says, from what the model wrote — emoji, markdown
 * residue and ragged whitespace stripped before anything is cached or sent.
 *
 * Mirrors `speakableOf` in server/voice/tts.ts, and must stay in lockstep
 * with it: both sides key their caches on this text, and a divergence means
 * every lookup misses and every line is paid for twice.
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
  /** 0..1 loudness, sampled from the real audio. Drives how open the mouth is. */
  onLevel?: (level: number) => void;
  /**
   * The licensed voice could not be reached or played.
   *
   * Separate from `onEnd` because the two mean opposite things: `onEnd` is
   * "she finished speaking", this is "she never started". Without it a network
   * blip or a spent quota would make her silently mute mid-conversation, which
   * looks like the app breaking rather than like a voice service failing.
   *
   * Fires only before any audio has played. If a later sentence of a line
   * fails, the line ends early with `onEnd` instead — she trails off rather
   * than restarting in a stranger's voice halfway through a thought.
   */
  onFailed?: (reason: string) => void;
}

export interface Word {
  charIndex: number;
  charLength: number;
  word: string;
  /** Seconds from the start of the chunk's audio. */
  at: number;
  /** Seconds this word takes in the recording, when the provider measured it. */
  duration?: number;
}

/** What the server returns for one line. */
interface SpokenLinePayload {
  audio: string;
  contentType: string;
  words: Array<{ word: string; charIndex: number; charLength: number; start: number; end: number }>;
  duration: number;
}

/** A manifest entry for a line shipped as a file. Timings arrived later; older manifests lack them. */
interface ShippedEntry {
  file: string;
  text: string;
  words?: Array<{ word: string; charIndex: number; charLength: number; start: number; end?: number; duration?: number }>;
  duration?: number;
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
    elapsed += (weights[i] / total) * duration;
  });
}

/** Decodes base64 without going through a data URL. */
function bytesOf(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

/** One fetched, decoded piece of a line, ready to play. */
interface FetchedChunk {
  buffer: AudioBuffer;
  words: Word[];
}

/** One planned piece of a line: its text, where it sits, and how to get it. */
interface ChunkPlan {
  text: string;
  /** Where this chunk's text begins in the line, for line-global boundaries. */
  charOffset: number;
  fetch: () => Promise<FetchedChunk>;
}

export class ClonedSpeaker {
  private context: AudioContext | null = null;
  private current: { stop: () => void } | null = null;
  /** Null until checked; false means the server has no voice configured. */
  private available: boolean | null = null;
  /** Which route to ask. Guests use the public one. */
  private route = '/api/voice/speak';
  /** Chunks already fetched this session, by text, so a repeat is instant and free. */
  /**
   * Decoded audio is PCM and a minute of her is tens of megabytes, so the
   * cache is bounded: past the cap the oldest entry goes. The shipped lines
   * re-decode in a blink from the HTTP cache if they come round again.
   */
  private static readonly CACHE_CAP = 24;

  private remember(key: string, chunk: FetchedChunk): void {
    if (this.lines.size >= ClonedSpeaker.CACHE_CAP) {
      const oldest = this.lines.keys().next().value;
      if (oldest !== undefined) this.lines.delete(oldest);
    }
    this.lines.set(key, chunk);
  }

  private lines = new Map<string, FetchedChunk>();
  /**
   * Lines that shipped with the app as files - the introduction, the
   * greetings, what she says when touched - synthesised once in her voice
   * and served from `/voice/`. They play whether or not the server has a
   * key, so the scripted moments sound like her on any deployment.
   */
  private shipped: Record<string, ShippedEntry> | null = null;
  /** Whether the server can synthesise new lines. */
  private serverVoice = false;

  /**
   * Asks the server whether a cloned voice exists, and whether this visitor
   * may use it.
   *
   * Checked once and remembered. A 503 here is not an error — it is the
   * documented "no key configured" state, and the caller uses it to fall back
   * to the browser voice and say so.
   */
  async prepare(guest = false): Promise<boolean> {
    this.route = guest ? '/api/public/voice/speak' : '/api/voice/speak';
    // A yes is remembered; a no is asked again. The first probe runs while
    // the server may still be waking, and a cold answer must not cost her
    // the voice for the whole session. That goes for the halves separately,
    // too: the shipped files answering does not excuse a dead health probe -
    // with `serverVoice` stuck false every composed reply is silent, and
    // there is no browser fallback to hide it once her own voice exists. So
    // a cached yes still re-asks the server, in the background, until it
    // says yes.
    if (this.available === true) {
      if (!this.serverVoice) this.reprobeServer(guest);
      return true;
    }
    const [server, shipped] = await Promise.all([
      fetch('/api/health')
        .then((r) => r.json() as Promise<{ clonedVoice?: boolean; guestVoice?: boolean }>)
        .then((body) => (guest ? body.guestVoice === true : body.clonedVoice === true))
        .catch(() => false),
      fetch('/voice/manifest.json')
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, ShippedEntry>>) : null))
        .catch(() => null),
    ]);
    this.serverVoice = server;
    this.shipped = shipped && Object.keys(shipped).length ? shipped : null;
    // Ready when either source can speak. A line the files do not cover
    // falls through to the server, and from there to the browser voice.
    this.available = server || this.shipped !== null;
    return this.available;
  }

  /** When the server was last asked whether it can synthesise, for the re-probe. */
  private lastServerProbe = 0;

  /**
   * Asks the health route again whether the server can speak, without making
   * anyone wait. Throttled to one ask every ten seconds; flips `serverVoice`
   * the moment the answer is yes, and the next line simply works.
   */
  private reprobeServer(guest: boolean): void {
    const now = Date.now();
    if (now - this.lastServerProbe < 10_000) return;
    this.lastServerProbe = now;
    void fetch('/api/health')
      .then((r) => r.json() as Promise<{ clonedVoice?: boolean; guestVoice?: boolean }>)
      .then((body) => {
        if (guest ? body.guestVoice === true : body.clonedVoice === true) this.serverVoice = true;
      })
      .catch(() => undefined);
  }

  /** Whether a given line can be spoken in her voice right now. */
  canSay(text: string): boolean {
    return this.serverVoice || (this.shipped !== null && this.shippedKey(text) in this.shipped);
  }

  /**
   * The manifest key for a line, found by its text.
   *
   * The files are named by a hash of the text, but the manifest carries the
   * text itself, so the lookup here is by exact text and the browser never
   * has to hash anything. Cached per line; the manifest is a dozen entries.
   */
  private hashCache = new Map<string, string>();
  private shippedKey(text: string): string {
    const trimmed = text.trim();
    const known = this.hashCache.get(trimmed);
    if (known) return known;
    for (const [key, entry] of Object.entries(this.shipped ?? {})) {
      if (entry.text.trim() === trimmed) {
        this.hashCache.set(trimmed, key);
        return key;
      }
    }
    return '';
  }

  get ready(): boolean {
    return this.available === true;
  }

  /**
   * Which `speak` is the live one.
   *
   * A line spends its first moments fetching and decoding, before there is a
   * source to stop. Cancelling during that window - the intro skipped, the
   * voice switched off, a newer line - has to reach it too, so every await
   * in the run checks that its generation is still the current one and
   * otherwise stops quietly, without starting audio or reporting failure.
   * A cancel partway through a multi-sentence line stops the playing chunk
   * and abandons the rest the same way.
   */
  private generation = 0;

  cancel(): void {
    this.generation++;
    this.current?.stop();
    this.current = null;
  }

  /**
   * Fetches and decodes a line ahead of time, so a scripted moment — the
   * choreography narrating each region as it lights — has no network gap
   * between the beat and the word. Multi-sentence lines are warmed chunk by
   * chunk, into the same cache `speak` reads.
   */
  async preload(text: string): Promise<boolean> {
    try {
      if (this.shipped && this.shippedKey(text)) {
        await this.fetchShipped(text);
        return true;
      }
      if (!this.serverVoice) return false;
      const sentences = splitSentences(speakableOf(text));
      for (let i = 0; i < sentences.length; i++) {
        await this.fetchChunk(sentences[i], sentences[i - 1], sentences[i + 1]);
      }
      return sentences.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * The page's one audio context, shared with the cues in lib/sound.ts.
   *
   * Shared on purpose: it is unlocked by the first gesture, and on iOS a
   * context made later - here, inside a fetch - would start suspended and
   * never run. Decoding works on a suspended context; playing does not.
   */
  private ctx(): AudioContext {
    this.context ??= audioContext();
    if (!this.context) throw new Error('no audio output in this browser');
    return this.context;
  }

  /**
   * A line that shipped as a file, whole. It was recorded as one take, so it
   * plays as one chunk; the manifest's measured word timings drive the mouth
   * when they exist, and the letter-count estimate covers older manifests.
   */
  private async fetchShipped(text: string): Promise<FetchedChunk> {
    const key = this.shippedKey(text);
    const entry = key ? this.shipped?.[key] : undefined;
    if (!entry) throw new Error('no shipped audio for this line');
    const known = this.lines.get(entry.text);
    if (known) return known;

    const file = await fetch(`/voice/${entry.file}`);
    if (!file.ok) throw new Error(`shipped voice ${file.status}`);
    const buffer = await this.ctx().decodeAudioData(await file.arrayBuffer());

    let words: Word[];
    if (entry.words?.length) {
      // Measured at synthesis time, exactly as the server path measures its
      // lines — `start` maps to `at`. Her most-played lines stop guessing.
      words = entry.words.map((w) => ({
        word: w.word,
        charIndex: w.charIndex,
        charLength: w.charLength,
        at: w.start,
        duration:
          w.end !== undefined && w.end > w.start ? w.end - w.start : w.duration,
      }));
    } else {
      words = scanWords(entry.text);
      scheduleWords(words, buffer.duration);
    }

    const chunk = { buffer, words };
    this.remember(entry.text, chunk);
    return chunk;
  }

  /**
   * One sentence from the server, decoded, with its measured timings.
   *
   * `previous_text` / `next_text` are the sentence's neighbours in the line,
   * for prosody. Today's route reads only `text` and ignores the rest, so
   * sending them costs nothing — and they start working the moment the route
   * forwards them to the synthesiser.
   */
  private async fetchChunk(sentence: string, previous?: string, next?: string): Promise<FetchedChunk> {
    const known = this.lines.get(sentence);
    if (known) return known;
    if (!this.serverVoice) throw new Error('no voice for this line');

    const response = await fetch(this.route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentence, previous_text: previous, next_text: next }),
    });
    if (!response.ok) throw new Error(`voice ${response.status}`);
    const payload = (await response.json()) as SpokenLinePayload;

    const buffer = await this.ctx().decodeAudioData(bytesOf(payload.audio));

    let words: Word[];
    if (payload.words?.length) {
      // The server measures where each word starts and ends; keep both. The
      // duration is what lets a viseme hold for the length of the word
      // instead of an estimate of it.
      words = payload.words.map((w) => ({
        word: w.word,
        charIndex: w.charIndex,
        charLength: w.charLength,
        at: w.start,
        duration: w.end > w.start ? w.end - w.start : undefined,
      }));
    } else {
      words = scanWords(sentence);
      scheduleWords(words, buffer.duration);
    }

    const chunk = { buffer, words };
    this.remember(sentence, chunk);
    return chunk;
  }

  /**
   * Speaks a line, sentence by sentence.
   *
   * The first sentence plays the moment it arrives; later ones are fetched
   * while she talks, staying one seam ahead. Word boundaries carry
   * line-global character indices but chunk-local elapsed times, matching
   * the chunk-local `at` timings — the lip sync never learns the line was
   * ever in pieces. If a sentence after the first cannot be fetched, the
   * line ends early rather than switching voices mid-thought.
   */
  speak(text: string, handlers: ClonedVoiceHandlers = {}): SpeakHandle {
    this.cancel();
    const mine = this.generation;

    let cancelled = false;
    let resolveFinished: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const abandoned = () => cancelled || mine !== this.generation;

    const run = async () => {
      // Plan the chunks before any network. A shipped file plays whole — it
      // was recorded as one take, pauses included; anything else is split
      // exactly the way the server splits it.
      let plans: ChunkPlan[];
      if (this.shipped && this.shippedKey(text)) {
        plans = [{ text: text.trim(), charOffset: 0, fetch: () => this.fetchShipped(text) }];
      } else {
        const cleaned = speakableOf(text);
        const sentences = splitSentences(cleaned);
        if (!sentences.length) {
          // Nothing speakable — an emoji-only line, say. Nothing to voice is
          // not a failure; the line simply has no sound.
          handlers.onEnd?.();
          resolveFinished();
          return;
        }
        let cursor = 0;
        plans = sentences.map((sentence, i) => {
          const found = cleaned.indexOf(sentence, cursor);
          const charOffset = found >= 0 ? found : cursor;
          cursor = charOffset + sentence.length;
          return {
            text: sentence,
            charOffset,
            fetch: () => this.fetchChunk(sentence, sentences[i - 1], sentences[i + 1]),
          };
        });
      }

      // Fetches, started at most once each. The first two go out now: the
      // first for the shortest possible silence before she speaks, the
      // second so the first seam has its audio ready; from there each chunk
      // that starts playing sends for the one two ahead.
      const inFlight: Array<Promise<FetchedChunk> | null> = plans.map(() => null);
      const chunkAt = (i: number): Promise<FetchedChunk> => (inFlight[i] ??= plans[i].fetch());
      void chunkAt(0);
      if (plans.length > 1) void chunkAt(1).catch(() => {});

      let first: FetchedChunk;
      try {
        first = await chunkAt(0);
        if (abandoned()) {
          resolveFinished();
          return;
        }
        // The context has to be running, not merely resumed: a suspended one
        // plays silence while its clock stands still, which is no sound, no
        // word boundaries, and a mouth moving over nothing. Better to fail
        // here and let the caller fall back or keep the mouth closed.
        if (!(await audioRunning())) {
          throw new Error('audio output is locked until the page is touched');
        }
      } catch (err) {
        // Hand it back so the caller can fall back to the browser voice. Going
        // quiet is not an acceptable outcome for a character who talks - but a
        // line nobody wants any more fails silently.
        if (!abandoned()) handlers.onFailed?.((err as Error).message);
        resolveFinished();
        return;
      }
      if (abandoned() || !this.context) {
        resolveFinished();
        return;
      }

      const context = this.context;
      // One analyser for the whole line, so the envelope smoothing carries
      // across sentence seams instead of resetting to a closed mouth and
      // snapping open again.
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      // Short window: the mouth should follow syllables, not paragraphs.
      analyser.smoothingTimeConstant = 0.35;
      analyser.connect(context.destination);

      const samples = new Uint8Array(analyser.frequencyBinCount);
      let level = 0;
      /** The chunk being voiced right now; null in the pauses between them. */
      let playing: { words: Word[]; startedAt: number; charOffset: number; next: number } | null = null;
      let activeSource: AudioBufferSourceNode | null = null;
      let gapTimer = 0;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        window.clearInterval(tick);
        window.clearTimeout(gapTimer);
        try {
          analyser.disconnect();
        } catch {
          // Already disconnected; the context may even be closing.
        }
        handlers.onLevel?.(0);
        if (this.current === handle) this.current = null;
        handlers.onEnd?.();
        resolveFinished();
      };

      // Timed off the audio clock, not the wall clock: the two drift apart
      // under load, and the boundaries have to land on the recording.
      const tick = window.setInterval(() => {
        // Envelope: RMS over the current window, lightly curved so quiet
        // speech still opens the mouth a little.
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const v = (samples[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / samples.length);
        const raw = Math.min(1, Math.pow(rms * 3.2, 0.75));
        // Fast to open, slow to close: the mouth answers the syllable, not
        // every ripple inside it. Per 25 ms sample, roughly 40 ms attack and
        // 120 ms release.
        level += (raw - level) * (raw > level ? 0.55 : 0.2);
        handlers.onLevel?.(level);

        // Between sentences the pause is real: no words fire, and the
        // envelope above closes the mouth on actual silence.
        if (!playing) return;
        const elapsed = context.currentTime - playing.startedAt;
        while (playing.next < playing.words.length && playing.words[playing.next].at <= elapsed) {
          const word = playing.words[playing.next++];
          handlers.onBoundary?.({
            charIndex: playing.charOffset + word.charIndex,
            charLength: word.charLength,
            word: word.word,
            elapsed,
            duration: word.duration,
          });
        }
      }, 1000 / ENVELOPE_HZ);

      const startChunk = (index: number, chunk: FetchedChunk) => {
        if (abandoned()) {
          finish();
          return;
        }
        const source = context.createBufferSource();
        source.buffer = chunk.buffer;
        source.connect(analyser);
        activeSource = source;
        playing = {
          words: chunk.words,
          startedAt: context.currentTime,
          charOffset: plans[index].charOffset,
          next: 0,
        };
        // Stay one seam ahead: the chunk after next starts fetching now, so
        // by the time its turn comes it is usually decoded and waiting.
        if (index + 2 < plans.length) void chunkAt(index + 2).catch(() => {});

        source.onended = () => {
          if (activeSource === source) activeSource = null;
          playing = null;
          if (abandoned() || index + 1 >= plans.length) {
            finish();
            return;
          }
          gapTimer = window.setTimeout(() => {
            chunkAt(index + 1)
              .then((next) => {
                if (abandoned()) finish();
                else startChunk(index + 1, next);
              })
              // A later chunk failing ends the line early; see `speak` doc.
              .catch(() => finish());
          }, SENTENCE_GAP_MS);
        };

        source.start();
      };

      const handle = {
        stop: () => {
          cancelled = true;
          try {
            activeSource?.stop();
          } catch {
            // Already stopped; `onended` has run or is about to.
          }
          finish();
        },
      };
      this.current = handle;

      handlers.onStart?.();
      startChunk(0, first);
    };

    void run();

    return {
      cancel: () => {
        cancelled = true;
        this.cancel();
      },
      finished,
    };
  }

  dispose(): void {
    this.cancel();
    // The context is the page's, not this speaker's; it stays open for the cues.
    this.context = null;
    this.lines.clear();
  }
}
