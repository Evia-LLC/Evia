/**
 * One reveal for her words, wherever they land.
 *
 * The chat transcript and the scan dock both type her newest line out rather
 * than dropping a paragraph, and they used to each own a timer at slightly
 * different speeds. This is the single mechanism: when a voice is going to
 * speak the line, the text follows `session.spokenChars` - the word-boundary
 * high-water mark the voice controller publishes - so the words on screen
 * keep pace with the words in the air. When nothing will voice it, a plain
 * timer at reading pace does the job the way it always did.
 *
 * Two frames of reference meet here and they are not the same: the reveal
 * slices the raw message text, while `spokenChars` indexes the *cleaned*
 * speakable text (emoji and markdown stripped). The mapping is deliberately
 * defensive - the reveal may lead or lag by a character or two, which is
 * invisible at speaking pace - and once the voice reports the cleaned text
 * complete, the raw text completes too, so trailing decoration never hangs.
 */
import { session } from '@/state/session.svelte.ts';
import { stillness } from '@/lib/motion.ts';
import { voice } from '@/voice/controller.ts';
import { speakableOf } from '@/voice/cloned.ts';

/** Two characters per 34ms tick - about 59 characters a second. */
const TICK_MS = 34;
const STEP = 2;

/**
 * How long a voiced line may sit silent before the timer takes over. Covers
 * a synthesis request that never lands and boundary events that never come.
 */
const VOICE_GRACE_MS = 1500;

export interface RevealTicker {
  /** Stops the ticker where it is; the shown count stays put. */
  stop(): void;
  /** Reveals everything at once - the tap-to-read-it-all path. */
  finish(): void;
}

/**
 * Types `text` out through `onChars`, paced by her voice when one will speak
 * it. Under reduced motion the whole line lands at once - a reveal is motion.
 */
export function revealLine(text: string, onChars: (shown: number) => void): RevealTicker {
  const total = text.length;
  if (stillness() || total === 0) {
    onChars(total);
    return { stop() {}, finish() {} };
  }

  // The introduction owns her voice while it narrates, so a turn landing
  // under it is never voiced even when `willSpeak` says it could be.
  const paced = !session.introPlaying && voice.willSpeak(text) !== 'none';
  const spokenTotal = Math.max(1, speakableOf(text).length);

  let shown = 0;
  let elapsed = 0;
  let id: number | null = window.setInterval(() => {
    elapsed += TICK_MS;
    let next = shown;
    if (paced) {
      const s = session.spokenChars;
      // Monotonic: the voice may restart its counter for a new line, and the
      // text must never un-type.
      next = Math.max(next, s >= spokenTotal ? total : Math.min(total, s));
      // A line that never starts, or is cut off mid-way, must not stall the
      // words on screen: once she is quiet the timer finishes the job.
      if (!session.speaking && elapsed > VOICE_GRACE_MS) {
        next = Math.min(total, Math.max(next, shown + STEP));
      }
    } else {
      next = Math.min(total, next + STEP);
    }
    if (next !== shown) {
      shown = next;
      onChars(shown);
    }
    if (shown >= total) stop();
  }, TICK_MS);

  const stop = () => {
    if (id !== null) {
      window.clearInterval(id);
      id = null;
    }
  };

  return {
    stop,
    finish() {
      stop();
      shown = total;
      onChars(total);
    },
  };
}
