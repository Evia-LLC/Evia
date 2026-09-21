/** Shared playback types. All speech now uses the server-generated OpenAI voice. */
export interface SpeechBoundary {
  charIndex: number;
  charLength: number;
  word: string;
  /** Seconds since the current audio chunk began, read from the audio clock. */
  elapsed: number;
  /** Estimated word span within decoded audio; not provider phoneme alignment. */
  duration?: number;
}
export interface SpeakHandle {
  cancel(): void;
  readonly finished: Promise<void>;
}
/**
 * Compatibility hook for App.svelte. Web Audio is unlocked by primeSound().
 * Device speech synthesis must never introduce a second consultant voice.
 */
export function primeSynthesis(): boolean { return false; }
