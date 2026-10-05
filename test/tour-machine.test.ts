/**
 * The consult tour's state machine (src/stage/tour-machine.ts; specs/consult-tour.md 3-4): driven here
 * by a tiny in-test clock that carries out the timer and speech effects the way the runner does.
 */
import { describe, expect, it } from 'vitest';
import {
  INTRO_DIRECTIVE,
  STEP_DIRECTIVE,
  SUMMARY_DIRECTIVE,
  TOUR_STATUS,
  TOUR_TIMING,
  cleanMs,
  initialTourState,
  planStep,
  readingMs,
  reduce,
  sideFor,
  targetSideFor,
  words,
  type TourCaps,
  type TourEffect,
  type TourEvent,
  type TourInput,
  type TourState,
  type TourStep,
} from '../src/stage/tour-machine.ts';
import { sampleTourSteps, TOUR_INTRO } from '../src/scan/tour-steps.ts';
import { FACE_REGIONS } from '../shared/types.ts';

/** Runs the machine: one timer at a time, speech ends after `speechMs` (0 = no voice: at once). */
class Sim {
  state: TourState = initialTourState();
  now = 0;
  timer: { id: number; due: number } | null = null;
  effects: TourEffect[] = [];
  speechMs = 0;
  /** Pending speech ends: [due, seq, utter]. */
  speech: [number, number, number][] = [];
  log: { t: number; phase: string; beat: string | null; index: number }[] = [];

  send(e: TourEvent): void {
    const out = reduce(this.state, e, this.now);
    const before = this.state.view;
    this.state = out.state;
    this.effects.push(...out.effects);
    for (const fx of out.effects) {
      if (fx.type === 'timer') this.timer = { id: fx.id, due: this.now + fx.ms };
      if (fx.type === 'cancelTimer') this.timer = null;
      if (fx.type === 'speak') {
        if (this.speechMs <= 0) this.speech.push([this.now, fx.seq, fx.utter]);
        else this.speech.push([this.now + this.speechMs, fx.seq, fx.utter]);
      }
      if (fx.type === 'stopSpeech') this.speech = [];
    }
    const v = this.state.view;
    if (v.phase !== before.phase || v.beat !== before.beat || v.index !== before.index) {
      this.log.push({ t: this.now, phase: v.phase, beat: v.beat, index: v.index });
    }
    // Speech that ends "at once" ends now (after this reduction, as the runner queues it).
    const due = this.speech.filter((s) => s[0] <= this.now);
    this.speech = this.speech.filter((s) => s[0] > this.now);
    for (const [, seq, utter] of due) this.send({ type: 'SPEECH_END', seq, utter });
  }

  /** Moves time on to `until`, firing timers and speech ends in order. */
  run(until: number): void {
    for (let guard = 0; guard < 10000; guard++) {
      const nextTimer = this.timer ? this.timer.due : Infinity;
      const nextSpeech = this.speech.length ? Math.min(...this.speech.map((s) => s[0])) : Infinity;
      const next = Math.min(nextTimer, nextSpeech);
      if (next > until) break;
      this.now = next;
      if (nextSpeech <= nextTimer) {
        const i = this.speech.findIndex((s) => s[0] === nextSpeech);
        const [, seq, utter] = this.speech.splice(i, 1)[0];
        this.send({ type: 'SPEECH_END', seq, utter });
      } else {
        const id = this.timer!.id;
        this.timer = null;
        this.send({ type: 'BEAT_END', id });
      }
    }
    this.now = Math.max(this.now, until);
  }

  /** Runs until `pred` holds (or a long time passes). */
  until(pred: (s: TourState) => boolean, step = 10, max = 200_000): void {
    const end = this.now + max;
    while (!pred(this.state) && this.now < end) this.run(this.now + step);
  }

  get v() {
    return this.state.view;
  }
}

const STEPS = sampleTourSteps();

