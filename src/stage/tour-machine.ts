/**
 * The consult tour's state machine (specs/consult-tour.md sections 3-5.1): pure, total, three-free and
 * Svelte-free, so it is safe in the entry bundle and tests drive it with a plain clock.
 *
 * The face forms clean; then, one region at a time, the spot is tapped (her fingertip, or without her a
 * light pulse), a line draws from the tap to the region's card, the region is explained, and the card and
 * line go away. At the end the full reading comes back (the summary), from which any region can be
 * explained again or the whole tour replayed.
 *
 * `reduce(state, event, now)` returns the next state and the effects the runner (tour.svelte.ts) carries
 * out: one timer at a time, speech, her directives, the lit region. Every report that carries a `seq` (or
 * an utterance id) is ignored when it belongs to a step that is no longer on, so a late report from an
 * abandoned step never moves the tour.
 */
import type { CharacterDirective, FaceRegionKey, SkinMetricKey } from '@shared/types.ts';
import type { RegionHighlight } from '@/hologram/regions.ts';
import type { CalloutSlot } from '@/view/scan.ts';

// ---------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------

export type TourSide = 'left' | 'right';
export type TourPhase = 'off' | 'forming' | 'clean' | 'step' | 'summary';
export type TourBeat =
  | 'teleport-out'
  | 'teleport-in'
  | 'turn'
  | 'reach'
  | 'hold'
  | 'line'
  | 'card'
  | 'explain'
  | 'card-out'
  | 'line-out'
  | 'settle';
export type TourEnd = 'completed' | 'skipped' | 'left' | 'mode-change' | 'reset' | 'error';

export interface TourStep {
  readonly slot: CalloutSlot;
  /** Sentence case of the callout heading: 'Forehead', 'T-zone', 'Under-eyes', 'Chin & mouth'. */
  readonly title: string;
  /** The tap point; the leader line starts on its anchor. */
  readonly contact: FaceRegionKey;
  /** What glows for this step (a subset of the reading's highlights, or the sample tour's). */
  readonly zones: readonly RegionHighlight[];
  /** The metric `director.revealRegion` lights (hologram.activeRegion), or null. */
  readonly metric: SkinMetricKey | null;
  /** Where she stands for it: sideFor(contact). */
  readonly side: TourSide;
  /** The region card's lines (the callout's), used for reading time and the accessible text. */
  readonly lines: readonly string[];
  /** Her sentence: talk card, aria-live, voice. */
  readonly text: string;
}

export interface TourCaps {
  /** Her stage reports CONTACT (else the runner times the reach). */
  contact: boolean;
  /** Her stage can teleport (else she stays at home and no teleport beats are planned). */
  teleport: boolean;
}

/** How the summary appears: the full staggered build-in, the quick restore after a re-explain, or as it is. */
export type SummaryBuild = 'full' | 'quick' | 'none';

export interface TourView {
  readonly phase: TourPhase;
  /** 'sample' or the analysis's capturedAt. */
  readonly key: string | null;
  readonly mode: 'sample' | 'real' | null;
  readonly steps: readonly TourStep[];
  /** Index into steps while in 'step'; -1 otherwise. */
  readonly index: number;
  /** A single step re-explained from the summary. */
  readonly single: boolean;
  readonly beat: TourBeat | null;
  /** tourNow() when the beat began, and its planned length (0 = waits for an event). */
  readonly beatAt: number;
  readonly beatMs: number;
  /** When each beat of this step began (tourNow()); reset at every step start. The page animates from these. */
  readonly marks: Readonly<Partial<Record<TourBeat, number>>>;
  /** Bumped at every step start (auto, NEXT/PREV, AGAIN, REPLAY). Reports carry it. */
  readonly seq: number;
  /** Where she stands now; flips at the end of teleport-out. */
  readonly side: TourSide;
  /** Where the current step needs her. */
  readonly targetSide: TourSide;
  /** tourNow() of this seq's contact, and who made it. */
  readonly contactAt: number | null;
  readonly contactBy: 'figure' | 'timer' | null;
  /** The contact anchor in ref4 px at the contact moment (x right, y down, z toward the viewer). Informative. */
  readonly contactPoint: { x: number; y: number; z: number } | null;
  /** Leaving the step early (NEXT, PREV, Show all results): card, line and zones go at the fast-out pace. */
  readonly fast: boolean;
  readonly paused: boolean;
  readonly pausedBy: 'user' | 'hidden' | null;
  readonly figure: boolean;
  readonly caps: TourCaps;
  readonly face: boolean;
  readonly reducedMotion: boolean;
  /** The talk card's sentence now ('' when none). */
  readonly caption: string;
  /** The aria-live text (set at clean and at each step's card). */
  readonly announce: string;
  /** The visually hidden status line: paused, resumed, all results on screen, explaining again. */
  readonly status: string;
  /** How the summary appears, and a counter bumped each time it does (the page replays its build-in on it). */
  readonly build: SummaryBuild;
  readonly summarySeq: number;
  /** The controller is waiting for the first run of this key (real mode): the director's timed reveal holds. */
  readonly awaited: boolean;
}

