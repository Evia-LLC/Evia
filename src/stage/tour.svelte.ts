/**
 * The consult tour's runner (specs/consult-tour.md 5.2): the one place the tour's state machine
 * (tour-machine.ts) meets the world. It feeds the machine its events - the face formed, a timer ran
 * out, her fingertip met the spot, a line was said, the reader paused or skipped - and carries out
 * what comes back: one timer at a time, her voice, her directives and the lit region, through the
 * director. It publishes every new view as `director.tour`, which the Scan page and her stage read.
 *
 * Three-free and small: it is in the entry bundle (App attaches it at boot, after the director is
 * registered) and nothing here draws.
 *
 * The controller awaits the first run of a real reading (`awaitRun`): it resolves when that run
 * reaches the summary or ends, or with 'none' when the page never prepared it. Replays and
 * re-explains never resolve it.
 */
import type { CharacterDirective, FaceRegionKey, SkinMetricKey } from '@shared/types.ts';
import type { CalloutSlot } from '@/view/scan.ts';
import {
  OFF_VIEW,
  initialTourState,
  reduce,
  type TourCaps,
  type TourEffect,
  type TourEnd,
  type TourEvent,
  type TourInput,
  type TourState,
  type TourStep,
  type TourView,
} from './tour-machine.ts';

export type { TourInput } from './tour-machine.ts';

/** What the runner needs from the director (the whole `Director` satisfies it). */
export interface TourDirector {
  readonly tour: TourView;
  publishTour(next: TourView): void;
  onTourReport: ((report: TourReportLike) => void) | null;
  applyDirective(directive: CharacterDirective): void;
  elohimSpoke(directive: CharacterDirective, text: string): void;
  revealRegion(key: SkinMetricKey): void;
  releaseRegion(): void;
  step?(dt: number): void;
}

/** The reports her stage (and the page) send through `director.reportTour`. */
export type TourReportLike = { kind: 'contact'; seq: number } | { kind: 'figure'; present: boolean; caps: TourCaps };

export interface TourVoice {
  speakAndWait(text: string): Promise<void>;
  willSpeak(text: string): 'cloned' | 'browser' | 'none';
  stopSpeaking(): void;
  preload?(lines: string[]): Promise<void>;
}