function input(over: Partial<TourInput> = {}): TourInput {
  return { key: 'sample', mode: 'sample', steps: STEPS, intro: TOUR_INTRO, autoplay: true, face: true, reducedMotion: false, ...over };
}

function started(over: Partial<TourInput> = {}, caps?: { figure: boolean; caps: TourCaps }): Sim {
  const sim = new Sim();
  if (caps) sim.send({ type: 'FIGURE', present: caps.figure, caps: caps.caps });
  sim.send({ type: 'PREPARE', input: input(over) });
  sim.send({ type: 'FORMED', key: over.key ?? 'sample' });
  return sim;
}

describe('pure helpers', () => {
  it('puts every region on a side: only the right-hand ones on the right', () => {
    const right = FACE_REGIONS.filter((r) => sideFor(r) === 'right');
    expect(right.sort()).toEqual(['cheekRight', 'periorbitalRight']);
    for (const r of ['forehead', 'glabella', 'nose', 'perioral', 'chin', 'cheekLeft', 'periorbitalLeft'] as const) expect(sideFor(r)).toBe('left');
  });

  it('reads a step for max(5 s, 400 ms a word + 250 ms a card line), and the intro for max(5 s, 400 ms a word)', () => {
    expect(words("Let's look at what I can see, one area at a time.")).toBe(12);
    expect(cleanMs(TOUR_INTRO)).toBe(5000);
    expect(readingMs(STEPS[0])).toBe(6750); // 15 words, 3 lines
    expect(readingMs(STEPS[3])).toBe(6350); // 14 words, 3 lines
    expect(readingMs({ text: 'Short.', lines: [] })).toBe(5000);
    expect(words('  ')).toBe(0);
  });

  it('plans the four kinds of step (spec 3.3)', () => {
    const step = STEPS[0];
    const T = TOUR_TIMING.normal;
    const beats = (p: ReturnType<typeof planStep>) => p.map((b) => `${b.beat}:${b.open ? 'open' : b.ms}`);
    const noFigure = planStep('left', step, { figure: false, caps: { contact: false, teleport: false }, face: true, reduced: false });
    expect(beats(noFigure)).toEqual([`reach:${T.gather}`, 'hold:120', 'line:330', 'card:300', 'explain:open', 'card-out:260', 'line-out:380', 'settle:300']);
    const same = planStep('left', step, { figure: true, caps: { contact: true, teleport: true }, face: true, reduced: false });
    expect(beats(same).slice(0, 2)).toEqual(['turn:350', 'reach:open']);
    const other = planStep('left', STEPS[3], { figure: true, caps: { contact: true, teleport: true }, face: true, reduced: false });
    expect(beats(other).slice(0, 3)).toEqual(['teleport-out:600', 'teleport-in:700', 'reach:open']);
    const noCaps = planStep('left', STEPS[3], { figure: true, caps: { contact: false, teleport: false }, face: true, reduced: false });
    expect(beats(noCaps).slice(0, 2)).toEqual(['turn:350', 'reach:650']);
    const noFace = planStep('left', step, { figure: true, caps: { contact: true, teleport: true }, face: false, reduced: false });
    expect(beats(noFace)).toEqual(['card:300', 'explain:open', 'card-out:260', 'settle:300']);
    const reduced = planStep('left', step, { figure: false, caps: { contact: false, teleport: false }, face: true, reduced: true });
    expect(beats(reduced)).toEqual(['reach:0', 'hold:250', 'line:0', 'card:120', 'explain:open', 'card-out:120', 'line-out:0', 'settle:150']);
  });

  it('reaches a far-side spot from home until she can teleport', () => {
    expect(targetSideFor(STEPS[3], { figure: true, caps: { contact: true, teleport: true } })).toBe('right');
    expect(targetSideFor(STEPS[3], { figure: true, caps: { contact: true, teleport: false } })).toBe('left');
    expect(targetSideFor(STEPS[3], { figure: false, caps: { contact: true, teleport: true } })).toBe('left');
  });
});