// ---------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------

/** Timings in ms (spec 4.1), normal and reduced motion. */
export const TOUR_TIMING = {
  normal: {
    formWatchdog: 3000,
    turn: 350,
    reachWatchdog: 1600,
    reachNoCaps: 650,
    gather: 300,
    hold: 120,
    lineBeat: 330,
    lineDraw: 450,
    card: 300,
    cardOut: 260,
    lineOut: 380,
    zoneOut: 550,
    settle: 300,
    teleportOut: 600,
    teleportIn: 700,
    fastCard: 140,
    fastLine: 200,
    fastZone: 300,
    fadeToClean: 300,
    restore: 600,
    speechGrace: 600,
    resumeClean: 1000,
    resumeExplain: 1500,
  },
  reduced: {
    formWatchdog: 3000,
    turn: 0,
    reachWatchdog: 600,
    reachNoCaps: 0,
    gather: 0,
    hold: 250,
    lineBeat: 0,
    lineDraw: 0,
    card: 120,
    cardOut: 120,
    lineOut: 0,
    zoneOut: 0,
    settle: 150,
    teleportOut: 100,
    teleportIn: 100,
    fastCard: 0,
    fastLine: 0,
    fastZone: 0,
    fadeToClean: 0,
    restore: 0,
    speechGrace: 600,
    resumeClean: 1000,
    resumeExplain: 1500,
  },
} as const;

export type TourTiming = (typeof TOUR_TIMING)['normal'] | (typeof TOUR_TIMING)['reduced'];

export function timingFor(reduced: boolean): TourTiming {
  return reduced ? TOUR_TIMING.reduced : TOUR_TIMING.normal;
}

/** The shortest a step (or the intro) is read, and the pace per word and per card line (spec 4.2). */
export const READ_MIN_MS = 5000;
export const READ_MS_PER_WORD = 400;
export const READ_MS_PER_LINE = 250;

export const INTRO_DIRECTIVE: CharacterDirective = { state: 'ANALYSIS_COMPLETE', expression: 'warm', gesture: 'open_palms', intensity: 0.6 };
export const STEP_DIRECTIVE: CharacterDirective = { state: 'EXPLAINING', expression: 'warm', gesture: 'none', intensity: 0.6 };
export const SUMMARY_DIRECTIVE: CharacterDirective = { state: 'IDLE', expression: 'warm', gesture: 'open_palms', intensity: 0.6 };
export const IDLE_DIRECTIVE: CharacterDirective = { state: 'IDLE', expression: 'warm', gesture: 'none', intensity: 0.6 };

/** The status lines (spec 11 / 12.3 A11Y). */
export const TOUR_STATUS = {
  paused: 'Walkthrough paused.',
  resumed: 'Walkthrough resumed.',
  summary: 'All results are on screen.',
  again: (title: string) => `Explaining ${title} again.`,
} as const;

// ---------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------

/** Regions screen-right of the hologram: reached from the right of the pedestal (spec 6.1). */
const RIGHT_REGIONS: readonly FaceRegionKey[] = ['periorbitalRight', 'cheekRight'];

export function sideFor(contact: FaceRegionKey): TourSide {
  return RIGHT_REGIONS.includes(contact) ? 'right' : 'left';
}

