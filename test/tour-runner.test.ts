/**
 * The consult tour's runner (src/stage/tour.svelte.ts): the machine wired to a director, a voice and a
 * clock. Fake timers drive the clock; the director and the voice are recording stand-ins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TourRunner, type TourDirector, type TourReportLike, type TourVoice } from '../src/stage/tour.svelte.ts';
import { OFF_VIEW, readingMs, type TourInput, type TourView } from '../src/stage/tour-machine.ts';
import { sampleTourSteps, TOUR_INTRO } from '../src/scan/tour-steps.ts';
import type { CharacterDirective, SkinMetricKey } from '../shared/types.ts';

const STEPS = sampleTourSteps();

class FakeDirector implements TourDirector {
  tour: TourView = OFF_VIEW;
  onTourReport: ((report: TourReportLike) => void) | null = null;
  calls: string[] = [];
  publishTour(next: TourView): void {
    this.tour = next;
  }
  applyDirective(d: CharacterDirective): void {
    this.calls.push(`directive:${d.state}`);
  }
  elohimSpoke(d: CharacterDirective, text: string): void {
    this.calls.push(`spoke:${d.state}:${text.slice(0, 12)}`);
  }
  revealRegion(key: SkinMetricKey): void {
    this.calls.push(`reveal:${key}`);
  }
  releaseRegion(): void {
    this.calls.push('release');
  }
}

/** A voice whose lines end when the test says (or at once when it is "off"). */
class FakeVoice implements TourVoice {
  on = false;
  said: string[] = [];
  stops = 0;
  preloaded: string[][] = [];
  private pending: (() => void)[] = [];
  willSpeak(): 'cloned' | 'browser' | 'none' {
    return this.on ? 'browser' : 'none';
  }
  speakAndWait(text: string): Promise<void> {
    this.said.push(text);
    return new Promise((resolve) => this.pending.push(resolve));
  }
  stopSpeaking(): void {
    this.stops++;
  }
  async preload(lines: string[]): Promise<void> {
    this.preloaded.push(lines);
  }
  /** The line being spoken ends. */
  finish(): void {
    this.pending.shift()?.();
  }
}

let runner: TourRunner;
let director: FakeDirector;
let voice: FakeVoice;

function input(over: Partial<TourInput> = {}): TourInput {
  return { key: 'sample', mode: 'sample', steps: STEPS, intro: TOUR_INTRO, autoplay: true, face: true, reducedMotion: false, ...over };
}

/** Advances fake time in small steps so promise callbacks (speech ends) run between timers. */
async function wait(ms: number, step = 10): Promise<void> {
  for (let t = 0; t < ms; t += step) await vi.advanceTimersByTimeAsync(Math.min(step, ms - t));
}

