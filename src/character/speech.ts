/**
 * Mouth motion (brief §21, §22).
 *
 * Two tracks behind one interface:
 *
 * - `EstimatedSpeechTrack` derives a viseme timeline from the letters alone. Used
 *   when there is no audio — text-only replies, or a voice that reports no
 *   timing.
 * - `AudioLockedSpeechTrack` is driven by the speech engine's word-boundary
 *   events, so the mouth moves with the actual voice rather than alongside it.
 *   It measures the real cadence as it goes instead of assuming one.
 *
 * Both emit the same `MouthState`, so the avatar never learns which is playing.
 */
import type { Viseme } from '@shared/types.ts';
import { clamp } from '@/lib/math.ts';

export interface MouthState {
  viseme: Viseme;
  weight: number;
  level: number;
}

export interface SpeechTrackLike {
  advance(dt: number): MouthState;
  readonly finished: boolean;
  /**
   * True once each time the track enters a silence of at least
   * `PHRASE_GAP_SECONDS` — the boundary between phrases. The director polls
   * this to time gestures to her actual phrasing rather than to a clock.
   * Optional so a bare ad-hoc track still satisfies the interface; both
   * shipped tracks implement it.
   */
  consumePhrase?(): boolean;
}

const SILENT: MouthState = { viseme: 'sil', weight: 0, level: 0 };

/**
 * How long the mouth has to be quiet before the quiet counts as a phrase
 * boundary rather than an articulation gap. The same length as the mouth
 * hold in the sprite rig, for the same reason: anything shorter than this
 * is inside a word, not between thoughts.
 */
const PHRASE_GAP_SECONDS = 0.13;

/**
 * A track's timing with its lips held shut.
 *
 * The director keys beat gestures and the settle-back to a running track, so
 * a line that will not be heard - voice off, audio locked, a cancelled
 * utterance - still needs its timing to run. What it must not do is mime.
 * This wraps any track, advances it as normal, and reports silence.
 */
export class MutedSpeechTrack implements SpeechTrackLike {
  private readonly inner: SpeechTrackLike;

  constructor(inner: SpeechTrackLike) {
    this.inner = inner;
  }

  get finished(): boolean {
    return this.inner.finished;
  }

  advance(dt: number): MouthState {
    this.inner.advance(dt);
    return SILENT;
  }

  /** The phrasing is the inner track's; only the sound is withheld. */
  consumePhrase(): boolean {
    return this.inner.consumePhrase?.() ?? false;
  }
}

const VOWEL_MAP: Record<string, Viseme> = {
  a: 'AA',
  e: 'EE',
  i: 'IH',
  o: 'OH',
  u: 'OU',
  y: 'IH',
};

const CONSONANT_MAP: Record<string, Viseme> = {
  m: 'MBP',
  b: 'MBP',
  p: 'MBP',
  f: 'FV',
  v: 'FV',
  l: 'L',
  s: 'S',
  z: 'S',
  c: 'S',
  x: 'S',
  j: 'S',
};

interface Phone {
  viseme: Viseme;
  /** Relative weight of this phone within its word, used to apportion time. */
  span: number;
  energy: number;
}

/** Roughly conversational pace, used only when nothing better is known. */
const BASE_PHONE_SECONDS = 0.075;

/** Breaks one word into visemes. Vowels carry the energy and the duration. */
function phonemesForWord(word: string): Phone[] {
  const phones: Phone[] = [];
  for (const ch of word.toLowerCase()) {
    if (!/[a-z]/.test(ch)) continue;
    const vowel = VOWEL_MAP[ch];
    const consonant = CONSONANT_MAP[ch];

    if (vowel) phones.push({ viseme: vowel, span: 1.35, energy: 0.85 });
    else if (consonant) phones.push({ viseme: consonant, span: 0.8, energy: 0.45 });
    // Unmapped consonants still move the jaw slightly rather than freezing it.
    else phones.push({ viseme: 'IH', span: 0.7, energy: 0.3 });
  }
  return phones.length ? phones : [{ viseme: 'sil', span: 1, energy: 0 }];
}

/** Ease in and out of each phone so the mouth flows rather than stepping. */
const shape = (local: number): number => Math.sin(clamp(local) * Math.PI);

// ---------------------------------------------------------------------------
// Estimated (no audio)
// ---------------------------------------------------------------------------

interface TimedPhone extends Phone {
  start: number;
  duration: number;
}

export class EstimatedSpeechTrack implements SpeechTrackLike {
  private phones: TimedPhone[] = [];
  private time = 0;
  private total = 0;
  private cursor = 0;
  /** Start times of every silence long enough to be a phrase boundary. */
  private phraseTimes: number[] = [];
  private phraseCursor = 0;
  private phrasePending = false;