export function words(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** How long a step is read at least: max(5 s, 400 ms per word + 250 ms per card line). */
export function readingMs(step: Pick<TourStep, 'text' | 'lines'>): number {
  return Math.max(READ_MIN_MS, READ_MS_PER_WORD * words(step.text) + READ_MS_PER_LINE * step.lines.length);
}

/** How long the intro is read at least (the same rule, no card lines). Speech end + 600 ms may extend it. */
export function cleanMs(intro: string): number {
  return Math.max(READ_MIN_MS, READ_MS_PER_WORD * words(intro));
}

export interface PlannedBeat {
  beat: TourBeat;
  /** Planned length; for an open beat, its watchdog (reach) or 0 (explain: its own rule). */
  ms: number;
  /** Ends on an event (her CONTACT, the reading and the speech) rather than on its timer alone. */
  open?: boolean;
}

export interface PlanContext {
  figure: boolean;
  caps: TourCaps;
  face: boolean;
  reduced: boolean;
}

/** The side she reaches a step from: the step's own side when she can teleport, else home. */
export function targetSideFor(step: Pick<TourStep, 'side'>, ctx: Pick<PlanContext, 'figure' | 'caps'>): TourSide {
  return ctx.figure && ctx.caps.teleport ? step.side : 'left';
}

/** The beats of one step (spec 3.3), from where she stands now. */
export function planStep(from: TourSide, step: TourStep, ctx: PlanContext): PlannedBeat[] {
  const T = timingFor(ctx.reduced);
  if (!ctx.face) {
    return [
      { beat: 'card', ms: T.card },
      { beat: 'explain', ms: 0, open: true },
      { beat: 'card-out', ms: T.cardOut },
      { beat: 'settle', ms: T.settle },
    ];
  }
  const tail: PlannedBeat[] = [
    { beat: 'hold', ms: T.hold },
    { beat: 'line', ms: T.lineBeat },
    { beat: 'card', ms: T.card },
    { beat: 'explain', ms: 0, open: true },
    { beat: 'card-out', ms: T.cardOut },
    { beat: 'line-out', ms: T.lineOut },
    { beat: 'settle', ms: T.settle },
  ];
  if (!ctx.figure) return [{ beat: 'reach', ms: T.gather }, ...tail];
  const head: PlannedBeat[] = [];
  const to = targetSideFor(step, ctx);
  if (to !== from) {
    head.push({ beat: 'teleport-out', ms: T.teleportOut }, { beat: 'teleport-in', ms: T.teleportIn });
  } else {
    head.push({ beat: 'turn', ms: T.turn });
  }
  head.push(ctx.caps.contact ? { beat: 'reach', ms: T.reachWatchdog, open: true } : { beat: 'reach', ms: T.reachNoCaps });
  return [...head, ...tail];
}

/** The live text for a step's card (spec 11). */
export function announceFor(step: TourStep, index: number, count: number, single: boolean): string {
  const where = single ? `${step.title}, again.` : `${step.title}, ${index + 1} of ${count}.`;
  const lines = step.lines.length ? ` ${step.lines.join('; ')}.` : '';
  return `${where}${lines} ${step.text}`;
}

// ---------------------------------------------------------------------------------------------------
// Events, effects, state
// ---------------------------------------------------------------------------------------------------

export interface TourInput {
  key: string;
  mode: 'sample' | 'real';
  steps: TourStep[];
  intro: string;
  /** Start playing when the face forms. False: straight to the summary. */
  autoplay: boolean;
  face: boolean;
  reducedMotion: boolean;
}

export type TourEvent =
  | { type: 'PREPARE'; input: TourInput }
  | { type: 'FORMED'; key: string }
  | { type: 'BEAT_END'; id: number }
  | { type: 'CONTACT'; seq: number; by: 'figure' | 'timer' }
  | { type: 'SPEECH_END'; seq: number; utter: number }
  | { type: 'PAUSE'; by: 'user' | 'hidden' }
  | { type: 'RESUME'; by: 'user' | 'hidden' }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'SHOW_ALL' }
  | { type: 'AGAIN'; slot: CalloutSlot }
  | { type: 'REPLAY' }
  | { type: 'FIGURE'; present: boolean; caps?: TourCaps }
  | { type: 'FACE'; present: boolean }
  | { type: 'REDUCED'; on: boolean }
  | { type: 'STEPS'; steps: TourStep[] }
  | { type: 'AWAITED'; on: boolean }
  | { type: 'END'; reason: TourEnd }
  | { type: 'ERROR' };

export type TourEffect =
  | { type: 'timer'; id: number; ms: number }
  | { type: 'cancelTimer' }
  | { type: 'speak'; text: string; seq: number; utter: number }
  | { type: 'stopSpeech' }
  | { type: 'directive'; directive: CharacterDirective; text?: string }
  | { type: 'reveal'; metric: SkinMetricKey }
  | { type: 'release' }
  | { type: 'preload'; texts: string[] }
  /** The first (auto) run of `key` is over: the controller's await resolves. */
  | { type: 'resolve'; key: string; outcome: TourEnd };

type Target = { kind: 'step'; index: number; single: boolean; fade: boolean } | { kind: 'summary'; build: SummaryBuild; outcome: TourEnd | null };

export interface TourState {
  view: TourView;
  plan: PlannedBeat[];
  cursor: number;
  intro: string;
  /** The one pending timer: its id, when it started and for how long. */
  timer: { id: number; at: number; ms: number } | null;
  timerIds: number;
  /** What was left of a timer stopped by a pause. */
  remaining: number | null;
  /** The current utterance (0 = none yet) and where its speech is. */
  utter: number;
  speech: 'none' | 'pending' | 'ended';
  speechEndAt: number | null;
  /** The reading time of clean / explain has passed; only the speech (and its grace) is awaited. */
  readDone: boolean;
  /** Paused before explain began: explain holds until RESUME. */
  holding: 'explain' | 'next' | null;
  /** Where to go once a teleport in flight, or a fast-out, completes. */
  pending: Target | null;
  /** This run is the key's first (auto) run: its end resolves the controller's await. */
  first: boolean;
}

