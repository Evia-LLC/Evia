/** One OpenAI voice, with waveform-gated approximate lip sync and text-only failure. */
import { Listener, recognitionAvailable, type RecognitionErrorKind } from './recognition.ts';
import type { SpeechBoundary } from './synthesis.ts';
import { ClonedSpeaker } from './cloned.ts';
import { AudioLockedSpeechTrack } from '@/character/speech.ts';
import { VOICE_PREVIEW_LINE } from '@/lib/lines.ts';
import { session } from '@/state/session.svelte.ts';
import type { SessionDirector } from '@/scene/director.ts';

export interface VoiceCapabilities {
  /** Historical field: true when server-generated AI voice is available. */
  cloned: boolean;
  canListen: boolean;
  canSpeak: boolean;
  voiceName: string | null;
}
export class VoiceController {
  private listener = new Listener();
  private cloned = new ClonedSpeaker();
  private director: SessionDirector | null = null;
  private line = 0;
  private identity: string | null = null;
  onTranscript: ((text: string) => void) | null = null;
  onInterim: ((text: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  attach(director: SessionDirector | null): void { this.director = director; }

  async prepare(_locale = 'en', _voiceURI: string | null = null, guest = false): Promise<VoiceCapabilities> {
    const identity = guest ? 'guest' : session.user?.id ?? 'signed-out';
    if (identity !== this.identity) {
      this.clearSpeechData();
      this.identity = identity;
    }
    const available = await this.cloned.prepare(guest);
    session.voiceStatus = available
      ? 'Ese uses an AI-generated OpenAI voice.'
      : 'OpenAI voice is unavailable. Replies are available as text.';
    return { canListen: recognitionAvailable(), canSpeak: available, cloned: available,
      voiceName: available ? 'Ese · OpenAI AI-generated voice' : null };
  }
  /** One consistent voice; a device voice picker would change the character. */
  async availableVoices(): Promise<Array<{ uri: string; name: string; lang: string }>> { return []; }
  /** Guest opt-in is local; accounts also need their stored cloud permission. */
  private cloudSpeechAllowed(): boolean {
    return Boolean(session.user) && (session.guest
      ? session.user?.preferences.voiceEnabled === true
      : session.user?.consents.cloud_reasoning === true);
  }
  async preload(lines: string[]): Promise<void> {
    if (!this.cloned.ready || !session.user?.preferences.voiceEnabled || !this.cloudSpeechAllowed()) return;
    await Promise.all(lines.map((line) => this.cloned.preload(line)));
  }
  preview(_voiceURI: string | null, _locale = 'en'): void {
    this.stopSpeaking();
    if (!this.cloudSpeechAllowed()) {
      session.voiceStatus = session.guest
        ? 'Enable the disclosed OpenAI voice option in Profile before playing a sample.'
        : 'Enable cloud processing in Privacy before using OpenAI voice.';
      return;
    }
    if (!this.cloned.ready) {
      session.voiceStatus = 'OpenAI voice is unavailable. Replies are available as text.';
      return;
    }
    const mine = this.line;
    session.voiceStatus = 'Preparing an AI-generated OpenAI voice preview…';
    this.cloned.speak(VOICE_PREVIEW_LINE, {
      onStart: () => { if (mine === this.line) session.voiceStatus = 'Playing an AI-generated OpenAI voice. Check your device volume if it is quiet.'; },
      onEnd: () => { if (mine === this.line) session.voiceStatus = 'AI-generated voice preview finished.'; },
      onFailed: () => { if (mine === this.line) session.voiceStatus = 'Voice could not play. You can continue with text and try again.'; },
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

  // The historical discriminant is retained for the scene director contract.
  willSpeak(text: string): 'cloned' | 'browser' | 'none' {
    return session.user?.preferences.voiceEnabled && this.cloudSpeechAllowed() && this.cloned.canSay(text) ? 'cloned' : 'none';
  }
  private say(text: string, onDone: () => void): void {
    this.stopSpeaking();
    const mine = this.line;
    const live = () => mine === this.line;
    session.spokenChars = 0;
    if (this.willSpeak(text) === 'none') {
      session.spokenChars = text.length; this.director?.stopMouth(); onDone(); return;
    }
    const track = new AudioLockedSpeechTrack();
    track.setLevel(0);
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true; track.end();
      if (live()) {
        session.speaking = false; session.spokenChars = text.length;
        this.director?.stopMouth();
      }
      onDone();
    };
    session.voiceStatus = 'Preparing an AI-generated OpenAI voice…';
    this.cloned.speak(text, {
      onStart: () => {
        if (!live()) return;
        session.speaking = true;
        session.voiceStatus = 'Speaking with an AI-generated OpenAI voice.';
        this.director?.useSpeechTrack(track);
      },
      onBoundary: (boundary: SpeechBoundary) => {
        if (!live() || ended) return;
        // Shape timing is estimated from the decoded clip, not measured phonemes.
        track.beginWord(boundary.word, boundary.elapsed, boundary.duration);
        session.spokenChars = Math.max(session.spokenChars, boundary.charIndex + boundary.charLength);
      },
      onLevel: (level) => { if (live() && !ended) track.setLevel(level); },
      onEnd: finish,
      onFailed: () => {
        if (live()) session.voiceStatus = 'Voice could not play. The full reply is available as text.';
        finish();
      },
    });
  }
  speak(text: string): void { this.say(text, () => {}); }
  speakAndWait(text: string): Promise<void> {
    if (this.willSpeak(text) === 'none') return Promise.resolve();
    return new Promise((resolve) => {
      let ended = false, guard = 0;
      const finish = () => {
        if (ended) return;
        ended = true; window.clearTimeout(guard); resolve();
      };
      this.say(text, finish);
      const mine = this.line;
      if (!ended) guard = window.setTimeout(() => {
        if (mine === this.line) this.stopSpeaking();
        finish();
      }, Math.min(90_000, 35_000 + text.length * 90));
    });
  }
  stopSpeaking(): void {
    this.line++; this.cloned.cancel();
    this.director?.stopMouth(); session.speaking = false;
  }
  clearSpeechData(): void {
    this.stopSpeaking(); this.cloned.clearCache();
  }
  dispose(): void {
    this.cancelListening(); this.stopSpeaking(); this.cloned.dispose();
    this.identity = null;
  }
}
export const voice = new VoiceController();