  constructor(text: string) {
    let t = 0;
    const push = (phone: Phone, duration: number) => {
      this.phones.push({ ...phone, start: t, duration });
      t += duration;
    };

    for (const token of text.split(/(\s+|[.!?,;:—-])/)) {
      if (!token) continue;
      if (/^[.!?]$/.test(token)) {
        // A real sentence break, not a beat. The browser voices pause hard at
        // a full stop, and a mouth that sprints through the gap decouples from
        // the keyless demo's own pacing.
        push({ viseme: 'sil', span: 1, energy: 0 }, 0.55);
      } else if (/^[,;:—-]$/.test(token)) {
        push({ viseme: 'sil', span: 1, energy: 0 }, 0.22);
      } else if (/^\s+$/.test(token)) {
        t += 0.03; // words run together; only a small gap between them
      } else {
        for (const phone of phonemesForWord(token)) {
          push(phone, BASE_PHONE_SECONDS * phone.span);
        }
      }
    }

    // A beat of silence so the mouth closes rather than freezing open.
    push({ viseme: 'sil', span: 1, energy: 0 }, 0.2);
    this.total = t;

    /*
     * Phrase boundaries, read off the timeline while it is still whole.
     *
     * A boundary is any stretch of quiet — sil phones and the small unphoned
     * gaps between words, merged when adjacent — long enough to be a pause
     * rather than an articulation gap. Knowing the timeline means the flag can
     * fire the instant the pause *starts*, which is when a gesture keyed to it
     * should land. Quiet at t=0 is a leading pause, not the end of a phrase.
     */
    let runStart = -1;
    let runEnd = -1;
    const flush = () => {
      if (runStart > 1e-6 && runEnd - runStart >= PHRASE_GAP_SECONDS) {
        this.phraseTimes.push(runStart);
      }
      runStart = -1;
    };
    let end = 0; // where the previous phone finished
    for (const phone of this.phones) {
      if (phone.start > end + 1e-6) {
        if (runStart < 0) runStart = end;
        runEnd = phone.start;
      }
      if (phone.viseme === 'sil') {
        if (runStart < 0) runStart = phone.start;
        runEnd = phone.start + phone.duration;
      } else {
        flush();
      }
      end = phone.start + phone.duration;
    }
    flush();
  }

  get duration(): number {
    return this.total;
  }

  get finished(): boolean {
    return this.time >= this.total;
  }

  /** True once per phrase boundary crossed; see `SpeechTrackLike`. */
  consumePhrase(): boolean {
    const pending = this.phrasePending;
    this.phrasePending = false;
    return pending;
  }

  advance(dt: number): MouthState {
    this.time += dt;
    // Before the finished check, so the closing silence still registers as
    // the utterance's final boundary. Boundaries collapsed between two polls
    // report once, which at frame rate cannot actually happen: gaps are at
    // least PHRASE_GAP_SECONDS apart by construction.
    while (
      this.phraseCursor < this.phraseTimes.length &&
      this.time >= this.phraseTimes[this.phraseCursor]
    ) {
      this.phraseCursor++;
      this.phrasePending = true;
    }
    if (this.finished) return SILENT;

    // Walk forward from where we left off — the timeline only moves one way, so
    // rescanning from the start every frame would be wasted work.
    while (
      this.cursor < this.phones.length - 1 &&
      this.time >= this.phones[this.cursor].start + this.phones[this.cursor].duration
    ) {
      this.cursor++;
    }

    const phone = this.phones[this.cursor];
    if (!phone || this.time < phone.start) return SILENT;

    const s = shape((this.time - phone.start) / phone.duration);
    return {
      viseme: phone.viseme,
      weight: 0.35 + 0.65 * s,
      level: phone.energy * (0.55 + 0.45 * s),
    };
  }
}

// ---------------------------------------------------------------------------
// Audio-locked (driven by the speech engine)
// ---------------------------------------------------------------------------

/**
 * Driven by word-boundary events from the speech engine.
 *
 * Each boundary tells us a word started *now*. We do not know how long it will
 * last, so the track spreads that word's visemes over an estimate that is
 * continuously corrected by the measured interval between the last two
 * boundaries. In practice the mouth locks to the voice within two words.
 */
export class AudioLockedSpeechTrack implements SpeechTrackLike {
  private phones: Phone[] = [];
  private phoneStarts: number[] = [];
  private wordDuration = 0.32;
  /**
   * How long the word now on the lips actually lasts. The rolling estimate
   * when that is all we have; the measured duration when the engine supplied
   * one to `beginWord`.
   */
  private currentWordSeconds = 0.32;
  private elapsed = 0;
  private wordStartedAt = 0;
  private lastBoundaryAt = -1;
  private ended = false;
  /** Seconds of unbroken quiet, and whether this quiet was already reported. */
  private silenceRun = 0;
  private phraseFlagged = false;
  private phrasePending = false;
  /** True until the first boundary arrives, so callers can fall back. */
  private awaitingFirstBoundary = true;
  /**
   * Loudness measured from the actual audio, when there is any.
   *
   * The browser synthesiser gives words and no waveform, so the level has to be
   * inferred from which phone is being said. A cloned voice arrives as real
   * audio, and an envelope read off it knows things the text cannot — where she
   * paused, which syllable she leaned on. Null means nobody is measuring and
   * the phone's own energy stands.
   */
  private measuredLevel: number | null = null;

  get finished(): boolean {
    return this.ended;
  }

  get receivedTiming(): boolean {
    return !this.awaitingFirstBoundary;
  }

