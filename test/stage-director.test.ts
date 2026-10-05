/**
 * The 2D stage director.
 *
 * It replaced the three.js director, which was the only writer of the session
 * fields the scan page depends on - so the thing most worth pinning is that
 * those still move: the room walk, the panel mode and the pipeline progress.
 * After that, the mouth: shut for a line nothing voices, open for one that
 * is, and closed again the moment the voice stops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { director } from '../src/stage/director.ts';
import { session } from '../src/state/session.svelte.ts';
import { AudioLockedSpeechTrack, SpeechTrack } from '../src/character/speech.ts';
import type { SkinAnalysis, SkinAppearanceMetrics } from '../shared/types.ts';
import type { BodyAnalysis } from '../src/body-analysis/pipeline.ts';
import { tour } from '../src/stage/tour.svelte.ts';
import { OFF_VIEW } from '../src/stage/tour-machine.ts';
import { sampleTourSteps } from '../src/scan/tour-steps.ts';

beforeEach(() => {
  vi.useFakeTimers();
  session.reset();
  director.reset();
});

afterEach(() => {
  director.reset();
  vi.useRealTimers();
});

describe('rooms', () => {
  it('walks into the consult room and back through transitioning', async () => {
    await director.enterClinical();
    expect(session.sceneMode).toBe('transitioning');
    vi.runOnlyPendingTimers();
    expect(session.sceneMode).toBe('clinical');
    expect(director.character.state).toBe('CLINICAL_ANALYSIS');

    director.setCapture('abc123');
    director.exitClinical();
    expect(session.sceneMode).toBe('transitioning');
    // Leaving the room drops the capture at once, not at the end of the walk.
    expect(director.hologram.capture).toBeNull();
    vi.runOnlyPendingTimers();
    expect(session.sceneMode).toBe('lounge');
    expect(director.character.state).toBe('IDLE');
  });

  it('turns round when asked to leave mid-walk, and never lands after a sign-out', async () => {
    await director.enterClinical();
    director.exitClinical();
    vi.runOnlyPendingTimers();
    expect(session.sceneMode).toBe('lounge');

    await director.enterClinical();
    session.reset();
    director.reset();
    vi.runOnlyPendingTimers();
    expect(session.sceneMode).toBe('lounge');
  });

  it('steps a leftover result mood through IDLE rather than being blocked', async () => {
    director.applyDirective({ state: 'HAPPY', expression: 'smile', gesture: 'none', intensity: 0.7 });
    await director.enterClinical();
    vi.runOnlyPendingTimers();
    expect(director.character.state).toBe('CLINICAL_ANALYSIS');
  });

  it('owns the panel mode and the pipeline progress', () => {
    director.showRoutine();
    expect(session.panelMode).toBe('routine');
    director.showScan();
    expect(session.panelMode).toBe('scan');

    director.setScanProgress(0.4, 'Reading texture');
    expect(session.scanProgress).toBe(0.4);
    expect(session.scanStage).toBe('Reading texture');
    expect(director.character.attention).toBe('hologram');
    director.setScanProgress(7, 'done');
    expect(session.scanProgress).toBe(1);
  });
});

describe('the mouth', () => {
  const directive = { state: 'SPEAKING', expression: 'warm', gesture: 'none', intensity: 0.5 } as const;

  it('keeps her lips shut through a line nothing voices, then settles', () => {
    director.elohimSpoke(directive, 'Hello there, how are you today?');
    expect(director.character.state).toBe('SPEAKING');
    for (let i = 0; i < 20; i++) {
      director.step(0.05);
      expect(director.character.mouthOpen).toBe(0);
      expect(director.character.speaking).toBe(false);
    }
    for (let i = 0; i < 200; i++) director.step(0.05);
    expect(director.character.state).toBe('IDLE');
  });

  it('moves with a voiced track and closes when the voice stops', () => {
    director.elohimSpoke(directive, 'Mama made apple pie.');
    director.useSpeechTrack(new SpeechTrack('Mama made apple pie.'));
    let opened = 0;
    for (let i = 0; i < 12; i++) {
      director.step(0.03);
      if (director.character.mouthOpen > 0) opened++;
    }
    expect(opened).toBeGreaterThan(0);
    expect(director.character.speaking).toBe(true);

    director.stopMouth();
    expect(director.character.viseme).toBe('sil');
    expect(director.character.mouthOpen).toBe(0);
    director.step(0.03);
    expect(director.character.mouthOpen).toBe(0);
    expect(director.character.speaking).toBe(false);
  });

  it('follows word timing from the engine', () => {
    const track = new AudioLockedSpeechTrack();
    director.useSpeechTrack(track);
    track.beginWord('open', 0);
    director.step(0.05);
    expect(director.character.viseme).not.toBe('sil');
    track.end();
    director.step(0.05);
    expect(director.character.viseme).toBe('sil');
    expect(director.character.speaking).toBe(false);
  });
});

describe('the hologram', () => {
  const metrics = (over: Partial<SkinAppearanceMetrics>): SkinAppearanceMetrics => ({
    hydration: 50,
    oiliness: 50,
    redness: 50,
    texture: 50,
    pores: 50,
    darkSpots: 50,
    evenness: 50,
    underEye: 50,
    acneIndicators: 50,
    ...over,
  });
  const scan = (over: Partial<SkinAppearanceMetrics>): SkinAnalysis => ({
    id: 'scan-1',
    capturedAt: '2026-09-20T10:00:00.000Z',
    metrics: metrics(over),
    confidence: 0.9,
    quality: { brightness: 0.5, blur: 0.1, faceCoverage: 0.6, ok: true, issues: [] },
    regions: {},
    modelVersion: 'test',
    imageStored: false,
  } as unknown as SkinAnalysis);

  it('presents a reading and lights regions in the narration order, by voice or by timer', () => {
    director.presentAnalysis(scan({ hydration: 20, redness: 80, oiliness: 85 }), null, 'steady');
    const queue = director.hologram.revealQueue;
    expect(director.hologram.analysis?.id).toBe('scan-1');
    expect(director.character.gesture).toBe('point_to_hologram');
    expect(queue.length).toBeGreaterThan(1);

    // Her voice reaching the second clause lights both.
    director.revealRegion(queue[1]);
    expect(director.hologram.revealed).toEqual(queue.slice(0, 2));
    expect(director.hologram.activeRegion).toBe(queue[1]);
    // With no voice pacing it, the timer finishes the job.
    vi.advanceTimersByTime(20_000);
    expect(director.hologram.revealed).toEqual(queue);
  });

  it('drops a skin reading\'s reveal when a body reading takes the stage', () => {
    director.presentAnalysis(scan({ hydration: 20, redness: 80, oiliness: 85 }), null, 'steady');
    director.revealRegion(director.hologram.revealQueue[1]);
    expect(director.hologram.revealed.length).toBeGreaterThan(0);

    const body = { capturedAt: '2026-09-20T10:05:00.000Z' } as unknown as BodyAnalysis;
    director.presentBody(body, null, 'steady');
    expect(director.hologram.analysis).toBeNull();
    expect(director.hologram.body?.analysis).toBe(body);
    expect(director.hologram.revealQueue).toEqual([]);
    expect(director.hologram.revealed).toEqual([]);
    expect(director.hologram.activeRegion).toBeNull();
    // Nor does the reveal timer come back to light anything over the body.
    vi.advanceTimersByTime(20_000);
    expect(director.hologram.revealed).toEqual([]);
  });

  it('turns a bare capture into a data URL and drops it on reset', () => {
    director.setCapture('abc123');
    expect(director.hologram.capture).toBe('data:image/jpeg;base64,abc123');
    director.reset();
    expect(director.hologram.capture).toBeNull();
    expect(director.hologram.analysis).toBeNull();
  });
});

describe('touch', () => {
  it('reacts to a poke once per held finger and hands her face back', () => {
    const zones: string[] = [];
    director.onPoked = (zone) => zones.push(zone);
    director.pokeAt('face');
    director.pokeAt('face');
    expect(zones).toEqual(['face']);
    expect(director.character.expression).toBe('surprised');
    vi.advanceTimersByTime(2_500);
    expect(director.character.expression).toBe('warm');
    director.onPoked = null;
  });

  it('fires the long-think hook once after a long think', () => {
    let calls = 0;
    director.onLongThink = () => calls++;
    director.userSubmitted();
    vi.advanceTimersByTime(7_100);
    director.userSubmitted();
    vi.advanceTimersByTime(7_100);
    expect(calls).toBe(1);
    director.onLongThink = null;
  });
});

describe('the consult tour', () => {
  const metrics: SkinAppearanceMetrics = {
    hydration: 20,
    oiliness: 85,
    redness: 80,
    texture: 50,
    pores: 50,
    darkSpots: 50,
    evenness: 50,
    underEye: 50,
    acneIndicators: 50,
  };
  const reading = {
    id: 'scan-1',
    capturedAt: '2026-09-20T10:00:00.000Z',
    metrics,
    confidence: 0.9,
    quality: { brightness: 0.5, blur: 0.1, faceCoverage: 0.6, ok: true, issues: [] },
    regions: {},
    modelVersion: 'test',
    imageStored: false,
  } as unknown as SkinAnalysis;
  const quietVoice = { speakAndWait: async () => {}, willSpeak: () => 'none' as const, stopSpeaking: () => {} };
  const steps = sampleTourSteps();

  afterEach(() => {
    tour.detach();
  });

  function attach() {
    tour.attach({
      director,
      voice: quietVoice,
      now: () => performance.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
  }

  it('publishes the tour record only through publishTour, and forwards her stage\'s reports', () => {
    const seen: unknown[] = [];
    expect(director.tour.phase).toBe('off');
    const view = { ...director.tour, phase: 'clean' as const };
    director.publishTour(view);
    expect(director.tour).toBe(view);
    director.onTourReport = (r) => seen.push(r);
    director.reportTour({ kind: 'contact', seq: 3 });
    expect(seen).toEqual([{ kind: 'contact', seq: 3 }]);
    director.onTourReport = null;
    director.publishTour(OFF_VIEW);
  });

  it('releases a lit region: nothing active and the point let go, her state kept', () => {
    director.applyDirective({ state: 'EXPLAINING', expression: 'warm', gesture: 'point_to_hologram', intensity: 0.6 });
    director.revealRegion('redness');
    expect(director.hologram.activeRegion).toBe('redness');
    director.releaseRegion();
    expect(director.hologram.activeRegion).toBeNull();
    expect(director.character.gesture).toBeNull();
    expect(director.character.state).toBe('EXPLAINING');
  });

  it('keeps the timed reveal dark while a tour runs, or while the controller waits for one', () => {
    director.publishTour({ ...OFF_VIEW, phase: 'clean' });
    director.presentAnalysis(reading, null, 'steady');
    vi.advanceTimersByTime(20_000);
    expect(director.hologram.revealed).toEqual([]);
    director.publishTour({ ...OFF_VIEW, awaited: true });
    director.presentAnalysis(reading, null, 'steady');
    vi.advanceTimersByTime(20_000);
    expect(director.hologram.revealed).toEqual([]);
    director.publishTour(OFF_VIEW);
  });

  it('ends the tour when she leaves the consult room, and on reset', async () => {
    attach();
    await director.enterClinical();
    vi.runOnlyPendingTimers();
    tour.prepare({ key: 'sample', mode: 'sample', steps, intro: 'Hello.', autoplay: true, face: false, reducedMotion: false });
    expect(director.tour.phase).toBe('clean');
    director.exitClinical();
    expect(director.tour.phase).toBe('off');
    tour.prepare({ key: 'sample', mode: 'sample', steps, intro: 'Hello.', autoplay: true, face: false, reducedMotion: false });
    director.reset();
    expect(director.tour.phase).toBe('off');
  });

  it('lights the step\'s metric at the tap through the director', () => {
    attach();
    tour.prepare({ key: 'sample', mode: 'sample', steps, intro: 'Hello.', autoplay: true, face: true, reducedMotion: true });
    tour.faceFormed('sample');
    tour.next();
    expect(director.tour.phase).toBe('step');
    expect(director.hologram.activeRegion).toBe(steps[0].metric);
    tour.showAll();
    expect(director.hologram.activeRegion).toBeNull();
  });
});
