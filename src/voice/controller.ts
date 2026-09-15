/**
 * The voice pipeline (brief §21).
 *
 *   user speaks -> recognition -> conversation engine -> Elohim's reply
 *                                                          |
 *                          synthesis -> word boundaries -> lip-sync + expression
 *
 * This module owns the microphone and the speaker. It does not own the
 * character — it hands the scene director a mouth track and lets the character
 * engine decide what to do with it, which is what keeps §23's boundary intact.
 */
import { Listener, recognitionAvailable, type RecognitionErrorKind } from './recognition.ts';
import {
  hasSynthesis,
  listVoices,
  Speaker,
  synthesisAvailable,
  type SpeechBoundary,
} from './synthesis.ts';
import { ClonedSpeaker } from './cloned.ts';
import { AudioLockedSpeechTrack, SpeechTrack } from '@/character/speech.ts';
import { VOICE_PREVIEW_LINE } from '@/lib/lines.ts';
import { audioContext } from '@/lib/sound.ts';
import { session } from '@/state/session.svelte.ts';
import type { SessionDirector } from '@/scene/director.ts';

/** 'running', 'suspended', 'closed', or 'absent' - for the status line. */
function audioStateLabel(): string {
  return audioContext()?.state ?? 'absent';
}

export interface VoiceCapabilities {
  /** True when the licensed voice is what will actually speak. */
  cloned: boolean;
  canListen: boolean;
  canSpeak: boolean;
  voiceName: string | null;
}

export class VoiceController {
  private listener = new Listener();
  private speaker = new Speaker();
  /**
   * The licensed human voice, when the server has one configured.
   *
   * Preferred over the browser's synthesiser whenever it exists, and the
   * difference is reported rather than hidden — `voiceName` says which one is
   * actually talking, so a user told she has a human voice can tell when she
   * does not.
   */
  private cloned = new ClonedSpeaker();
  private director: SessionDirector | null = null;

  /** Set by the UI so a transcript can be sent as a normal message. */
  onTranscript: ((text: string) => void) | null = null;
  onInterim: ((text: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  attach(director: SessionDirector | null): void {
    this.director = director;
  }

  async prepare(
    locale = 'en',
    voiceURI: string | null = null,
    guest = false,
  ): Promise<VoiceCapabilities> {
    // Re-runs on every call: the user can change voice in preferences and the
    // new one has to take effect without a reload.
    const [, hasCloned] = await Promise.all([
      this.speaker.prepare(locale, voiceURI),
      this.cloned.prepare(guest),
    ]);
    return {
      canListen: recognitionAvailable(),
      // Either engine counts: the cloned voice does not need the browser to
      // have a synthesiser at all, only an audio context.
      // The API existing is enough here: every line follows a gesture, and
      // `willSpeak` still refuses to mime before iOS has honoured one.
      canSpeak: hasSynthesis() || hasCloned,
      cloned: hasCloned,
      voiceName: hasCloned ? 'Elohim' : this.speaker.voiceName,
    };
  }

  /** Installed voices for the preferences picker. */
  async availableVoices(): Promise<Array<{ uri: string; name: string; lang: string }>> {
    const voices = await listVoices();
    return voices.map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));
  }

  /**
   * Fetches lines she is about to say, so a scripted moment has no gap
   * between the beat and the word. No-op on the browser voice.
   */
  async preload(lines: string[]): Promise<void> {
    if (!this.cloned.ready) return;
    await Promise.all(lines.map((line) => this.cloned.preload(line)));
  }

  /**
   * Speaks a short sample so a chosen voice can be heard before it is saved -
   * and, with her own voice, reports what happened, because on a phone the
   * difference between "did not play" and "played but was muted" is the whole
   * diagnosis.
   */
  preview(voiceURI: string | null, locale = 'en'): void {
    // From the shared line list, so the shipped audio for it never goes stale.
    const line = VOICE_PREVIEW_LINE;
    if (this.cloned.ready && this.cloned.canSay(line)) {
      this.cancelAll();
      session.voiceStatus = 'Playing her voice…';
      this.cloned.speak(line, {
        onStart: () => {
          session.voiceStatus = `Her voice is playing (audio ${audioStateLabel()}). If you hear nothing, check Silent mode and the volume.`;
        },
        onEnd: () => {
          session.voiceStatus = `Her voice played (audio ${audioStateLabel()}).`;
        },
        onFailed: (reason) => {
          session.voiceStatus = `Her voice could not play: ${reason} (audio ${audioStateLabel()}).`;
        },
      });
      return;
    }
    session.voiceStatus = this.cloned.ready
      ? 'Her voice is not available for this line.'
      : 'Her voice is not configured here; the device voice is used.';
    void this.speaker.prepare(locale, voiceURI).then(() => {
      this.speaker.speak(line);
    });
  }