  /**
   * Called from the speech engine's boundary event.
   *
   * `knownDuration` is the word's measured length in seconds, for engines that
   * report one. It is used directly; the rolling estimate stays as the
   * fallback for engines that only ever say a word *started*.
   */
  beginWord(word: string, elapsedSeconds: number, knownDuration?: number): void {
    // Correct the pace estimate from the interval actually observed.
    if (this.lastBoundaryAt >= 0) {
      const observed = elapsedSeconds - this.lastBoundaryAt;
      if (observed > 0.02 && observed < 2) {
        // Smoothed, so one long word does not slow the whole mouth down.
        this.wordDuration = this.wordDuration * 0.55 + observed * 0.45;
      }
    }
    this.lastBoundaryAt = elapsedSeconds;
    this.awaitingFirstBoundary = false;

    // Sanity-bounded like the observed intervals: a zero or an hour from a
    // misbehaving engine must not freeze the mouth on one shape.
    const measured =
      knownDuration !== undefined && Number.isFinite(knownDuration) && knownDuration > 0.02 && knownDuration < 5
        ? knownDuration
        : null;
    this.currentWordSeconds = measured ?? this.wordDuration;

    this.phones = phonemesForWord(word);
    const totalSpan = this.phones.reduce((sum, p) => sum + p.span, 0) || 1;

    // Apportion the word duration across its phones by span.
    this.phoneStarts = [];
    let cursor = 0;
    for (const phone of this.phones) {
      this.phoneStarts.push(cursor);
      cursor += (phone.span / totalSpan) * this.currentWordSeconds;
    }
    this.wordStartedAt = this.elapsed;
    // A new word ends whatever quiet was accumulating.
    this.silenceRun = 0;
    this.phraseFlagged = false;
  }

  /** Reports the real loudness of the audio being played, 0..1. */
  setLevel(level: number): void {
    this.measuredLevel = Number.isFinite(level) ? clamp(level) : 0;
  }

  end(): void {
    this.ended = true;
    this.measuredLevel = null;
  }

  /** True once per phrase boundary entered; see `SpeechTrackLike`. */
  consumePhrase(): boolean {
    const pending = this.phrasePending;
    this.phrasePending = false;
    return pending;
  }

  advance(dt: number): MouthState {
    const state = this.step(dt);
    /*
     * Phrase accounting. This track cannot see its future the way the
     * estimated one can, so a boundary is recognised the moment enough quiet
     * has actually elapsed: the past-end-of-word state below, with nothing
     * audible on the envelope. Quiet before the first boundary is the engine
     * warming up, not a phrase — unless the track already ended, in which
     * case the utterance's close still deserves its tick.
     */
    const quiet = state.viseme === 'sil' && state.level < 0.12;
    if (!quiet || (this.awaitingFirstBoundary && !this.ended)) {
      this.silenceRun = 0;
      this.phraseFlagged = false;
    } else {
      this.silenceRun += dt;
      if (!this.phraseFlagged && this.silenceRun >= PHRASE_GAP_SECONDS) {
        this.phraseFlagged = true;
        this.phrasePending = true;
      }
    }
    return state;
  }

  private step(dt: number): MouthState {
    this.elapsed += dt;
    if (this.ended || this.phones.length === 0) return SILENT;
    // Once a waveform is available it is the authority. Estimated phoneme
    // energy must not keep the jaw, emphasis gestures or phrase timer alive
    // through a real audio pause.
    if (this.measuredLevel === 0) return SILENT;

    const local = this.elapsed - this.wordStartedAt;
    if (local < 0) return SILENT;

    // Find the phone this instant falls in.
    let index = this.phoneStarts.length - 1;
    for (let i = 0; i < this.phoneStarts.length; i++) {
      if (local < this.phoneStarts[i]) {
        index = Math.max(0, i - 1);
        break;
      }
    }

    const start = this.phoneStarts[index];
    const nextStart = this.phoneStarts[index + 1] ?? this.currentWordSeconds;
    const duration = Math.max(0.02, nextStart - start);

    // Past the end of the word and no new boundary yet: close towards rest
    // rather than holding the last shape open.
    if (local > this.currentWordSeconds * 1.6) {
      // With a real envelope, silence between words is audible rather than
      // assumed: if she is still making sound, the mouth stays open for it.
      const level = this.measuredLevel ?? 0.05;
      return { viseme: 'sil', weight: Math.min(0.45, 0.2 + level), level };
    }

    const phone = this.phones[index];
    const s = shape((local - start) / duration);
    const shaped = phone.energy * (0.55 + 0.45 * s);
    // With a real envelope the audio decides whether the mouth is open at
    // all: a pause the text does not show, or a syllable she swallowed,
    // closes it. Without one the text's own shape stands.
    const gate = this.measuredLevel === null ? 1 : clamp(this.measuredLevel * 2.6);
    return {
      viseme: phone.viseme,
      // The word says which shape; the waveform says how far into it.
      weight: (0.35 + 0.65 * s) * gate,
      level: this.measuredLevel ?? shaped,
    };
  }
}

/** Kept as the default export name used by the director. */
export { EstimatedSpeechTrack as SpeechTrack };
