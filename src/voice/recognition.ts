/**
 * Speech-to-text (brief §21).
 *
 * Wraps the Web Speech API, which is unevenly implemented and vendor-prefixed,
 * behind an interface that reports its own availability honestly rather than
 * throwing halfway through a user's sentence.
 *
 * Interim results are surfaced so Evia can react while you are still talking —
 * she starts listening, tilts her head, and the composer fills in live. That is
 * most of what makes voice feel like a conversation rather than a command line.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function constructor(): RecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionAvailable(): boolean {
  return typeof window !== 'undefined' && constructor() !== null;
}

export type RecognitionErrorKind =
  | 'not-allowed'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'unknown';

export interface RecognitionHandlers {
  /** Fires repeatedly while speaking, with the best guess so far. */
  onInterim?: (text: string) => void;
  /** Fires once when a phrase is settled. */
  onFinal?: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (kind: RecognitionErrorKind, message: string) => void;
}

const ERROR_MESSAGES: Record<RecognitionErrorKind, string> = {
  'not-allowed': 'I need microphone permission to hear you.',
  'no-speech': "I didn't catch anything — try again?",
  'audio-capture': 'I cannot find a microphone on this device.',
  network: 'Speech recognition needs a connection and could not reach it.',
  aborted: '',
  unknown: 'Something went wrong with the microphone.',
};

export class Listener {
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private finalText = '';

  get listening(): boolean {
    return this.active;
  }

  start(handlers: RecognitionHandlers, locale = 'en-US'): boolean {
    const Ctor = constructor();
    if (!Ctor) {
      handlers.onError?.('unknown', 'This browser has no speech recognition.');
      return false;
    }
    if (this.active) return true;

    const recognition = new Ctor();
    recognition.lang = locale;
    // Single phrase at a time: Evia should answer when you stop talking, not
    // accumulate a monologue.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    this.finalText = '';

    recognition.onstart = () => {
      this.active = true;
      handlers.onStart?.();
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) this.finalText += text;
        else interim += text;
      }
      if (interim) handlers.onInterim?.((this.finalText + interim).trim());
    };

    recognition.onerror = (event) => {
      const kind = (event.error as RecognitionErrorKind) ?? 'unknown';
      if (kind !== 'aborted') {
        handlers.onError?.(kind, ERROR_MESSAGES[kind] ?? ERROR_MESSAGES.unknown);
      }
    };

    recognition.onend = () => {
      this.active = false;
      this.recognition = null;
      const text = this.finalText.trim();
      if (text) handlers.onFinal?.(text);
      handlers.onEnd?.();
    };

    this.recognition = recognition;
    try {
      recognition.start();
      return true;
    } catch (err) {
      this.active = false;
      handlers.onError?.('unknown', (err as Error).message);
      return false;
    }
  }

  /** Stops listening and delivers whatever was heard. */
  stop(): void {
    this.recognition?.stop();
  }

  /** Stops listening and discards it. */
  abort(): void {
    this.finalText = '';
    this.recognition?.abort();
  }
}