async function until(pred: () => boolean, max = 120_000): Promise<number> {
  const t0 = performance.now();
  while (!pred() && performance.now() - t0 < max) await vi.advanceTimersByTimeAsync(10);
  return performance.now() - t0;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  runner = new TourRunner();
  director = new FakeDirector();
  voice = new FakeVoice();
  runner.attach({
    director,
    voice,
    now: () => performance.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
});

afterEach(() => {
  runner.detach();
  vi.useRealTimers();
});

describe('the runner', () => {
  it('publishes every view to the director and preloads what she may say', () => {
    runner.prepare(input());
    expect(director.tour).toBe(runner.view);
    expect(director.tour.phase).toBe('forming');
    expect(voice.preloaded[0]).toEqual([TOUR_INTRO, ...STEPS.map((s) => s.text)]);
  });

  it('plays the sample run on time (no voice, no figure)', async () => {
    runner.prepare(input());
    const t0 = performance.now();
    runner.faceFormed('sample');
    const starts: number[] = [];
    let seq = -1;
    while (runner.view.phase !== 'summary' && performance.now() - t0 < 120_000) {
      if (runner.view.phase === 'step' && runner.view.seq !== seq) {
        seq = runner.view.seq;
        starts.push(Math.round(performance.now() - t0));
      }
      await vi.advanceTimersByTimeAsync(10);
    }
    const lens = STEPS.map((s) => 300 + 750 + readingMs(s) + 940);
    const expected = [5000];
    for (let i = 1; i < STEPS.length; i++) expected.push(expected[i - 1] + lens[i - 1]);
    starts.forEach((s, i) => expect(Math.abs(s - expected[i])).toBeLessThanOrEqual(16));
    expect(runner.view.beat).toBeNull();
  });

  it('lights each place at the tap and releases it at line-out, in order', async () => {
    runner.prepare(input());
    runner.faceFormed('sample');
    await until(() => runner.view.phase === 'summary');
    const lit = director.calls.filter((c) => c.startsWith('reveal:') || c === 'release');
    const order = lit.filter((c) => c.startsWith('reveal:')).map((c) => c.slice(7));
    expect(order).toEqual(STEPS.map((s) => s.metric));
    // Every reveal is followed by a release before the next reveal.
    for (let i = 0; i < lit.length; i++) if (lit[i].startsWith('reveal:')) expect(lit[i + 1]).toBe('release');
  });

  it('with a voice: speech starts at the tap and a step lasts max(reading, speech + 600 ms)', async () => {
    voice.on = true;
    runner.prepare(input());
    runner.faceFormed('sample');
    // The intro is spoken; it ends at 2 s (shorter than its 5 s reading).
    expect(voice.said).toEqual([TOUR_INTRO]);
    await wait(2000);
    voice.finish();
    await until(() => runner.view.contactAt !== null);
    expect(voice.said.at(-1)).toBe(STEPS[0].text);
    const contact = performance.now();
    // A long line: 15 s.
    await wait(15_000);
    expect(runner.view.beat).toBe('explain');
    voice.finish();
    await until(() => runner.view.beat === 'card-out');
    expect(Math.round(performance.now() - contact)).toBeGreaterThanOrEqual(15_600);
    expect(Math.round(performance.now() - contact)).toBeLessThanOrEqual(15_620);
  });

  it('stops the voice on pause, next and end', async () => {
    voice.on = true;
    runner.prepare(input());
    runner.faceFormed('sample');
    voice.finish();
    await until(() => runner.view.beat === 'explain');
    const before = voice.stops;
    runner.pause();
    expect(voice.stops).toBe(before + 1);
    runner.resume();
    expect(voice.said.filter((t) => t === STEPS[0].text).length).toBe(2);
    runner.next();
    expect(voice.stops).toBe(before + 2);
    await until(() => runner.view.index === 1 && runner.view.beat === 'explain');
    runner.end('left');
    expect(voice.stops).toBe(before + 3);
    expect(runner.view.phase).toBe('off');
    expect(director.calls.at(-1)).toBe('directive:IDLE');
  });

  it('pauses while the tab is hidden and resumes when it is back', () => {
    runner.prepare(input());
    runner.faceFormed('sample');
    runner.setVisible(false);
    expect(runner.view.paused).toBe(true);
    expect(runner.view.pausedBy).toBe('hidden');
    runner.setVisible(true);
    expect(runner.view.paused).toBe(false);
  });

  it('takes her stage reports through the director', () => {
    runner.prepare(input());
    director.onTourReport?.({ kind: 'figure', present: true, caps: { contact: true, teleport: false } });
    expect(runner.view.figure).toBe(true);
    expect(runner.view.caps).toEqual({ contact: true, teleport: false });
  });

  it('fills the contact point from the page at the moment of the tap', async () => {
    runner.setAnchorSource((region) => (region === 'forehead' ? { x: 846, y: 188, z: 12 } : null));
    runner.prepare(input());
    runner.faceFormed('sample');
    await until(() => runner.view.contactAt !== null);
    expect(runner.view.contactPoint).toEqual({ x: 846, y: 188, z: 12 });
  });
});

describe('awaitRun (the controller, real mode)', () => {
  const real = (over: Partial<TourInput> = {}) => input({ key: 'scan-1', mode: 'real', ...over });

  it('resolves "completed" with her sentences when the first run reaches the summary', async () => {
    const run = runner.awaitRun('scan-1');
    expect(runner.view.awaited).toBe(true);
    runner.prepare(real());
    runner.faceFormed('scan-1');
    await until(() => runner.view.phase === 'summary');
    const result = await run;
    expect(result.outcome).toBe('completed');
    expect(result.spoken).toBe([TOUR_INTRO, ...STEPS.map((s) => s.text)].join(' '));
    expect(runner.view.awaited).toBe(false);
  });

  it('resolves "skipped" on Show all results, "left" when the page goes', async () => {
    const skipped = runner.awaitRun('scan-1');
    runner.prepare(real());
    runner.faceFormed('scan-1');
    runner.showAll();
    expect((await skipped).outcome).toBe('skipped');

    const left = runner.awaitRun('scan-2');
    runner.prepare(real({ key: 'scan-2' }));
    runner.end('left');
    expect((await left).outcome).toBe('left');
  });

  it('resolves "none" when the page never prepares the reading within 8 s', async () => {
    let result: { outcome: string } | null = null;
    void runner.awaitRun('scan-9').then((r) => (result = r));
    await wait(7990, 100);
    expect(result).toBeNull();
    await wait(20);
    expect(result).toEqual({ outcome: 'none', spoken: '' });
  });

  it('resolves "none" at once for a reading the page shows without playing, or one that played', async () => {
    const quiet = runner.awaitRun('scan-3');
    runner.prepare(real({ key: 'scan-3', autoplay: false }));
    expect((await quiet).outcome).toBe('none');
    runner.prepare(real({ key: 'scan-4' }));
    runner.end('left');
    expect((await runner.awaitRun('scan-4')).outcome).toBe('none');
    expect(runner.hasPlayed('scan-4')).toBe(true);
  });

  it('only the first run resolves it: a replay does not', async () => {
    const run = runner.awaitRun('scan-1');
    runner.prepare(real());
    runner.faceFormed('scan-1');
    runner.showAll();
    await run;
    let again = false;
    void runner.awaitRun('scan-1').then(() => (again = true));
    await wait(10);
    expect(again).toBe(true); // played already: 'none' at once
    runner.replay();
    await until(() => runner.view.phase === 'summary' && runner.view.beat === null);
    expect(runner.view.awaited).toBe(false);
  });
});

describe('the development clock', () => {
  it('runs on a hand-driven clock: nothing moves until advance()', () => {
    runner.clock = 'manual';
    runner.prepare(input());
    runner.faceFormed('sample');
    vi.advanceTimersByTime(60_000);
    expect(runner.view.phase).toBe('clean');
    runner.advance(5000);
    expect(runner.view.phase).toBe('step');
    expect(runner.view.beat).toBe('reach');
    runner.advance(300);
    expect(runner.view.contactAt).not.toBeNull();
    expect(runner.time).toBeGreaterThan(0);
    runner.clock = 'real';
  });
});