const NO_CAPS: TourCaps = { contact: false, teleport: false };

export const OFF_VIEW: TourView = Object.freeze({
  phase: 'off',
  key: null,
  mode: null,
  steps: [],
  index: -1,
  single: false,
  beat: null,
  beatAt: 0,
  beatMs: 0,
  marks: {},
  seq: 0,
  side: 'left',
  targetSide: 'left',
  contactAt: null,
  contactBy: null,
  contactPoint: null,
  fast: false,
  paused: false,
  pausedBy: null,
  figure: false,
  caps: NO_CAPS,
  face: true,
  reducedMotion: false,
  caption: '',
  announce: '',
  status: '',
  build: 'none',
  summarySeq: 0,
  awaited: false,
}) as TourView;

export function initialTourState(): TourState {
  return {
    view: OFF_VIEW,
    plan: [],
    cursor: 0,
    intro: '',
    timer: null,
    timerIds: 0,
    remaining: null,
    utter: 0,
    speech: 'none',
    speechEndAt: null,
    readDone: false,
    holding: null,
    pending: null,
    first: false,
  };
}

// ---------------------------------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** One reduction: a working copy of the state and the effects collected on the way. */
class Draft {
  s: TourState;
  v: Mutable<TourView>;
  fx: TourEffect[] = [];
  readonly now: number;
  constructor(state: TourState, now: number) {
    this.s = { ...state };
    this.v = { ...state.view };
    this.now = now;
  }

  get T(): TourTiming {
    return timingFor(this.v.reducedMotion);
  }

  done(): { state: TourState; effects: TourEffect[] } {
    this.s.view = this.v as TourView;
    return { state: this.s, effects: this.fx };
  }

  // ---- timers and speech -----------------------------------------------------------------------

  timer(ms: number): void {
    const id = ++this.s.timerIds;
    this.s.timer = { id, at: this.now, ms: Math.max(0, ms) };
    this.s.remaining = null;
    this.fx.push({ type: 'timer', id, ms: Math.max(0, ms) });
  }

  /** Stops the pending timer, keeping what was left of it. */
  stopTimer(): void {
    const t = this.s.timer;
    this.s.remaining = t ? Math.max(0, t.ms - (this.now - t.at)) : null;
    if (t) this.fx.push({ type: 'cancelTimer' });
    this.s.timer = null;
  }

  speak(text: string): void {
    this.s.utter += 1;
    this.s.speech = 'pending';
    this.s.speechEndAt = null;
    this.fx.push({ type: 'speak', text, seq: this.v.seq, utter: this.s.utter });
  }

  silence(): void {
    if (this.s.speech === 'pending') this.fx.push({ type: 'stopSpeech' });
    this.s.speech = 'none';
    this.s.speechEndAt = null;
  }

  // ---- phases ------------------------------------------------------------------------------------

  /** Everything off: the page, her and the voice back at rest. */
  end(reason: TourEnd): void {
    const key = this.v.key;
    this.stopTimer();
    this.silence();
    this.fx.push({ type: 'release' }, { type: 'directive', directive: IDLE_DIRECTIVE });
    if (this.s.first && key) this.fx.push({ type: 'resolve', key, outcome: reason });
    const keep = { figure: this.v.figure, caps: this.v.caps, reducedMotion: this.v.reducedMotion, seq: this.v.seq + 1, summarySeq: this.v.summarySeq };
    this.v = { ...OFF_VIEW, ...keep };
    const fresh = initialTourState();
    this.s = { ...fresh, timerIds: this.s.timerIds, utter: this.s.utter, view: this.v as TourView };
  }

  enterClean(): void {
    const v = this.v;
    v.phase = 'clean';
    v.beat = null;
    v.beatAt = this.now;
    v.beatMs = cleanMs(this.s.intro);
    v.index = -1;
    v.caption = this.s.intro;
    v.announce = this.s.intro;
    v.marks = {};
    this.s.readDone = false;
    this.s.speech = 'none';
    if (v.paused) {
      // Paused before the intro began: it holds, unspoken, until Resume.
      this.s.remaining = v.beatMs;
      return;
    }
    this.fx.push({ type: 'directive', directive: INTRO_DIRECTIVE, text: this.s.intro });
    this.speak(this.s.intro);
    this.timer(v.beatMs);
  }