describe('a whole run', () => {
  it('forms clean, then one place at a time, then the summary (the sample reference run, no voice, no figure)', () => {
    const sim = started();
    expect(sim.v.phase).toBe('clean');
    expect(sim.v.caption).toBe(TOUR_INTRO);
    expect(sim.effects).toContainEqual({ type: 'directive', directive: INTRO_DIRECTIVE, text: TOUR_INTRO });
    sim.until((s) => s.view.phase === 'summary');
    // Step starts: clean 5000, then each step gather 300 + 750 + reading + 940.
    const starts = sim.log.filter((l) => l.phase === 'step' && l.beat === 'reach').map((l) => l.t);
    const lens = STEPS.map((s) => 300 + 750 + readingMs(s) + 940);
    const expected = [5000];
    for (let i = 1; i < STEPS.length; i++) expected.push(expected[i - 1] + lens[i - 1]);
    expect(starts).toEqual(expected);
    expect(sim.now).toBe(expected[4] + lens[4]);
    expect(sim.v.beat).toBeNull();
    expect(sim.v.status).toBe(TOUR_STATUS.summary);
    expect(sim.effects).toContainEqual({ type: 'directive', directive: SUMMARY_DIRECTIVE });
    expect(sim.effects).toContainEqual({ type: 'resolve', key: 'sample', outcome: 'completed' });
  });

  it('with her (teleport-capable) goes L, L, L, R, L with exactly two teleports and ends at home', () => {
    const sim = started({}, { figure: true, caps: { contact: true, teleport: true } });
    const sides: string[] = [];
    let teleports = 0;
    let lastSeq = -1;
    for (let guard = 0; guard < 20000 && sim.v.phase !== 'summary'; guard++) {
      const v = sim.v;
      if (v.phase === 'step' && v.seq !== lastSeq) {
        lastSeq = v.seq;
        sides.push(v.targetSide);
      }
      if (v.beat === 'reach' && v.contactAt === null) sim.send({ type: 'CONTACT', seq: v.seq, by: 'figure' });
      sim.run(sim.now + 10);
    }
    teleports = sim.log.filter((l) => l.beat === 'teleport-out').length;
    expect(sides).toEqual(['left', 'left', 'left', 'right', 'left']);
    expect(teleports).toBe(2);
    expect(sim.v.side).toBe('left');
  });

  it('teleports home before the summary when the last place was on the right', () => {
    const steps = [STEPS[0], STEPS[3]];
    const sim = started({ steps }, { figure: true, caps: { contact: true, teleport: true } });
    sim.until((s) => s.view.phase === 'summary');
    expect(sim.v.beat).toBe('teleport-out');
    expect(sim.v.targetSide).toBe('left');
    sim.run(sim.now + 600);
    expect(sim.v.side).toBe('left');
    expect(sim.v.beat).toBe('teleport-in');
    sim.run(sim.now + 700);
    expect(sim.v.beat).toBeNull();
  });

  it('times the contact by the watchdog when her stage never reports it', () => {
    const sim = started({}, { figure: true, caps: { contact: true, teleport: true } });
    sim.until((s) => s.view.beat === 'reach');
    const at = sim.now;
    sim.until((s) => s.view.contactAt !== null);
    expect(sim.v.contactBy).toBe('timer');
    expect(sim.v.contactAt! - at).toBe(TOUR_TIMING.normal.reachWatchdog);
  });

  it('lights the place at the tap and lets it go at line-out, in order', () => {
    const sim = started();
    sim.until((s) => s.view.phase === 'summary');
    const seq = sim.effects.filter((e) => e.type === 'reveal' || e.type === 'release').map((e) => (e.type === 'reveal' ? e.metric : 'release'));
    // Each step: reveal at the tap, release at line-out; the summary releases once more.
    expect(seq.filter((x) => x !== 'release')).toEqual(STEPS.map((s) => s.metric));
    expect(sim.effects).toContainEqual({ type: 'directive', directive: STEP_DIRECTIVE, text: STEPS[0].text });
  });

  it('with no steps goes clean -> summary; without autoplay straight to the summary', () => {
    const none = started({ steps: [], intro: 'Nothing here.' });
    expect(none.v.phase).toBe('clean');
    none.run(5000);
    expect(none.v.phase).toBe('summary');
    const quiet = new Sim();
    quiet.send({ type: 'PREPARE', input: input({ autoplay: false }) });
    expect(quiet.v.phase).toBe('summary');
    expect(quiet.v.beat).toBeNull();
    expect(quiet.v.status).toBe('');
  });

  it('starts clean at once without a face, and the watchdog forms it when FORMED never comes', () => {
    const noFace = new Sim();
    noFace.send({ type: 'PREPARE', input: input({ face: false }) });
    expect(noFace.v.phase).toBe('clean');
    const late = new Sim();
    late.send({ type: 'PREPARE', input: input() });
    expect(late.v.phase).toBe('forming');
    late.run(3000);
    expect(late.v.phase).toBe('clean');
  });
});

