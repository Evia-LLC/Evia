import { ClonedSpeaker } from './cloned.ts';
import { AudioLockedSpeechTrack } from '@/character/speech.ts';
import { introDirective, presentationSpeech } from '@/state/controller.ts';
import type { CharacterDirective } from '@shared/types.ts';
import { INTAKE_WELCOME_LINE, INTAKE_COMPLETE_LINE, INTAKE_QUESTIONS } from '@/lib/intake-content.ts';
import { session } from '@/state/session.svelte.ts';

const PUBLIC_PROMPTS = new Set([INTAKE_WELCOME_LINE, INTAKE_COMPLETE_LINE, ...INTAKE_QUESTIONS.map(q => q.prompt)]);

/** Public, fixed prompts only. Intake answers are never accepted by this API. */
export class WelcomeNarrator {
  private speaker = new ClonedSpeaker();
  private epoch = 0;
  private enabled = true;
  private prepared: Promise<boolean> | null = null;
  private current: { line: string; directive: CharacterDirective } | null = null;
  onStatus: (status: string) => void = () => {};
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.stop(); }
  async present(line: string, directive: CharacterDirective): Promise<void> {
    this.stop();
    this.current = { line, directive };
    introDirective(directive);
    if (!this.enabled) return;
    if (!PUBLIC_PROMPTS.has(line)) { this.onStatus('This line is available as text.'); return; }
    const mine = this.epoch;
    const until = Date.now() + 20_000;
    while (session.characterStatus === 'loading' && Date.now() < until) {
      this.onStatus('Ese is arriving…');
      await new Promise(resolve => window.setTimeout(resolve, 100));
      if (mine !== this.epoch || !this.enabled) return;
    }
    this.onStatus('Preparing Ese’s voice…');
    this.prepared ??= this.speaker.prepare(true);
    const ready = await this.prepared;
    if (mine !== this.epoch || !this.enabled) return;
    if (!ready) {
      this.prepared = null;
      this.onStatus('Voice is unavailable. You can continue with the text.');
      return;
    }
    const track = new AudioLockedSpeechTrack();
    track.setLevel(0);
    const finish = () => {
      track.end();
      if (mine === this.epoch) { presentationSpeech(null); introDirective(directive); this.onStatus(''); }
    };
    this.speaker.speak(line, {
      onStart: () => { if (mine === this.epoch) { presentationSpeech(track); this.onStatus('Ese is speaking'); } },
      onBoundary: b => {
        if (mine !== this.epoch) return;
        track.beginWord(b.word, b.elapsed, b.duration);
        if (line === INTAKE_WELCOME_LINE) {
          const word = b.word.toLowerCase().replace(/[^a-z]/g, '');
          if (word === 'tiring') introDirective({ state: 'EXPLAINING', expression: 'concerned', gesture: 'lean_in', intensity: .62 });
          if (word === 'ese') introDirective({ state: 'EXPLAINING', expression: 'warm', gesture: 'small_wave', intensity: .6 });
          if (word === 'judgment') introDirective({ state: 'EXPLAINING', expression: 'reassuring', gesture: 'slow_nod', intensity: .65 });
          if (word === 'question') introDirective({ state: 'EXPLAINING', expression: 'curious', gesture: 'open_palms', intensity: .5 });
        }
      },
      onLevel: level => { if (mine === this.epoch) track.setLevel(level); },
      onEnd: finish,
      onFailed: () => { finish(); if (mine === this.epoch) this.onStatus('Voice could not play. The full text is here.'); },
    });
  }
  replay(): void { if (this.current) { this.prepared = null; void this.present(this.current.line, this.current.directive); } }
  stop(): void { this.epoch++; this.speaker.cancel(); presentationSpeech(null); this.onStatus(''); }
  dispose(): void { this.stop(); this.speaker.dispose(); this.current = null; }
}