  startStep(index: number, opts: { single: boolean; fade: boolean }): void {
    const v = this.v;
    const step = v.steps[index];
    if (!step) {
      this.enterSummary({ build: 'full', outcome: null });
      return;
    }
    this.stopTimer();
    v.phase = 'step';
    v.index = index;
    v.single = opts.single;
    v.seq += 1;
    v.marks = {};
    v.contactAt = null;
    v.contactBy = null;
    v.contactPoint = null;
    v.fast = false;
    v.caption = '';
    v.status = opts.single ? TOUR_STATUS.again(step.title) : '';
    const ctx: PlanContext = { figure: v.figure, caps: v.caps, face: v.face, reduced: v.reducedMotion };
    v.targetSide = targetSideFor(step, ctx);
    const plan = planStep(v.side, step, ctx);
    // From the summary (again, replay): the summary fades to a clean face first.
    if (opts.fade) plan.unshift({ beat: 'settle', ms: this.T.fadeToClean });
    this.s.plan = plan;
    this.s.speech = 'none';
    this.s.speechEndAt = null;
    this.s.readDone = false;
    this.s.holding = null;
    this.s.pending = null;
    this.beginBeat(0);
  }

  /** Starts beat k of the plan (and runs through any that take no time). */
  beginBeat(k: number): void {
    const v = this.v;
    const planned = this.s.plan[k];
    if (!planned) {
      this.afterStep();
      return;
    }
    this.s.cursor = k;
    v.beat = planned.beat;
    v.beatAt = this.now;
    v.beatMs = planned.ms;
    v.marks = { ...v.marks, [planned.beat]: this.now };
    const step = v.steps[v.index];
    switch (planned.beat) {
      case 'reach':
        if (planned.ms <= 0 && !planned.open) {
          this.contact('timer');
          return;
        }
        this.timer(planned.ms);
        return;
      case 'card':
        if (!v.face && v.contactAt === null) {
          // No face: nothing to tap; the card is the moment.
          this.contactMoment(step, 'timer');
        }
        v.announce = announceFor(step, v.index, v.steps.length, v.single);
        break;
      case 'explain':
        v.beatMs = readingMs(step);
        if (v.paused) {
          this.s.holding = 'explain';
          return;
        }
        this.startExplain(step, false);
        return;
      case 'line-out':
        this.fx.push({ type: 'release' });
        break;
      case 'card-out':
        if (!v.face) this.fx.push({ type: 'release' });
        break;
      default:
        break;
    }
    if (planned.ms <= 0) {
      this.endBeat();
      return;
    }
    this.timer(planned.ms);
  }

  /** The current beat is over: the teleport flip, then the next beat (or where a fast-out goes). */
  endBeat(): void {
    const v = this.v;
    const beat = v.beat;
    if (beat === 'teleport-out') v.side = v.targetSide;
    if (beat === 'teleport-in' && this.s.pending) {
      const target = this.s.pending;
      this.s.pending = null;
      this.go(target);
      return;
    }
    if (beat === 'settle' && this.s.cursor === this.s.plan.length - 1 && v.paused) {
      // Paused: the next step waits for Resume.
      this.s.holding = 'next';
      this.s.timer = null;
      return;
    }
    this.beginBeat(this.s.cursor + 1);
  }

  /** After a step's last beat: the next step, or the summary. */
  afterStep(): void {
    const v = this.v;
    if (v.single) {
      this.enterSummary({ build: 'quick', outcome: null });
      return;
    }
    if (v.index + 1 < v.steps.length) {
      this.startStep(v.index + 1, { single: false, fade: false });
      return;
    }
    this.enterSummary({ build: 'full', outcome: 'completed' });
  }

  /** Her fingertip (or the pulse) met the spot. */
  contact(by: 'figure' | 'timer'): void {
    const v = this.v;
    const step = v.steps[v.index];
    if (!step) return;
    this.stopTimer();
    this.contactMoment(step, by);
    this.beginBeat(this.s.cursor + 1);
  }

  contactMoment(step: TourStep, by: 'figure' | 'timer'): void {
    const v = this.v;
    v.contactAt = this.now;
    v.contactBy = by;
    v.caption = step.text;
    if (step.metric) this.fx.push({ type: 'reveal', metric: step.metric });
    if (v.paused) {
      // Paused: the caption is up, nothing is said until Resume.
      this.fx.push({ type: 'directive', directive: STEP_DIRECTIVE });
      return;
    }
    this.fx.push({ type: 'directive', directive: STEP_DIRECTIVE, text: step.text });
    this.speak(step.text);
  }