describe('voice and reading time', () => {
  it('a step lasts until the speech has ended and the reading time has passed (+600 ms after the speech)', () => {
    const sim = started();
    sim.speechMs = 20_000; // a long line
    sim.until((s) => s.view.phase === 'step');
    sim.until((s) => s.view.contactAt !== null);
    const contact = sim.now;
    sim.until((s) => s.view.beat === 'card-out');
    expect(sim.now).toBe(contact + 20_000 + 600);
  });

  it('a short line keeps the full reading time', () => {
    const sim = started();
    sim.speechMs = 1000;
    sim.until((s) => s.view.contactAt !== null);
    const contact = sim.now;
    sim.until((s) => s.view.beat === 'card-out');
    expect(sim.now).toBe(contact + 750 + readingMs(STEPS[0]));
  });

  it('never cuts the intro short: clean waits for its speech + 600 ms', () => {
    const sim = new Sim();
    sim.speechMs = 9000;
    sim.send({ type: 'PREPARE', input: input() });
    sim.send({ type: 'FORMED', key: 'sample' });
    sim.until((s) => s.view.phase === 'step');
    expect(sim.now).toBe(9600);
  });

  it('ignores a late speech end from a line that was stopped or replaced', () => {
    const sim = started();
    sim.speechMs = 60_000;
    sim.until((s) => s.view.beat === 'explain');
    const stale = sim.effects.filter((e) => e.type === 'speak').pop() as Extract<TourEffect, { type: 'speak' }>;
    sim.send({ type: 'PAUSE', by: 'user' });
    sim.send({ type: 'RESUME', by: 'user' });
    // The old line's end arrives late: it must not end the restarted one.
    sim.send({ type: 'SPEECH_END', seq: stale.seq, utter: stale.utter });
    expect(sim.state.speech).toBe('pending');
    // And a report from an earlier step is ignored too.
    sim.send({ type: 'SPEECH_END', seq: stale.seq - 1, utter: sim.state.utter });
    expect(sim.state.speech).toBe('pending');
  });
});