  get listening(): boolean {
    return this.listener.listening;
  }

  // -------------------------------------------------------------------------
  // Listening
  // -------------------------------------------------------------------------

  startListening(locale = 'en-US'): void {
    if (this.listener.listening) return;

    // She stops talking to listen, the way a person would.
    this.stopSpeaking();

    this.listener.start(
      {
        onStart: () => {
          session.listening = true;
          this.director?.applyDirective({
            state: 'LISTENING',
            expression: 'curious',
            gesture: 'lean_in',
            intensity: 0.55,
          });
        },
        onInterim: (text) => this.onInterim?.(text),
        onFinal: (text) => this.onTranscript?.(text),
        onEnd: () => {
          session.listening = false;
        },
        onError: (_kind: RecognitionErrorKind, message: string) => {
          session.listening = false;
          // An aborted recognition carries no message — the user cancelled, and
          // telling them about it would be noise.
          if (message) this.onError?.(message);
        },
      },
      locale,
    );
  }

  stopListening(): void {
    this.listener.stop();
  }

  cancelListening(): void {
    session.listening = false;
    this.listener.abort();
  }

  // -------------------------------------------------------------------------
  // Speaking
  // -------------------------------------------------------------------------

  /**
   * Which voice would speak a line right now, if any.
   *
   * The director asks before it decides what the mouth does: her own voice
   * arrives as audio and takes the mouth over when it starts, the browser
   * voice starts at once and may never report timing, and no voice means no
   * mouth at all.
   */
  willSpeak(text: string): 'cloned' | 'browser' | 'none' {
    if (!session.user?.preferences.voiceEnabled) return 'none';
    if (this.cloned.ready && this.cloned.canSay(text)) return 'cloned';
    // Once she has her own voice, the browser's is never a stand-in. A line
    // her voice cannot say is written, not spoken by a stranger.
    if (this.cloned.ready) return 'none';
    if (synthesisAvailable()) return 'browser';
    return 'none';
  }

  /**
   * Speaks a reply and drives the mouth from the real word timing.
   *
   * With her own voice the mouth is handed over the moment audio starts and
   * follows the measured envelope from there; with the browser voice it stays
   * on the director's estimate until boundaries arrive, and if they never do
   * the estimate is all there is. When her voice fails the browser voice
   * takes the line, with a fresh estimate to run on; when nothing can speak,
   * the mouth closes rather than mime.
   */
  /** Both engines, silenced - a new line must never play under an old one. */
  private cancelAll(): void {
    this.speaker.cancel();
    this.cloned.cancel();
  }

  /**
   * Speaks one line with whichever engine will produce sound, driving the
   * mouth only from that sound.
   *
   * Her own voice hands the mouth an audio-locked track the instant playback
   * starts and follows the measured envelope. The browser voice installs an
   * estimate when its utterance actually starts - never before, because on
   * iOS an utterance outside a gesture is dropped without a single event -
   * and the first word boundary replaces the estimate with real timing. If a
   * line ends without ever locking, the mouth is closed again. When her voice
   * fails the browser voice takes the line the same way; when nothing can
   * speak, the mouth stays shut and the line's timing runs muted.
   */
  /**
   * Which `say` is the live one.
   *
   * A browser utterance that has been cancelled still reports its end a
   * moment later, from a separate task, and that report must not reach the
   * line that replaced it: it would clear `speaking` and shut the mouth on
   * a voice that is audibly playing. So every callback checks that its line
   * is still the current one before touching shared state.
   */
  private line = 0;