  startExplain(step: TourStep, restart: boolean): void {
    this.s.readDone = false;
    this.s.holding = null;
    if (restart || this.s.speech === 'none') {
      this.fx.push({ type: 'directive', directive: STEP_DIRECTIVE, text: step.text });
      this.speak(step.text);
    }
    this.timer(readingMs(step));
  }

  /** The reading time (clean or explain) has run out: wait for the speech, then its grace, then move on. */
  readingOver(): void {
    this.s.readDone = true;
    if (this.s.speech === 'pending') return;
    const until = this.s.speechEndAt !== null ? this.s.speechEndAt + this.T.speechGrace : this.now;
    if (until > this.now) {
      this.timer(until - this.now);
      return;
    }
    this.finishReading();
  }

  finishReading(): void {
    if (this.v.phase === 'clean') {
      this.silence();
      if (this.v.steps.length) this.startStep(0, { single: false, fade: false });
      else this.enterSummary({ build: 'full', outcome: 'completed' });
      return;
    }
    this.endBeat();
  }

  enterSummary(opts: { build: SummaryBuild; outcome: TourEnd | null }): void {
    const v = this.v;
    this.stopTimer();
    this.silence();
    v.phase = 'summary';
    v.index = -1;
    v.fast = false;
    v.marks = {};
    v.contactAt = null;
    v.contactBy = null;
    v.contactPoint = null;
    if (opts.outcome && this.s.first && v.key) {
      this.fx.push({ type: 'resolve', key: v.key, outcome: opts.outcome });
      this.s.first = false;
    }
    // She walks home first when she is on the other side.
    if (v.figure && v.caps.teleport && v.side === 'right') {
      v.targetSide = 'left';
      this.s.plan = [
        { beat: 'teleport-out', ms: this.T.teleportOut },
        { beat: 'teleport-in', ms: this.T.teleportIn },
      ];
      this.s.pending = { kind: 'summary', build: opts.build, outcome: null };
      this.s.cursor = 0;
      v.beat = 'teleport-out';
      v.beatAt = this.now;
      v.beatMs = this.T.teleportOut;
      v.marks = { 'teleport-out': this.now };
      this.timer(this.T.teleportOut);
      return;
    }
    this.steadySummary(opts.build);
  }

  steadySummary(build: SummaryBuild): void {
    const v = this.v;
    v.phase = 'summary';
    v.beat = null;
    v.beatAt = this.now;
    v.beatMs = 0;
    v.single = false;
    v.paused = false;
    v.pausedBy = null;
    v.caption = '';
    v.targetSide = v.side;
    v.build = build;
    v.summarySeq += 1;
    v.status = TOUR_STATUS.summary;
    this.s.plan = [];
    this.s.pending = null;
    this.s.holding = null;
    this.fx.push({ type: 'release' }, { type: 'directive', directive: SUMMARY_DIRECTIVE });
  }

  go(target: Target): void {
    if (target.kind === 'step') this.startStep(target.index, { single: target.single, fade: target.fade });
    else this.enterSummary({ build: target.build, outcome: target.outcome });
  }

  /** NEXT, PREV, Show all results from a running step: the card, line and zones leave fast, then the target. */
  fastOut(target: Target): void {
    const v = this.v;
    this.silence();
    if (v.phase === 'step' && (v.beat === 'teleport-out' || v.beat === 'teleport-in')) {
      // A teleport in flight completes first; its timers keep running.
      this.s.pending = target;
      if (v.beat === 'teleport-out') {
        this.s.plan = this.s.plan.slice(0, this.s.cursor + 2);
      }
      return;
    }
    this.stopTimer();
    this.s.holding = null;
    const onScreen = v.phase === 'step' && v.contactAt !== null && v.beat !== 'settle';
    if (!onScreen) {
      this.go(target);
      return;
    }
    // Card, line and zones go together at the fast-out pace; then the target.
    v.fast = true;
    const marks = { ...v.marks };
    if (marks.card !== undefined && marks['card-out'] === undefined) marks['card-out'] = this.now;
    if (marks['line-out'] === undefined) marks['line-out'] = this.now;
    v.marks = marks;
    v.beat = 'line-out';
    v.beatAt = this.now;
    v.beatMs = this.T.fastZone;
    this.fx.push({ type: 'release' });
    this.s.plan = [{ beat: 'line-out', ms: this.T.fastZone }];
    this.s.cursor = 0;
    this.s.pending = target;
    if (this.T.fastZone <= 0) {
      this.s.pending = null;
      this.go(target);
      return;
    }
    this.timer(this.T.fastZone);
  }
}

function stepTarget(index: number, single = false, fade = false): Target {
  return { kind: 'step', index, single, fade };
}

