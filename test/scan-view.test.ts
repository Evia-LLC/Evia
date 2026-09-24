/**
 * The Scan page's view model: sample mode is the mockup, real mode is only
 * what the analysis produced (specs/data-map.md 6).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FaceRegionKey, RegionStats, SkinAnalysis } from '../shared/types.ts';
import { FACE_REGIONS } from '../shared/types.ts';
import { SAMPLE_SCAN } from '../src/sample/fixtures/scan.ts';
import { sample } from '../src/sample/mode.svelte.ts';
import { LOCUS_PLACE, NOT_FLAGGED, buildScanView, scanView, thumbLabel, type ScanInput } from '../src/view/scan.ts';

function stats(over: Partial<RegionStats> = {}): RegionStats {
  return { samples: 400, L: 60, a: 8, b: 14, sigmaL: 3, specular: 0.02, highFreq: 3, darkFraction: 0.02, ...over };
}

function analysis(): SkinAnalysis {
  const regions = Object.fromEntries(FACE_REGIONS.map((r) => [r, stats()])) as Record<FaceRegionKey, RegionStats>;
  // Texture concentrated on the forehead, redness on both cheeks.
  regions.forehead = stats({ sigmaL: 8 });
  regions.cheekLeft = stats({ a: 20 });
  regions.cheekRight = stats({ a: 20 });
  return {
    capturedAt: '2026-09-24T15:30:00.000Z',
    metrics: {
      hydration: 70, // higher is better: concern 30, Slight, but even across the face
      oiliness: 10,
      redness: 80, // Marked, on the cheeks
      texture: 60, // Moderate, on the forehead
      pores: 55, // Moderate, never localised
      darkSpots: 5,
      evenness: 90,
      underEye: 10,
      acneIndicators: 5,
    },
    regions,
    quality: {
      verdict: 'pass',
      score: 0.9,
      brightness: 0.5,
      sharpness: 0.8,
      faceHeightFraction: 0.6,
      centeringError: 0.1,
      issues: [],
    },
    confidence: 0.8,
    modelVersion: 'elohim-skin-1.0.0',
  } as SkinAnalysis;
}

function input(over: Partial<ScanInput> = {}): ScanInput {
  return {
    analysis: analysis(),
    hasBody: false,
    hasMesh: true,
    hasCapture: true,
    scanActive: false,
    scanProgress: 0,
    scanStage: '',
    activeMetric: null,
    revealing: false,
    speaking: false,
    ...over,
  };
}

afterEach(() => {
  sample.on = false;
});

describe('scan view: sample mode', () => {
  it('is the mockup, word for word, over the sample mesh', () => {
    sample.on = true;
    const view = scanView();
    expect(view).toBe(SAMPLE_SCAN);
    expect(view.mesh).toBe('sample');
    expect(view.status.title).toBe('Clinical analysis activated');
    expect(view.callouts.map((c) => c.heading)).toEqual(['FOREHEAD', 'PORES', 'CHEEKS', 'UNDER-EYES', 'CHIN']);
    expect(view.cards.map((c) => c.value)).toEqual(['62%', '68%', '54%']);
    expect(view.concerns.rows.map((r) => r.severity)).toEqual(['High', 'Moderate', 'Moderate', 'Moderate', 'Mild']);
    // No faces in the sample thumbnails: neutral texture tiles only.
    expect(view.callouts.every((c) => c.thumb.kind === 'sample')).toBe(true);
  });
});

describe('scan view: real mode', () => {
  it('groups findings by the place their own locus names, and only there', () => {
    const view = buildScanView(input());
    expect(view.phase).toBe('consultation');
    expect(view.mode).toBe('real');
    const bySlot = Object.fromEntries(view.callouts.map((c) => [c.slot, c]));
    expect(Object.keys(bySlot).sort()).toEqual(['cheeks', 'forehead']);
    expect(bySlot.forehead.lines).toEqual(['Texture · Moderate']);
    expect(bySlot.forehead.anchor).toBe('forehead');
    expect(bySlot.cheeks.lines).toEqual(['Redness · Marked']);
    expect(bySlot.cheeks.thumb).toEqual({ kind: 'capture', region: 'cheekLeft' });
    // Pores has no locus and hydration reads "fairly even": neither is pinned to the face.
    expect(view.callouts.flatMap((c) => c.metrics)).not.toContain('pores');
    expect(view.callouts.flatMap((c) => c.metrics)).not.toContain('hydration');
    // The zones lit are exactly the localised findings' regions.
    expect(view.highlights.map((h) => h.region).sort()).toEqual(['cheekLeft', 'cheekRight', 'forehead']);
  });

  it('uses only the code band words, never percentages, never barrier support', () => {
    const view = buildScanView(input());
    const words = new Set(['Clear', 'Slight', 'Moderate', 'Marked', 'Off scale']);
    for (const row of view.concerns.rows) expect(words.has(row.severity!)).toBe(true);
    expect(view.concerns.rows.map((r) => r.id)).toEqual(['redness', 'texture', 'pores', 'hydration']);
    expect(view.cards.map((c) => c.id)).toEqual(['hydration', 'texture', 'redness']);
    for (const card of view.cards) {
      expect(card.valueKind).toBe('band');
      expect(card.value).not.toMatch(/%/);
      expect(card.arc).toBeNull();
      expect(words.has(card.value) || card.value === NOT_FLAGGED).toBe(true);
    }
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/Barrier|High|Mild|optimal|Needs care|%/);
  });

  it('shows no head without the live mesh, and says so rather than borrowing one', () => {
    const view = buildScanView(input({ hasMesh: false }));
    expect(view.mesh).toBe('cleared');
    const none = buildScanView(input({ analysis: null }));
    expect(none.phase).toBe('empty');
    expect(none.mesh).toBe('none');
    expect(none.status.title).toBe('Scan to see your map');
    expect(none.callouts).toEqual([]);
    expect(none.cards).toEqual([]);
  });

  it('falls back to neutral tiles when the capture is no longer in memory', () => {
    const view = buildScanView(input({ hasCapture: false }));
    expect(view.callouts.every((c) => c.thumb.kind === 'none')).toBe(true);
  });

  it('tracks the real pipeline in the header, never a timer', () => {
    expect(buildScanView(input({ analysis: null, scanActive: true })).status).toMatchObject({ title: 'Scan to see your map', live: false });
    const reading = buildScanView(input({ analysis: null, scanActive: true, scanProgress: 0.42, scanStage: 'measuring' }));
    expect(reading.phase).toBe('reading');
    expect(reading.status).toEqual({ title: 'Reading your skin', eyebrow: 'MEASURING · 42%', live: true });
    const narrating = buildScanView(input({ revealing: true, activeMetric: 'redness' }));
    expect(narrating.status.eyebrow).toBe('NOW · REDNESS');
    expect(narrating.status.live).toBe(true);
    expect(narrating.activeSlot).toBe('cheeks');
    expect(buildScanView(input()).status.live).toBe(false);
  });

  it('says nothing reached a band without calling the skin healthy', () => {
    const quiet = analysis();
    quiet.metrics = { ...quiet.metrics, redness: 5, texture: 5, pores: 5, hydration: 95 };
    const view = buildScanView(input({ analysis: quiet }));
    expect(view.concerns.rows).toEqual([]);
    expect(view.concerns.empty).toBe('Nothing reached the Slight band in this reading.');
    expect(JSON.stringify(view)).not.toMatch(/healthy|normal range|all clear/i);
    // A card below Slight says "Not flagged", never the band word "Clear" in headline type.
    const hydration = view.cards.find((c) => c.id === 'hydration')!;
    expect(hydration.value).toBe(NOT_FLAGGED);
    expect(JSON.stringify(view.cards)).not.toMatch(/"Clear"/);
  });

  it('lists every flagged metric under observed concerns, so the panels agree with the callouts', () => {
    const busy = analysis();
    busy.metrics = { ...busy.metrics, redness: 80, pores: 60, hydration: 40, texture: 55, oiliness: 30, underEye: 30 };
    const view = buildScanView(input({ analysis: busy }));
    const listed = new Set(view.concerns.rows.map((r) => r.metric));
    for (const c of view.callouts) for (const m of c.metrics) expect(listed.has(m)).toBe(true);
    expect(view.concerns.rows.length).toBeGreaterThanOrEqual(6);
  });

  it('says what the camera is doing in the capture header', () => {
    const at = (camera: ScanInput['camera']) => buildScanView(input({ analysis: null, scanActive: true, camera })).status.eyebrow;
    expect(at('live')).toBe('LIVE CAMERA · READ ON THIS DEVICE');
    expect(at('blocked')).toBe('NO CAMERA ACCESS · A PHOTO WORKS TOO');
    expect(at('starting')).toBe('OPENING THE CAMERA');
    expect(at('photo')).toBe('PHOTO CHOSEN · READ ON THIS DEVICE');
    expect(at('idle')).toBe('CAMERA OFF · READ ON THIS DEVICE');
  });

  it('names the part of the photo a thumbnail shows, not a claim about where it was measured', () => {
    expect(thumbLabel({ heading: 'T-ZONE', thumb: { kind: 'capture', region: 'nose' } })).toBe("T-zone: the nose, cut from this scan's photo");
    expect(thumbLabel({ heading: 'CHEEKS', thumb: { kind: 'none' } })).toBe('Cheeks: no photo');
  });

  it('maps every locus sentence observations.ts can produce', () => {
    expect(Object.keys(LOCUS_PLACE)).toHaveLength(8);
    expect(LOCUS_PLACE['Fairly even across the face.']).toBeUndefined();
  });
});

describe('consult room plates (public/env/consult)', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseConsultPlate, pinPlate, placeOnStage } = await import('../src/pages/scan/consult-plate.ts');
  const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../public/env/consult/${file}`, import.meta.url), 'utf8'));

  it('reads the landscape set with its ref4 framing, and lines ref4 up with the stage', () => {
    const plate = parseConsultPlate(read('anchors.json'), 'desk');
    expect(plate?.refFrame).not.toBeNull();
    expect(plate!.base[0].src).toMatch(/^\/env\/consult\/plate-\d+\.webp$/);
    const stage = { x: 0, y: 0, w: 1672, h: 941 };
    const r = placeOnStage(plate!, { w: 1672, h: 941 }, stage);
    // refFrame's corner lands on the stage's corner, and the plate covers the box.
    expect(r.x + plate!.refFrame!.x * r.w).toBeCloseTo(0, 0);
    expect(r.x).toBeLessThanOrEqual(0);
    expect(r.y + r.h).toBeGreaterThanOrEqual(941);
  });

  it('reads the phone-portrait set (no ref4 framing) and pins its emitter where asked', () => {
    expect(parseConsultPlate(read('anchors-mobile.json'), 'desk')).toBeNull();
    const plate = parseConsultPlate(read('anchors-mobile.json'), 'mobile');
    expect(plate?.refFrame).toBeNull();
    expect(plate!.base[0].src).toMatch(/^\/env\/consult\/mobile-plate-\d+\.webp$/);
    const box = { w: 390, h: 844 };
    const at: [number, number] = [0.5, 0.5];
    const r = pinPlate(plate!, box, plate!.points.emitter_centre, at);
    expect(r.x + plate!.points.emitter_centre[0] * r.w).toBeCloseTo(195, 0);
    expect(r.y + plate!.points.emitter_centre[1] * r.h).toBeCloseTo(422, 0);
    expect(r.x).toBeLessThanOrEqual(0);
    expect(r.y).toBeLessThanOrEqual(0);
    expect(r.x + r.w).toBeGreaterThanOrEqual(390);
    expect(r.y + r.h).toBeGreaterThanOrEqual(844);
  });

  it('refuses anything malformed', () => {
    expect(parseConsultPlate(null)).toBeNull();
    expect(parseConsultPlate({ plate: { w: 10, h: 10 }, refFrame: { x: 0 } })).toBeNull();
    expect(parseConsultPlate({ plate: { w: 10, h: 10 }, refFrame: { x: 0, y: 0, w: 1, h: 1 }, files: { plate: { files: ['../x-10.webp'] } } })).toBeNull();
  });
});
