/**
 * Text-to-speech (brief §21).
 *
 * Uses the browser's own speech synthesis: no key, no network, no per-word cost,
 * and it works offline. The interface is deliberately narrow so a cloud voice
 * (ElevenLabs, or Anthropic's if it ships) can replace the implementation
 * without the character engine noticing.
 *
 * The important part is `onBoundary`: it fires as each word is actually spoken,
 * which is what lets the mouth be driven by real speech timing instead of an
 * estimate. That is the difference between lip-sync and a mouth flapping.
 */

export interface SpeechBoundary {
  /** Index into the utterance text of the word starting now. */
  charIndex: number;
  charLength: number;
  word: string;
  /** Seconds since the utterance began. */
  elapsed: number;
  /**
   * Seconds this word takes to say, when the engine measured it. The cloned
   * voice knows — the provider aligns every character of the recording — and
   * passes it so the viseme can hold for the word's real length. The browser
   * synthesiser reports no such thing, so it stays optional and absent here.
   */
  duration?: number;
}

export interface SpeakHandle {
  cancel(): void;
  readonly finished: Promise<void>;
}

export interface VoiceProfile {
  voiceURI: string | null;
  rate: number;
  pitch: number;
}

/**
 * Evia's default voice settings — a touch under normal pace, natural pitch.
 *
 * The browser voice is her stand-in, and a stand-in should at least keep her
 * pace: the cloned voice is unhurried, so a bright, quick fallback made the
 * downgrade audible twice over. Slightly slow reads as considered; raised
 * pitch reads as chirpy, which she is not.
 */
export const DEFAULT_VOICE: VoiceProfile = { voiceURI: null, rate: 0.97, pitch: 1.0 };

/**
 * iOS keeps the synthesiser behind a gesture gate of its own.
 *
 * WebKit on iPhone and iPad drops any `speechSynthesis.speak()` that is not
 * running inside a user gesture - no start, no boundary, no end, no error -
 * until one call has been made from a gesture. Everything this app says is
 * asynchronous relative to the tap that caused it, so nothing would ever
 * lift the gate on its own. `primeSynthesis` lifts it from the same first
 * touch that unlocks audio, and until that has happened the synthesiser is
 * reported as unavailable on those devices rather than as a voice that
 * silently swallows lines. iPadOS presents itself as a Mac with a touch
 * screen, hence the second test.
 */
const IOS_FAMILY =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
let synthesisPrimed = false;

/** The API exists. Listing voices needs nothing more, on any platform. */
export function hasSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Call synchronously from a gesture handler. Returns true the one time the
 * gate is observed to open, so the caller can re-resolve what she can do.
 *
 * WebKit does not throw for a gated call; it drops the utterance before
 * queueing it. An accepted one becomes current or pending at once, and that
 * is the only observable difference - so on iOS the flag is taken from that,
 * and every later gesture tries again until one is honoured. An empty
 * utterance is used because WebKit lifts the restriction at the top of
 * speak(), before it looks at the text, and other engines finish it at once
 * without a sound.
 */
export function primeSynthesis(): boolean {
  if (synthesisPrimed || !hasSynthesis()) return false;
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    synthesisPrimed = !IOS_FAMILY || speechSynthesis.speaking || speechSynthesis.pending;
  } catch {
    synthesisPrimed = false;
  }
  return synthesisPrimed;
}

/** Whether a line spoken right now would actually be heard. */
export function synthesisAvailable(): boolean {
  return hasSynthesis() && (!IOS_FAMILY || synthesisPrimed);
}

/**
 * Voice list loads asynchronously in most browsers and is empty on first call.
 * Resolves once it is populated, or after a short grace period on browsers that
 * never fire the event.
 */
export function listVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  if (!hasSynthesis()) return Promise.resolve([]);
  const existing = speechSynthesis.getVoices();
  if (existing.length) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, timeoutMs);
  });
}

/** Names that indicate the higher-quality synthesis engines. */
const QUALITY = /natural|neural|premium|enhanced|online|google|siri/i;

/**
 * Voices that read as feminine. Evia is consistently "she" throughout the
 * product, so defaulting to a masculine voice is a character bug, not a
 * cosmetic one.
 *
 * This is a *default*, not a constraint — the user can pick any installed voice
 * in preferences, and that choice always wins.
 */