/** The state machine. Pure and total: every event in every phase has a defined result (often "no change"). */
export function reduce(state: TourState, event: TourEvent, now: number): { state: TourState; effects: TourEffect[] } {
  const d = new Draft(state, now);
  const v = d.v;
  const running = v.phase === 'forming' || v.phase === 'clean' || v.phase === 'step';

  switch (event.type) {
    case 'PREPARE': {
      const input = event.input;
      if (v.phase !== 'off' && v.key === input.key) {
        // The same reading again (the page re-mounted): keep the run, take the new facts.
        v.face = input.face;
        v.reducedMotion = input.reducedMotion;
        return d.done();
      }
      if (v.phase !== 'off') d.end('mode-change');
      const w = d.v;
      w.key = input.key;
      w.mode = input.mode;
      w.steps = input.steps.slice();
      w.face = input.face;
      w.reducedMotion = input.reducedMotion;
      w.side = 'left';
      w.targetSide = 'left';
      w.paused = false;
      w.pausedBy = null;
      w.status = '';
      w.announce = '';
      w.awaited = state.view.awaited;
      d.s.intro = input.intro;
      d.s.first = input.autoplay;
      d.fx.push({ type: 'preload', texts: [input.intro, ...input.steps.map((s) => s.text)] });
      if (!input.autoplay) {
        d.steadySummary('none');
        w.status = '';
        return d.done();
      }
      w.phase = 'forming';
      w.beatAt = now;
      w.beatMs = d.T.formWatchdog;
      if (!input.face) {
        d.enterClean();
        return d.done();
      }
      d.timer(d.T.formWatchdog);
      return d.done();
    }

    case 'FORMED':
      if (v.phase === 'forming' && event.key === v.key) {
        d.stopTimer();
        d.enterClean();
      }
      return d.done();

    case 'BEAT_END': {
      if (!d.s.timer || d.s.timer.id !== event.id) return d.done();
      d.s.timer = null;
      d.s.remaining = null;
      if (v.phase === 'forming') {
        d.enterClean();
      } else if (v.phase === 'clean') {
        if (d.s.readDone) d.finishReading();
        else d.readingOver();
      } else if (v.phase === 'step') {
        if (v.beat === 'reach') d.contact('timer');
        else if (v.beat === 'explain') {
          if (d.s.readDone) d.finishReading();
          else d.readingOver();
        } else if (v.fast && d.s.pending) {
          const target = d.s.pending;
          d.s.pending = null;
          d.go(target);
        } else d.endBeat();
      } else if (v.phase === 'summary' && v.beat !== null) {
        if (v.beat === 'teleport-out') {
          v.side = v.targetSide;
          v.beat = 'teleport-in';
          v.beatAt = now;
          v.beatMs = d.T.teleportIn;
          v.marks = { ...v.marks, 'teleport-in': now };
          d.s.cursor = 1;
          d.timer(d.T.teleportIn);
        } else {
          const target = d.s.pending;
          d.s.pending = null;
          d.steadySummary(target && target.kind === 'summary' ? target.build : 'full');
        }
      }
      return d.done();
    }

    case 'CONTACT':
      if (v.phase === 'step' && v.beat === 'reach' && event.seq === v.seq && v.contactAt === null) d.contact(event.by);
      return d.done();

    case 'SPEECH_END':
      if (event.seq !== v.seq || event.utter !== d.s.utter || d.s.speech !== 'pending') return d.done();
      d.s.speech = 'ended';
      d.s.speechEndAt = now;
      if (d.s.readDone && (v.phase === 'clean' || (v.phase === 'step' && v.beat === 'explain'))) d.timer(d.T.speechGrace);
      return d.done();

    case 'PAUSE': {
      if (!running) return d.done();
      if (v.paused) {
        if (event.by === 'user' && v.pausedBy === 'hidden') v.pausedBy = 'user';
        return d.done();
      }
      v.paused = true;
      v.pausedBy = event.by;
      if (event.by === 'user') v.status = TOUR_STATUS.paused;
      if (v.phase === 'forming') {
        d.stopTimer();
      } else if (v.phase === 'clean') {
        d.stopTimer();
        d.silence();
      } else if (v.beat === 'explain' && d.s.holding === null) {
        d.stopTimer();
        d.silence();
        if (d.s.readDone) d.s.remaining = 0;
      }
      // Every other beat carries on to a stable place (explain holds, the next step waits).
      return d.done();
    }

    case 'RESUME': {
      if (!v.paused) return d.done();
      if (event.by === 'hidden' && v.pausedBy === 'user') return d.done();
      v.paused = false;
      v.pausedBy = null;
      if (event.by === 'user') v.status = TOUR_STATUS.resumed;
      const T = d.T;
      if (v.phase === 'forming') {
        d.timer(d.s.remaining ?? T.formWatchdog);
      } else if (v.phase === 'clean') {
        // The intro is not said again.
        d.s.readDone = false;
        d.timer(Math.max(T.resumeClean, d.s.remaining ?? 0));
      } else if (v.phase === 'step') {
        const step = v.steps[v.index];
        if (d.s.holding === 'explain') {
          d.startExplain(step, true);
        } else if (d.s.holding === 'next') {
          d.s.holding = null;
          d.afterStep();
        } else if (v.beat === 'explain') {
          // Speech again from the start; the reading time left, at least 1.5 s.
          const left = Math.max(T.resumeExplain, d.s.remaining ?? 0);
          d.fx.push({ type: 'directive', directive: STEP_DIRECTIVE, text: step.text });
          d.speak(step.text);
          d.s.readDone = false;
          d.timer(left);
        }
      }
      return d.done();
    }

    case 'NEXT':
      if (v.phase === 'clean') {
        d.silence();
        d.stopTimer();
        if (v.steps.length) d.startStep(0, { single: false, fade: false });
        else d.enterSummary({ build: 'full', outcome: 'skipped' });
      } else if (v.phase === 'step' && !v.single) {
        if (v.index + 1 < v.steps.length) d.fastOut(stepTarget(v.index + 1));
        else d.fastOut({ kind: 'summary', build: 'full', outcome: 'skipped' });
      }
      return d.done();

    case 'PREV':
      if (v.phase === 'step' && !v.single) d.fastOut(stepTarget(Math.max(0, v.index - 1)));
      return d.done();

    case 'SHOW_ALL':
      if (!running) return d.done();
      if (v.phase === 'step') d.fastOut({ kind: 'summary', build: v.single ? 'quick' : 'full', outcome: 'skipped' });
      else {
        d.stopTimer();
        d.silence();
        d.enterSummary({ build: 'full', outcome: 'skipped' });
      }
      return d.done();

    case 'AGAIN': {
      if (v.phase !== 'summary' || v.beat !== null) return d.done();
      const i = v.steps.findIndex((s) => s.slot === event.slot);
      if (i < 0) return d.done();
      v.paused = false;
      v.pausedBy = null;
      d.startStep(i, { single: true, fade: true });
      return d.done();
    }

    case 'REPLAY':
      if (v.phase !== 'summary' || v.beat !== null || !v.steps.length) return d.done();
      v.paused = false;
      v.pausedBy = null;
      v.status = '';
      d.startStep(0, { single: false, fade: true });
      return d.done();

    case 'FIGURE':
      v.figure = event.present;
      v.caps = event.present ? (event.caps ?? NO_CAPS) : NO_CAPS;
      if (!event.present) {
        // She is gone: a pending reach contacts now, and she is home again without a teleport.
        if (v.phase === 'step' && v.beat === 'reach' && v.contactAt === null) d.contact('timer');
        d.v.side = 'left';
        d.v.targetSide = 'left';
      }
      return d.done();

    case 'FACE': {
      const had = v.face;
      v.face = event.present;
      if (had && !event.present && v.phase === 'step' && v.contactAt === null && v.beat !== 'teleport-out' && v.beat !== 'teleport-in') {
        // The face went before the tap: the rest of this step is card and words only.
        const T = d.T;
        d.stopTimer();
        const rest: PlannedBeat[] = [
          { beat: 'card', ms: T.card },
          { beat: 'explain', ms: 0, open: true },
          { beat: 'card-out', ms: T.cardOut },
          { beat: 'settle', ms: T.settle },
        ];
        d.s.plan = [...d.s.plan.slice(0, d.s.cursor), ...rest];
        d.beginBeat(d.s.cursor);
      } else if (had && !event.present && v.phase === 'forming') {
        d.stopTimer();
        d.enterClean();
      }
      return d.done();
    }

    case 'REDUCED':
      v.reducedMotion = event.on;
      return d.done();

    case 'STEPS':
      // A new register (Detailed / Gen-Z) while nothing plays: re-explain and replay use it.
      if (v.phase === 'summary' && v.beat === null) v.steps = event.steps.slice();
      return d.done();

    case 'AWAITED':
      v.awaited = event.on;
      return d.done();

    case 'END':
      if (v.phase === 'off') {
        v.awaited = false;
        return d.done();
      }
      d.end(event.reason);
      return d.done();

    case 'ERROR':
      if (v.phase === 'off') return d.done();
      d.stopTimer();
      d.silence();
      if (d.s.first && v.key) {
        d.fx.push({ type: 'resolve', key: v.key, outcome: 'error' });
        d.s.first = false;
      }
      d.steadySummary('full');
      return d.done();
  }
}