describe('pause and resume (WCAG 2.2.1)', () => {
  it('paused during reach, the step runs to explain and holds there without speech', () => {
    const sim = started();
    sim.until((s) => s.view.beat === 'reach');
    sim.send({ type: 'PAUSE', by: 'user' });
    expect(sim.v.status).toBe(TOUR_STATUS.paused);
    const spoken = sim.effects.filter((e) => e.type === 'speak').length;
    sim.run(sim.now + 60_000);
    expect(sim.v.beat).toBe('explain');
    expect(sim.v.paused).toBe(true);
    expect(sim.effects.filter((e) => e.type === 'speak').length).toBe(spoken);
    expect(sim.v.caption).toBe(STEPS[0].text);
    sim.send({ type: 'RESUME', by: 'user' });
    expect(sim.v.status).toBe(TOUR_STATUS.resumed);
    expect(sim.effects.filter((e) => e.type === 'speak').length).toBe(spoken + 1);
    const at = sim.now;
    sim.until((s) => s.view.beat === 'card-out');
    expect(sim.now - at).toBe(readingMs(STEPS[0]));
  });

  it('paused in explain stops the speech and keeps the reading time left (at least 1.5 s)', () => {
    const sim = started();
    sim.until((s) => s.view.beat === 'explain');
    sim.run(sim.now + 6000);
    sim.send({ type: 'PAUSE', by: 'user' });
    expect(sim.effects.some((e) => e.type === 'stopSpeech') || sim.state.speech === 'none').toBe(true);
    sim.run(sim.now + 30_000);
    expect(sim.v.beat).toBe('explain');
    sim.send({ type: 'RESUME', by: 'user' });
    const at = sim.now;
    sim.until((s) => s.view.beat === 'card-out');
    expect(sim.now - at).toBe(1500);
  });

  it('paused during clean holds; on resume at least 1 s more, and the intro is not said again', () => {
    const sim = started();
    sim.run(4500);
    sim.send({ type: 'PAUSE', by: 'user' });
    sim.run(20_000);
    expect(sim.v.phase).toBe('clean');
    const intros = sim.effects.filter((e) => e.type === 'speak' && e.text === TOUR_INTRO).length;
    sim.send({ type: 'RESUME', by: 'user' });
    sim.until((s) => s.view.phase === 'step');
    expect(sim.effects.filter((e) => e.type === 'speak' && e.text === TOUR_INTRO).length).toBe(intros);
    expect(sim.now).toBe(21_000);
  });

  it('paused while the step leaves, the next step waits for Resume', () => {
    const sim = started();
    sim.until((s) => s.view.beat === 'card-out');
    sim.send({ type: 'PAUSE', by: 'user' });
    sim.run(sim.now + 30_000);
    expect(sim.v.index).toBe(0);
    expect(sim.v.beat).toBe('settle');
    sim.send({ type: 'RESUME', by: 'user' });
    expect(sim.v.index).toBe(1);
  });

  it('a hidden tab pauses and a visible one resumes only that pause', () => {
    const sim = started();
    sim.send({ type: 'PAUSE', by: 'hidden' });
    expect(sim.v.pausedBy).toBe('hidden');
    sim.send({ type: 'RESUME', by: 'hidden' });
    expect(sim.v.paused).toBe(false);
    sim.send({ type: 'PAUSE', by: 'user' });
    sim.send({ type: 'PAUSE', by: 'hidden' });
    sim.send({ type: 'RESUME', by: 'hidden' });
    expect(sim.v.paused).toBe(true);
    expect(sim.v.pausedBy).toBe('user');
  });
});