export interface TourDeps {
  director: TourDirector;
  voice: TourVoice;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TourResult {
  outcome: TourEnd | 'none';
  /** Her sentences of that run, joined by ' '. */
  spoken: string;
}

/** A point in ref4 px (x right, y down, z toward the viewer). */
export type RefPoint = { x: number; y: number; z: number };

/* ---- the clock ------------------------------------------------------------------------------ */

let manualNow: number | null = null;

/** The tour's clock: performance.now(), or a manual clock in development (spec 14.3). */
export function tourNow(): number {
  if (manualNow !== null) return manualNow;
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface Waiter {
  key: string;
  started: boolean;
  timer: unknown;
  resolve: (result: TourResult) => void;
}

const ANIMATING = new Set(['forming', 'clean', 'step']);
/** How long the clock keeps ticking once the summary is up (the talk card's fade-out, and some). */
const SETTLE_TICK_MS = 700;

export class TourRunner {
  private state: TourState = initialTourState();
  private deps: TourDeps | null = null;
  private queue: TourEvent[] = [];
  private busy = false;
  private handle: unknown = null;
  private manualTimer: { id: number; due: number } | null = null;
  private anchorSource: ((region: FaceRegionKey) => RefPoint | null) | null = null;
  private played = new Set<string>();
  private waiters: Waiter[] = [];
  /** The sentences of the first run still going, for the controller's `spokenNarration`. */
  private said: { key: string; lines: string[] } | null = null;
  private errored = false;
  private frame = 0;
  private detachVisibility: (() => void) | null = null;

  /** The published view (the same object as `director.tour`). Reactive. */
  private published = $state.raw<TourView>(OFF_VIEW);
  /** The tour's clock for the page's animations: every frame while something moves, or `advance()`. Reactive. */
  time = $state(0);

  get view(): TourView {
    return this.published;
  }

  /** App.svelte at boot, after the director is registered. */
  attach(deps: TourDeps): void {
    this.deps = deps;
    deps.director.onTourReport = (report) => {
      if (report.kind === 'contact') this.dispatch({ type: 'CONTACT', seq: report.seq, by: 'figure' });
      else this.setFigure(report.present, report.caps);
    };
    deps.director.publishTour(this.published);
    this.detachVisibility?.();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onVisibility = () => this.setVisible(document.visibilityState !== 'hidden');
      document.addEventListener('visibilitychange', onVisibility);
      this.detachVisibility = () => document.removeEventListener('visibilitychange', onVisibility);
    }
  }

  /** Tests and App teardown. */
  detach(): void {
    this.end('reset');
    this.cancelTimer();
    this.detachVisibility?.();
    this.detachVisibility = null;
    if (this.deps) this.deps.director.onTourReport = null;
    this.deps = null;
  }

  // ---- the page's calls ----------------------------------------------------------------------

  /** PREPARE (a new key ends the old run with 'mode-change'). */
  prepare(input: TourInput): void {
    if (input.autoplay) this.played.add(input.key);
    this.dispatch({ type: 'PREPARE', input });
    for (const w of this.waiters) {
      if (w.key !== input.key || w.started) continue;
      w.started = true;
      this.clear(w.timer);
      if (!input.autoplay) this.finishWaiter(w, { outcome: 'none', spoken: '' });
    }
  }

  /** Whether this key's first run has started already (real mode plays each reading once). */
  hasPlayed(key: string): boolean {
    return this.played.has(key);
  }

  faceFormed(key: string): void {
    this.dispatch({ type: 'FORMED', key });
  }

  setFigure(present: boolean, caps?: TourCaps): void {
    const v = this.state.view;
    if (v.figure === present && (!present || (caps && v.caps.contact === caps.contact && v.caps.teleport === caps.teleport))) return;
    this.dispatch({ type: 'FIGURE', present, caps });
  }

  setFace(present: boolean): void {
    if (this.state.view.face === present) return;
    this.dispatch({ type: 'FACE', present });
  }

  setReducedMotion(on: boolean): void {
    if (this.state.view.reducedMotion === on) return;
    this.dispatch({ type: 'REDUCED', on });
  }

  /** New step texts (the Detailed / Gen-Z register changed) for re-explain and replay. */
  updateSteps(steps: TourStep[]): void {
    this.dispatch({ type: 'STEPS', steps });
  }

  setVisible(visible: boolean): void {
    // A hand-driven clock (frame capture) is not paused by a hidden tab.
    if (manualNow !== null) return;
    this.dispatch(visible ? { type: 'RESUME', by: 'hidden' } : { type: 'PAUSE', by: 'hidden' });
  }

  /** The page: where an anchor is in ref4 px right now (fills `view.contactPoint` at the contact moment). */
  setAnchorSource(get: ((region: FaceRegionKey) => RefPoint | null) | null): void {
    this.anchorSource = get;
  }

  pause(): void {
    this.dispatch({ type: 'PAUSE', by: 'user' });
  }
  resume(): void {
    this.dispatch({ type: 'RESUME', by: 'user' });
  }
  togglePause(): void {
    if (this.state.view.paused && this.state.view.pausedBy === 'user') this.resume();
    else this.pause();
  }
  next(): void {
    this.dispatch({ type: 'NEXT' });
  }
  prev(): void {
    this.dispatch({ type: 'PREV' });
  }
  showAll(): void {
    this.dispatch({ type: 'SHOW_ALL' });
  }
  explainAgain(slot: CalloutSlot): void {
    this.dispatch({ type: 'AGAIN', slot });
  }
  replay(): void {
    this.dispatch({ type: 'REPLAY' });
  }
  end(reason: TourEnd): void {
    this.dispatch({ type: 'END', reason });
  }

  /**
   * The controller (real mode): resolves when the first run for `key` reaches the summary or ends;
   * 'none' if the page has not prepared `key` within `startWithinMs`, or prepared it without playing.
   */
  awaitRun(key: string, opts: { startWithinMs?: number } = {}): Promise<TourResult> {
    const within = opts.startWithinMs ?? 8000;
    return new Promise<TourResult>((resolve) => {
      const running = this.state.view.key === key && this.state.first;
      if (!running && this.played.has(key)) {
        resolve({ outcome: 'none', spoken: '' });
        return;
      }
      const w: Waiter = { key, started: running, timer: null, resolve };
      if (!running) w.timer = this.later(() => !w.started && this.finishWaiter(w, { outcome: 'none', spoken: '' }), within);
      this.waiters.push(w);
      this.dispatch({ type: 'AWAITED', on: true });
    });
  }

  // ---- development: a hand-driven clock (spec 14.3) --------------------------------------------

  get clock(): 'real' | 'manual' {
    return manualNow === null ? 'real' : 'manual';
  }

  set clock(mode: 'real' | 'manual') {
    if (mode === this.clock) return;
    const now = tourNow();
    if (mode === 'manual') {
      manualNow = now;
      // The pending timer moves onto the manual clock.
      const t = this.state.timer;
      this.cancelTimer();
      if (t) this.manualTimer = { id: t.id, due: t.at + t.ms };
    } else {
      manualNow = null;
      const t = this.manualTimer;
      this.manualTimer = null;
      if (t) this.handle = this.later(() => this.dispatch({ type: 'BEAT_END', id: t.id }), Math.max(0, t.due - tourNow()));
    }
    this.time = tourNow();
    this.wake();
  }

  /** Manual clock: moves time on by `ms`, firing every timer that falls due on the way. */
  advance(ms: number): void {
    if (manualNow === null) return;
    const end = manualNow + Math.max(0, ms);
    for (let guard = 0; guard < 200; guard++) {
      const t = this.manualTimer;
      if (!t || t.due > end) break;
      manualNow = Math.max(manualNow, t.due);
      this.manualTimer = null;
      this.dispatch({ type: 'BEAT_END', id: t.id });
    }
    const before = manualNow;
    manualNow = end;
    this.deps?.director.step?.(Math.max(0, end - before) / 1000);
    this.time = end;
  }

  // ---- inside ----------------------------------------------------------------------------------

  private dispatch(event: TourEvent): void {
    this.queue.push(event);
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        const now = tourNow();
        let out: { state: TourState; effects: TourEffect[] };
        try {
          out = reduce(this.state, next, now);
        } catch (err) {
          if (!this.errored) console.warn('[tour] a step failed; showing all results', err);
          this.errored = true;
          out = reduce(this.state, { type: 'ERROR' }, now);
        }
        const before = this.state.view;
        this.state = out.state;
        this.fillContactPoint(before);
        this.track(before);
        this.publish();
        this.run(out.effects);
      }
    } finally {
      this.busy = false;
    }
  }

  private fillContactPoint(before: TourView): void {
    const v = this.state.view;
    if (v.contactAt === null || v.contactPoint !== null || v.contactAt === before.contactAt) return;
    const step = v.steps[v.index];
    const point = step && this.anchorSource ? this.anchorSource(step.contact) : null;
    if (point) this.state = { ...this.state, view: { ...v, contactPoint: point } };
  }

  /** Collects the first run's sentences as they are put on screen. */
  private track(before: TourView): void {
    const v = this.state.view;
    if (v.key && v.phase !== 'off' && this.state.first && (!this.said || this.said.key !== v.key)) {
      this.said = { key: v.key, lines: [] };
    }
    if (this.said && v.key === this.said.key && v.caption && v.caption !== before.caption) {
      const lines = this.said.lines;
      if (lines[lines.length - 1] !== v.caption) lines.push(v.caption);
    }
  }

  private publish(): void {
    const v = this.state.view;
    if (v === this.published) return;
    this.published = v;
    this.deps?.director.publishTour(v);
    this.wake();
  }

  private run(effects: TourEffect[]): void {
    const deps = this.deps;
    for (const fx of effects) {
      switch (fx.type) {
        case 'timer':
          this.cancelTimer();
          if (manualNow !== null) this.manualTimer = { id: fx.id, due: manualNow + fx.ms };
          else this.handle = this.later(() => this.dispatch({ type: 'BEAT_END', id: fx.id }), fx.ms);
          break;
        case 'cancelTimer':
          this.cancelTimer();
          break;
        case 'speak': {
          const { seq, utter } = fx;
          const ended = () => this.dispatch({ type: 'SPEECH_END', seq, utter });
          if (!deps || deps.voice.willSpeak(fx.text) === 'none') {
            this.queue.push({ type: 'SPEECH_END', seq, utter });
            break;
          }
          void deps.voice.speakAndWait(fx.text).then(ended, ended);
          break;
        }
        case 'stopSpeech':
          deps?.voice.stopSpeaking();
          break;
        case 'directive':
          if (!deps) break;
          if (fx.text) deps.director.elohimSpoke(fx.directive, fx.text);
          else deps.director.applyDirective(fx.directive);
          break;
        case 'reveal':
          deps?.director.revealRegion(fx.metric);
          break;
        case 'release':
          deps?.director.releaseRegion();
          break;
        case 'preload':
          if (deps?.voice.preload) void deps.voice.preload(fx.texts).catch(() => {});
          break;
        case 'resolve':
          this.resolveRun(fx.key, fx.outcome);
          break;
      }
    }
  }

  private resolveRun(key: string, outcome: TourEnd): void {
    const spoken = this.said && this.said.key === key ? this.said.lines.join(' ') : '';
    if (this.said?.key === key) this.said = null;
    for (const w of [...this.waiters]) if (w.key === key) this.finishWaiter(w, { outcome, spoken });
  }

  private finishWaiter(w: Waiter, result: TourResult): void {
    const i = this.waiters.indexOf(w);
    if (i < 0) return;
    this.waiters.splice(i, 1);
    this.clear(w.timer);
    w.resolve(result);
    if (!this.waiters.length) this.dispatch({ type: 'AWAITED', on: false });
  }

  private cancelTimer(): void {
    if (this.handle !== null) this.clear(this.handle);
    this.handle = null;
    this.manualTimer = null;
  }

  private later(fn: () => void, ms: number): unknown {
    if (this.deps) return this.deps.setTimeout(fn, ms);
    return setTimeout(fn, ms);
  }

  private clear(handle: unknown): void {
    if (handle === null || handle === undefined) return;
    if (this.deps) this.deps.clearTimeout(handle);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  /**
   * The animation clock ticks while anything of the tour moves: every phase but off, and the first
   * moments of the summary (the talk card and the last step fading out). Never under a manual clock.
   */
  private moving(): boolean {
    const v = this.state.view;
    if (ANIMATING.has(v.phase) || (v.phase === 'summary' && v.beat !== null)) return true;
    return v.phase === 'summary' && tourNow() - v.beatAt < SETTLE_TICK_MS;
  }

  private wake(): void {
    if (manualNow !== null || this.frame || typeof requestAnimationFrame !== 'function' || !this.moving()) return;
    const tick = () => {
      this.frame = 0;
      if (manualNow !== null) return;
      this.time = tourNow();
      if (this.moving()) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Development handle (window.__evia.tour): drive and inspect the tour from the console. */
  devHandle(): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const runner = this;
    return {
      get view() {
        return runner.view;
      },
      get clock() {
        return runner.clock;
      },
      set clock(mode: 'real' | 'manual') {
        runner.clock = mode;
      },
      now: () => tourNow(),
      advance: (ms: number) => runner.advance(ms),
      pause: () => runner.pause(),
      resume: () => runner.resume(),
      next: () => runner.next(),
      prev: () => runner.prev(),
      showAll: () => runner.showAll(),
      again: (slot: CalloutSlot) => runner.explainAgain(slot),
      replay: () => runner.replay(),
    };
  }
}

/** The one tour. */
export const tour = new TourRunner();
