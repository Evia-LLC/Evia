/**
 * What the character prototype does, from what the director says
 * (src/character3d/behaviour.ts). Pure decisions; the figure eases them.
 */
import { describe, expect, it } from 'vitest';
import { BEAT_GAP, Behaviour, DELIVER_GRACE, EXAMINE_HOLD, OPEN_BEAT, POINT_HOLD, POINT_MAX, pulse, stroke, type Snapshot } from '../src/character3d/behaviour.ts';

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    state: 'ANALYSIS_COMPLETE',
    gesture: null,
    gestureSeq: 0,
    speaking: false,
    mouthOpen: 0,
    attention: 'viewer',
    region: null,
    phase: 'consult',
    ...over,
  };
}

/** Runs a behaviour for `seconds` at 30 frames a second, returning the last intent. */
function run(b: Behaviour, s: Snapshot, seconds: number, reduced = false) {
  let out = b.decide(s, 1 / 30, reduced);
  for (let t = 1 / 30; t < seconds; t += 1 / 30) out = b.decide(s, 1 / 30, reduced);
  return out;
}

describe('character prototype behaviour', () => {
  it('presents the reading palm up with the other hand on the rim when nothing is lit (ref4)', () => {
    const i = new Behaviour().decide(snap(), 1 / 30);
    expect(i.left).toBe('present');
    expect(i.right).toBe('rim');
    expect(i.lean).toBeGreaterThan(0.5);
  });

  it('turns to a lit region and points at it with the arm nearer the hologram', () => {
    const b = new Behaviour();
    const i = b.decide(snap({ region: 'cheekLeft', gesture: 'point_to_hologram', gestureSeq: 1 }), 1 / 30);
    expect(i.look).toBe('region');
    expect(i.left).toBe('point');
    expect(i.right).toBe('rim');
  });

  it('keeps pointing through a beat of open palms: the beat opens her other hand, then it goes back to the rim', () => {
    const b = new Behaviour();
    b.decide(snap({ region: 'chin', gesture: 'point_to_hologram', gestureSeq: 1, state: 'EXPLAINING' }), 1 / 30);
    const beat = snap({ region: 'chin', gesture: 'open_palms', gestureSeq: 2, state: 'EXPLAINING' });
    const first = b.decide(beat, 1 / 30);
    expect(first.left).toBe('point');
    expect(first.right).toBe('open');
    // Played once, however long the director leaves it showing.
    const later = run(b, beat, OPEN_BEAT + 0.3);
    expect(later.left).toBe('point');
    expect(later.right).toBe('rim');
  });

  it('never drops the point between two regions of a walkthrough (no point - open - point bob)', () => {
    // The director's own sequence for one step: the line with a point, an open-palm beat mid-line,
    // the point shown again when the line ends, the next region 0.7 s later.
    const b = new Behaviour();
    const lefts = new Set<string>();
    const step = (region: 'forehead' | 'nose', gesture: 'point_to_hologram' | 'open_palms', seq: number, seconds: number) => {
      const s = snap({ region, gesture, gestureSeq: seq, state: 'EXPLAINING' });
      for (let t = 0; t < seconds; t += 1 / 30) lefts.add(b.decide(s, 1 / 30).left);
    };
    step('forehead', 'point_to_hologram', 1, 3);
    step('forehead', 'open_palms', 2, POINT_HOLD + 2);
    step('forehead', 'point_to_hologram', 3, 0.7);
    step('nose', 'point_to_hologram', 4, 3);
    expect(lefts).toEqual(new Set(['point']));
  });

  it('points while she talks about the region, a moment after, and not forever', () => {
    const b = new Behaviour();
    const talking = snap({ region: 'forehead', gesture: 'point_to_hologram', gestureSeq: 1, state: 'EXPLAINING' });
    expect(run(b, talking, POINT_HOLD + 3).left).toBe('point');
    // The line ended (her state settles), the region still lit: a moment more, then the present.
    const after = snap({ region: 'forehead', gesture: 'point_to_hologram', gestureSeq: 1, state: 'ANALYSIS_COMPLETE' });
    expect(run(b, after, DELIVER_GRACE * 0.5).left).toBe('point');
    expect(run(b, after, DELIVER_GRACE).left).toBe('present');
    // A region lit for long while her state stays on the explanation: at most POINT_MAX.
    const c = new Behaviour();
    expect(run(c, talking, POINT_MAX + 1).left).toBe('present');
  });
  it('glances back at you while talking about a region, after looking at it first', () => {
    const b = new Behaviour();
    const talking = snap({ region: 'forehead', gesture: 'point_to_hologram', gestureSeq: 1, speaking: true, mouthOpen: 0.6 });
    expect(b.decide(talking, 1 / 30).look).toBe('region');
    const looks = new Set<string>();
    let t = 0;
    while (t < EXAMINE_HOLD + 8) {
      looks.add(b.decide(talking, 1 / 30).look);
      t += 1 / 30;
    }
    expect(looks).toEqual(new Set(['region', 'viewer']));
  });

  it('holds her chin while thinking and tilts toward you while listening', () => {
    const think = new Behaviour().decide(snap({ state: 'THINKING', gesture: 'hand_to_chin', gestureSeq: 1 }), 1 / 30);
    expect(think.right).toBe('chin');
    expect(think.look).toBe('thought');
    const listen = new Behaviour().decide(snap({ state: 'LISTENING' }), 1 / 30);
    expect(listen.look).toBe('viewer');
    expect(listen.left).toBe('rest');
    expect(listen.tilt).toBeGreaterThan(0);
  });

  it('opens the jaw with an audible line only, and gives her beats their energy', () => {
    const b = new Behaviour();
    const muted = run(b, snap({ speaking: false, mouthOpen: 0 }), 0.5);
    expect(muted.jaw).toBe(0);
    const heard = run(b, snap({ speaking: true, mouthOpen: 0.8 }), 0.5);
    expect(heard.jaw).toBeCloseTo(0.8, 6);
    expect(heard.energy).toBeGreaterThan(0.6);
  });

  it('strokes a beat on each stressed onset of the audible mouth, a nod and a tilt with it', () => {
    const b = new Behaviour();
    let beats = 0;
    let most = 0;
    let tilts = new Set<number>();
    let prev = 0;
    // Syllables at 4 a second, open 0.9 then shut.
    for (let t = 0; t < 4; t += 1 / 60) {
      const open = t % 0.25 < 0.12 ? 0.9 : 0.1;
      const i = b.decide(snap({ speaking: true, mouthOpen: open }), 1 / 60);
      if (i.beat > 0.5 && prev <= 0.5) beats++;
      if (i.beat > 0.5) tilts.add(Math.sign(i.tilt));
      most = Math.max(most, i.nod);
      prev = i.beat;
    }
    // One beat per onset, no closer than BEAT_GAP: about 1.5 a second, not one per syllable.
    expect(beats).toBeGreaterThanOrEqual(Math.floor(4 / (BEAT_GAP + 0.25)) - 1);
    expect(beats).toBeLessThanOrEqual(Math.ceil(4 / BEAT_GAP));
    expect(most).toBeGreaterThan((4 * Math.PI) / 180);
    expect(tilts).toEqual(new Set([1, -1]));
    // The stroke: out quickly, back slowly, nothing outside it.
    expect(stroke(0)).toBe(0);
    expect(stroke(0.14)).toBeCloseTo(1, 6);
    expect(stroke(0.64)).toBe(0);
  });

  it('gives no beats to a muted line, nor under reduced motion', () => {
    for (const [speaking, reduced] of [[false, false], [true, true]] as const) {
      const b = new Behaviour();
      let most = 0;
      for (let t = 0; t < 3; t += 1 / 60) most = Math.max(most, b.decide(snap({ speaking, mouthOpen: speaking ? (t % 0.25 < 0.12 ? 0.9 : 0.1) : 0 }), 1 / 60, reduced).beat);
      expect(most).toBe(0);
    }
  });

  it('does not replay the gesture the director is already showing when she arrives', () => {
    const b = new Behaviour();
    const i = b.decide(snap({ gesture: 'open_palms', gestureSeq: 7 }), 1 / 30);
    expect(i.left).toBe('present');
    expect(i.right).toBe('rim');
  });

  it('lets go of a held pose when the director shows none', () => {
    const b = new Behaviour();
    expect(b.decide(snap({ state: 'THINKING', gesture: 'hand_to_chin', gestureSeq: 1 }), 1 / 30).right).toBe('chin');
    const after = b.decide(snap({ state: 'ANALYSIS_COMPLETE', gesture: null, gestureSeq: 1 }), 1 / 30);
    expect(after.right).toBe('rim');
    expect(after.left).toBe('present');
  });

  it('plays a nod once, as an impulse over the held pose', () => {
    const b = new Behaviour();
    b.decide(snap({ gesture: 'point_to_hologram', gestureSeq: 1, region: 'nose' }), 1 / 30);
    const nod = snap({ gesture: 'nod', gestureSeq: 2, region: 'nose' });
    let most = 0;
    for (let i = 0; i < 60; i++) most = Math.max(most, b.decide(nod, 1 / 30).nod);
    expect(most).toBeGreaterThan(0.1);
    expect(b.decide(nod, 1 / 30).nod).toBe(0);
    expect(b.decide(nod, 1 / 30).left).toBe('point');
    expect(pulse(0, 1)).toBe(0);
    expect(pulse(0.5, 1)).toBeCloseTo(1, 9);
  });

  it('steps in and opens her palm to the camera frame while the scan gets ready', () => {
    const i = new Behaviour().decide(snap({ phase: 'prep', state: 'CLINICAL_ANALYSIS' }), 1 / 30);
    expect(i.step).toBe(1);
    expect(i.left).toBe('frame');
    expect(i.look).toBe('frame');
  });

  it('glances at the viewer now and then when idle, but not under reduced motion', () => {
    const idle = snap({ state: 'IDLE' });
    const looks = new Set<string>();
    const b = new Behaviour();
    let glances = 0;
    let prev = 'hologram';
    for (let t = 0; t < 30; t += 1 / 30) {
      const look = b.decide(idle, 1 / 30).look;
      looks.add(look);
      if (look === 'viewer' && prev !== 'viewer') glances++;
      prev = look;
    }
    expect(looks).toEqual(new Set(['hologram', 'viewer']));
    // Every few seconds (idle reads as alive), not constantly.
    expect(glances).toBeGreaterThanOrEqual(4);
    expect(glances).toBeLessThanOrEqual(9);
    const still = new Set<string>();
    const r = new Behaviour();
    for (let t = 0; t < 30; t += 1 / 30) still.add(r.decide(idle, 1 / 30, true).look);
    expect(still).toEqual(new Set(['hologram']));
  });
});