describe('skipping around', () => {
  it('NEXT and PREV leave the step fast and start the other; from the last step NEXT shows all', () => {
    const sim = started();
    sim.until((s) => s.view.beat === 'explain');
    sim.send({ type: 'NEXT' });
    expect(sim.v.fast).toBe(true);
    expect(sim.v.beat).toBe('line-out');
    expect(sim.effects.at(-2)?.type === 'release' || sim.effects.some((e) => e.type === 'release')).toBe(true);
    sim.run(sim.now + TOUR_TIMING.normal.fastZone);
    expect(sim.v.index).toBe(1);
    expect(sim.v.fast).toBe(false);
    sim.until((s) => s.view.beat === 'explain');
    sim.send({ type: 'PREV' });
    sim.run(sim.now + 300);
    expect(sim.v.index).toBe(0);
    // PREV at the first step restarts it.
    const seq = sim.v.seq;
    sim.send({ type: 'PREV' });
    expect(sim.v.index).toBe(0);
    expect(sim.v.seq).toBe(seq + 1);
    // From the last step NEXT is Show all results.
    sim.until((s) => s.view.index === 4 && s.view.beat === 'explain');
    sim.send({ type: 'NEXT' });
    sim.run(sim.now + 300);
    expect(sim.v.phase).toBe('summary');
    expect(sim.effects).toContainEqual({ type: 'resolve', key: 'sample', outcome: 'skipped' });
  });

  it('NEXT from the clean face starts the first place; PREV there does nothing', () => {
    const sim = started();
    sim.send({ type: 'PREV' });
    expect(sim.v.phase).toBe('clean');
    sim.send({ type: 'NEXT' });
    expect(sim.v.phase).toBe('step');
    expect(sim.v.index).toBe(0);
  });

  it('Show all results goes to the summary from forming, clean or a step, and resolves "skipped" once', () => {
    for (const at of ['forming', 'clean', 'step'] as const) {
      const sim = new Sim();
      sim.send({ type: 'PREPARE', input: input() });
      if (at !== 'forming') sim.send({ type: 'FORMED', key: 'sample' });
      if (at === 'step') sim.until((s) => s.view.beat === 'explain');
      sim.send({ type: 'SHOW_ALL' });
      sim.run(sim.now + 400);
      expect(sim.v.phase).toBe('summary');
      expect(sim.effects.filter((e) => e.type === 'resolve')).toEqual([{ type: 'resolve', key: 'sample', outcome: 'skipped' }]);
    }
  });

  it('a teleport in flight completes before a skip takes effect', () => {
    const sim = started({ steps: [STEPS[0], STEPS[3], STEPS[4]] }, { figure: true, caps: { contact: true, teleport: true } });
    sim.until((s) => s.view.index === 1 && s.view.beat === 'teleport-out');
    sim.send({ type: 'NEXT' });
    expect(sim.v.beat).toBe('teleport-out');
    sim.run(sim.now + 600);
    expect(sim.v.side).toBe('right');
    sim.run(sim.now + 700);
    expect(sim.v.index).toBe(2);
  });

  it('ignores a stale contact report from an abandoned step', () => {
    const sim = started({}, { figure: true, caps: { contact: true, teleport: true } });
    sim.until((s) => s.view.beat === 'reach');
    const old = sim.v.seq;
    sim.send({ type: 'NEXT' });
    sim.until((s) => s.view.index === 1 && s.view.beat === 'reach');
    sim.send({ type: 'CONTACT', seq: old, by: 'figure' });
    expect(sim.v.contactAt).toBeNull();
    sim.send({ type: 'CONTACT', seq: sim.v.seq, by: 'figure' });
    expect(sim.v.contactBy).toBe('figure');
  });
});

describe('from the summary', () => {
  function atSummary(): Sim {
    const sim = started();
    sim.send({ type: 'SHOW_ALL' });
    sim.run(sim.now + 400);
    sim.effects = [];
    return sim;
  }

  it('explains one place again (fade to clean, the step, then a quick restore), with no resolve', () => {
    const sim = atSummary();
    const summaries = sim.v.summarySeq;
    sim.send({ type: 'AGAIN', slot: 'underEyes' });
    expect(sim.v.phase).toBe('step');
    expect(sim.v.single).toBe(true);
    expect(sim.v.index).toBe(3);
    expect(sim.v.beat).toBe('settle');
    expect(sim.v.status).toBe(TOUR_STATUS.again('Under-eyes'));
    sim.until((s) => s.view.phase === 'summary');
    expect(sim.v.build).toBe('quick');
    expect(sim.v.summarySeq).toBe(summaries + 1);
    expect(sim.effects.some((e) => e.type === 'resolve')).toBe(false);
    // NEXT / PREV are not offered while one place is explained again.
    sim.send({ type: 'AGAIN', slot: 'chin' });
    const seq = sim.v.seq;
    sim.send({ type: 'NEXT' });
    expect(sim.v.seq).toBe(seq);
  });

  it('replays from the first place without the intro and ends in the full build-in', () => {
    const sim = atSummary();
    sim.send({ type: 'REPLAY' });
    expect(sim.v.index).toBe(0);
    expect(sim.effects.some((e) => e.type === 'speak' && e.text === TOUR_INTRO)).toBe(false);
    sim.until((s) => s.view.phase === 'summary');
    expect(sim.v.build).toBe('full');
    expect(sim.effects.some((e) => e.type === 'resolve')).toBe(false);
  });

  it('ignores AGAIN and REPLAY while the tour plays', () => {
    const sim = started();
    const seq = sim.v.seq;
    sim.send({ type: 'AGAIN', slot: 'chin' });
    sim.send({ type: 'REPLAY' });
    expect(sim.v.phase).toBe('clean');
    expect(sim.v.seq).toBe(seq);
  });
});