const FEMININE =
  /\b(female|woman)\b|zira|aria|jenny|libby|sonia|michelle|ana|samantha|karen|moira|tessa|fiona|catherine|hazel|susan|allison|ava|serena|nora|amelie|joanna|salli|kendra|kimberly|ivy|emma|amy|nicole|olivia|aisha|ayanda|imani|asilia|ebele/i;

/**
 * Picks the most suitable available voice for a locale.
 *
 * Ordering matters: identity first, then engine quality. A crisp voice of the
 * wrong character is worse than a plain one of the right character.
 */
export async function pickVoice(locale = 'en'): Promise<SpeechSynthesisVoice | null> {
  const voices = await listVoices();
  if (!voices.length) return null;

  const language = locale.split('-')[0].toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(language));
  const pool = matching.length ? matching : voices;

  return (
    pool.find((v) => FEMININE.test(v.name) && QUALITY.test(v.name)) ??
    pool.find((v) => FEMININE.test(v.name)) ??
    pool.find((v) => QUALITY.test(v.name)) ??
    pool.find((v) => !v.localService) ??
    pool[0]
  );
}

/** Resolves a stored preference back to a voice, falling back to the default. */
export async function resolveVoice(
  voiceURI: string | null,
  locale = 'en',
): Promise<SpeechSynthesisVoice | null> {
  if (voiceURI) {
    const voices = await listVoices();
    const chosen = voices.find((v) => v.voiceURI === voiceURI);
    // A voice can disappear between sessions — a language pack removed, a
    // different machine. Fall through rather than going silent.
    if (chosen) return chosen;
  }
  return pickVoice(locale);
}

export class Speaker {
  private current: SpeechSynthesisUtterance | null = null;
  private profile: VoiceProfile = { ...DEFAULT_VOICE };
  private voice: SpeechSynthesisVoice | null = null;

  async prepare(locale = 'en', voiceURI: string | null = null): Promise<boolean> {
    // Choosing a voice needs only the API; the gesture gate applies to speaking.
    if (!hasSynthesis()) return false;
    this.voice = await resolveVoice(voiceURI, locale);
    this.profile.voiceURI = this.voice?.voiceURI ?? null;
    return this.voice !== null;
  }

  setProfile(profile: Partial<VoiceProfile>): void {
    this.profile = { ...this.profile, ...profile };
  }

  get voiceName(): string | null {
    return this.voice?.name ?? null;
  }

  /**
   * Speaks `text`, reporting each word as it is actually voiced.
   *
   * Not every voice implements boundary events. When none arrive, the caller
   * falls back to the estimated timeline rather than freezing the mouth — see
   * `VoiceController`.
   */
  speak(
    text: string,
    handlers: {
      onBoundary?: (b: SpeechBoundary) => void;
      onStart?: () => void;
      onEnd?: () => void;
    } = {},
  ): SpeakHandle {
    if (!synthesisAvailable()) {
      handlers.onEnd?.();
      return { cancel: () => {}, finished: Promise.resolve() };
    }

    this.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = this.profile.rate;
    utterance.pitch = this.profile.pitch;

    const startedAt = performance.now();
    let resolveFinished: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });

    utterance.onstart = () => handlers.onStart?.();

    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      const charIndex = event.charIndex ?? 0;
      // charLength is not populated everywhere; derive it from the text.
      const length = event.charLength || (text.slice(charIndex).match(/^\S+/)?.[0].length ?? 1);
      handlers.onBoundary?.({
        charIndex,
        charLength: length,
        word: text.substr(charIndex, length),
        elapsed: (performance.now() - startedAt) / 1000,
      });
    };

    const finish = () => {
      if (this.current === utterance) this.current = null;
      handlers.onEnd?.();
      resolveFinished();
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    this.current = utterance;
    speechSynthesis.speak(utterance);

    return {
      cancel: () => this.cancel(),
      finished,
    };
  }

  cancel(): void {
    if (!synthesisAvailable()) return;
    this.current = null;
    speechSynthesis.cancel();
  }

  get speaking(): boolean {
    return synthesisAvailable() && speechSynthesis.speaking;
  }
}