  private say(text: string, onDone: () => void): void {
    const which = this.willSpeak(text);
    this.cancelAll();
    const mine = ++this.line;
    const live = () => mine === this.line;
    // A new line starts unrevealed; boundary events advance it from here.
    session.spokenChars = 0;
    if (which === 'none') {
      // Nothing will voice this line, so the text must not wait on a voice.
      session.spokenChars = text.length;
      this.director?.stopMouth();
      onDone();
      return;
    }

    const track = new AudioLockedSpeechTrack();
    let locked = false;
    let ended = false;
    let windDown = 0;

    const lock = () => {
      if (locked || !live()) return;
      locked = true;
      this.director?.useSpeechTrack(track);
    };

    const handlers = {
      onStart: () => {
        if (live()) session.speaking = true;
      },
      onBoundary: (boundary: SpeechBoundary) => {
        if (!live()) return;
        lock();
        // The measured duration rides along when the engine has one; the
        // track estimates only when it does not.
        track.beginWord(boundary.word, boundary.elapsed, boundary.duration);
        // The chat reveals the reply as far as she has actually said it.
        // Indices are into the spoken (cleaned) text, which can sit a few
        // characters behind the written one - the reveal rounds up at the
        // end, so nothing is ever left hidden.
        const spoken = boundary.charIndex + boundary.charLength;
        if (spoken > session.spokenChars) session.spokenChars = spoken;
      },
      onEnd: () => {
        if (ended) return;
        ended = true;
        window.clearTimeout(windDown);
        track.end();
        // A superseded line releases its caller and nothing else.
        if (live()) {
          session.speaking = false;
          // The line is finished: whatever the boundaries missed is spoken.
          if (session.spokenChars < text.length) session.spokenChars = text.length;
          // No timing ever arrived: whatever estimate was miming stops now.
          if (!locked) this.director?.stopMouth();
        }
        onDone();
      },
    };

    const browser = () => {
      // Some engines stop partway and never say so - Chromium's network
      // voices give up at about fifteen seconds without an event - so the
      // line is wound down here after a generous allowance, and neither the
      // mouth nor the stop button outlives the sound.
      windDown = window.setTimeout(handlers.onEnd, Math.min(30_000, 4_000 + text.length * 120));
      this.speaker.speak(text, {
        ...handlers,
        onStart: () => {
          if (!live()) return;
          handlers.onStart();
          // The utterance is audibly under way; an estimate may mime it until
          // the engine reports real word timing.
          if (!locked) this.director?.useSpeechTrack(new SpeechTrack(text));
        },
      });
    };

    if (which === 'cloned') {
      /*
       * With the licensed voice the mouth gets both halves of the truth: which
       * shape from the words, how far open from the actual audio envelope. The
       * browser path has no envelope to offer, so it runs on shapes alone.
       *
       * If her voice fails - a network blip, audio not yet unlocked - the line
       * is tried once more a moment later, and then given up in silence. It
       * is never handed to the browser's voice: a wrong voice for one turn is
       * worse than a line that stays on the page.
       */
      let attempts = 0;
      const attempt = () => {
        attempts++;
        this.cloned.speak(text, {
          ...handlers,
          onStart: () => {
            if (!live()) return;
            handlers.onStart();
            session.voiceStatus = `Her voice is playing (audio ${audioStateLabel()}).`;
            // Real audio is playing from this instant; the mouth is hers now.
            lock();
          },
          onLevel: (level) => track.setLevel(level),
          onFailed: (reason) => {
            if (!live()) return;
            console.warn(`[elohim/voice] licensed voice unavailable: ${reason}`);
            session.voiceStatus = `Her voice could not play: ${reason} (audio ${audioStateLabel()}).`;
            if (attempts < 2) window.setTimeout(() => live() && attempt(), 700);
            else handlers.onEnd();
          },
        });
      };
      attempt();
      return;
    }

    browser();
  }

  speak(text: string): void {
    this.say(text, () => {});
  }

  /**
   * Speaks and resolves when she has finished, or at once when she cannot
   * speak, so a scripted moment can wait on the words without ever hanging
   * on a voice that is switched off.
   */
  speakAndWait(text: string): Promise<void> {
    if (this.willSpeak(text) === 'none') return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(guard);
        resolve();
      };
      /*
       * A voice that never reports the end of a line must not hold the scan
       * hostage. Some synthesisers never fire `onend` in a background tab;
       * the guard resolves at about speaking pace plus a margin regardless.
       * The line itself is left to `say` to wind down - the guard only
       * releases the caller.
       */
      const guard = window.setTimeout(finish, Math.min(20_000, 2_500 + text.length * 70));
      this.say(text, finish);
    });
  }

  stopSpeaking(): void {
    // Retire the current line first, so its late events cannot undo the stop.
    this.line++;
    this.cancelAll();
    this.director?.stopMouth();
    session.speaking = false;
  }

  dispose(): void {
    this.cancelListening();
    this.stopSpeaking();
  }
}

export const voice = new VoiceController();