describe('the world changing', () => {
  it('END from anywhere: off, quiet, nothing lit, IDLE, and the first run resolves with the reason', () => {
    const sim = started();
    sim.until((s) => s.view.beat === 'explain');
    sim.speech = [[1e9, 0, 0]];
    sim.send({ type: 'END', reason: 'left' });
    expect(sim.v.phase).toBe('off');
    expect(sim.effects).toContainEqual({ type: 'release' });
    expect(sim.effects).toContainEqual({ type: 'resolve', key: 'sample', outcome: 'left' });
    expect(sim.timer).toBeNull();
  });

  it('a new key ends the old run with mode-change', () => {
    const sim = started();
    sim.send({ type: 'PREPARE', input: input({ key: 'real-1', mode: 'real' }) });
    expect(sim.effects).toContainEqual({ type: 'resolve', key: 'sample', outcome: 'mode-change' });
    expect(sim.v.key).toBe('real-1');
    expect(sim.v.phase).toBe('forming');
  });

  it('the same key again keeps the run', () => {
    const sim = started();
    sim.until((s) => s.view.beat === 'explain');
    const seq = sim.v.seq;
    sim.send({ type: 'PREPARE', input: input() });
    expect(sim.v.seq).toBe(seq);
    expect(sim.v.beat).toBe('explain');
  });

  it('losing her mid-reach contacts at once and puts her home; she is used again from the next step', () => {
    const sim = started({}, { figure: true, caps: { contact: true, teleport: true } });
    sim.until((s) => s.view.beat === 'reach');
    sim.send({ type: 'FIGURE', present: false });
    expect(sim.v.contactBy).toBe('timer');
    expect(sim.v.side).toBe('left');
    expect(sim.v.figure).toBe(false);
  });

  it('losing the face before the tap turns the rest of the step into card and words', () => {
    const sim = started();
    sim.send({ type: 'FACE', present: false });
    sim.until((s) => s.view.phase === 'step');
    expect(sim.v.beat).toBe('card');
    expect(sim.v.contactAt).not.toBeNull();
    const withFace = started();
    withFace.until((s) => s.view.beat === 'reach');
    withFace.send({ type: 'FACE', present: false });
    expect(withFace.v.beat).toBe('card');
    expect(withFace.effects.some((e) => e.type === 'reveal')).toBe(true);
  });

  it('an error lands in the summary, never on a clean face', () => {
    const sim = started();
    sim.send({ type: 'ERROR' });
    expect(sim.v.phase).toBe('summary');
    expect(sim.v.beat).toBeNull();
    expect(sim.effects).toContainEqual({ type: 'resolve', key: 'sample', outcome: 'error' });
  });

  it('keeps the steps (new register) only while nothing plays', () => {
    const sim = started();
    const other: TourStep[] = STEPS.map((s) => ({ ...s, text: 'x' }));
    sim.send({ type: 'STEPS', steps: other });
    expect(sim.v.steps[0].text).toBe(STEPS[0].text);
    sim.send({ type: 'SHOW_ALL' });
    sim.send({ type: 'STEPS', steps: other });
    expect(sim.v.steps[0].text).toBe('x');
  });

  it('reduced motion: no zero-length beats hold anything up, and the tap is at once without her', () => {
    const sim = started({ reducedMotion: true });
    sim.until((s) => s.view.phase === 'step');
    expect(sim.v.contactAt).toBe(sim.now);
    expect(sim.v.beat).toBe('hold');
  });
});
