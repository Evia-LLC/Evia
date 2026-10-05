/**
 * The consult tour's steps (src/scan/tour-steps.ts; specs/consult-tour.md 5.7, 12.1): the sample tour
 * over the mockup's callouts, and real steps built only from what the reading placed on the face.
 */
import { describe, expect, it } from 'vitest';
import { NO_FLAG_LINE, NO_PIN_LINE, PLACE_INTRO, TOUR_INTRO, realTourSteps, realTourTexts, sampleTourSteps, titleOf, tourIntro } from '../src/scan/tour-steps.ts';
import { SAMPLE_SCAN, SAMPLE_TOUR } from '../src/sample/fixtures/scan.ts';
import { BEYOND_COPY, FLAGGED_COPY, SLOT_ORDER, buildScanView } from '../src/view/scan.ts';
import type { SkinAnalysis } from '../shared/types.ts';
import { placedAnalysis } from './fixtures/tour-reading.ts';

function viewOf(analysis: SkinAnalysis) {
  return buildScanView({ analysis, hasBody: false, hasMesh: true, hasCapture: false, scanActive: false, scanProgress: 0, scanStage: '' });
}

describe('sample steps', () => {
  it('are SAMPLE_TOUR joined with the mockup callouts, in reading order', () => {
    const steps = sampleTourSteps();
    expect(steps.map((s) => s.slot)).toEqual(['forehead', 'tzone', 'cheeks', 'underEyes', 'chin']);
    steps.forEach((s, i) => {
      const callout = SAMPLE_SCAN.callouts.find((c) => c.slot === s.slot)!;
      expect(s.lines).toEqual(callout.lines);
      expect(s.title).toBe(titleOf(callout.heading));
      expect(s.text).toBe(SAMPLE_TOUR[i].text);
      expect(s.contact).toBe(SAMPLE_TOUR[i].contact);
    });
    // The T-zone is tapped on the nose; the under-eyes from the right.
    expect(steps[1].contact).toBe('nose');
    expect(steps.map((s) => s.side)).toEqual(['left', 'left', 'left', 'right', 'left']);
  });

  it('keeps the summary as the mockup (its own highlights and PORES leader)', () => {
    expect(SAMPLE_SCAN.callouts.find((c) => c.slot === 'tzone')!.anchor).toBe('periorbitalLeft');
    expect(SAMPLE_SCAN.highlights.some((h) => h.region === 'nose')).toBe(false);
    for (const c of SAMPLE_SCAN.callouts) expect(c.regions.length).toBeGreaterThan(0);
  });
});

describe('real steps', () => {
  it('come only from flagged findings the reading places on the face, in slot order', () => {
    const analysis = placedAnalysis();
    const view = viewOf(analysis);
    const steps = realTourSteps(view, analysis, 'detailed');
    expect(steps.map((s) => s.slot)).toEqual(view.callouts.map((c) => c.slot));
    expect(steps.map((s) => s.slot)).toEqual(SLOT_ORDER.filter((s) => steps.some((t) => t.slot === s)));
    expect(steps.map((s) => s.slot)).toEqual(['forehead', 'cheeks', 'underEyes', 'chin']);
    for (const s of steps) {
      const callout = view.callouts.find((c) => c.slot === s.slot)!;
      expect(s.contact).toBe(callout.anchor);
      expect(s.lines).toEqual(callout.lines);
      expect(s.metric).toBe(callout.metrics[0]);
      // Zones are a subset of the reading's highlights, and only its own regions.
      for (const z of s.zones) {
        expect(view.highlights).toContainEqual(z);
        expect(callout.regions).toContain(z.region);
      }
    }
    // Pores (no locus) are never a step.
    expect(steps.some((s) => s.text.includes('Pores'))).toBe(false);
  });

  it('say the place, then each finding with its band and the cards\' copy', () => {
    const analysis = placedAnalysis();
    const steps = realTourSteps(viewOf(analysis), analysis, 'detailed');
    expect(steps[0].text).toBe(`${PLACE_INTRO.FOREHEAD} Texture, moderate: ${FLAGGED_COPY.texture.detailed.charAt(0).toLowerCase()}${FLAGGED_COPY.texture.detailed.slice(1)}`);
    expect(steps[1].text.startsWith(PLACE_INTRO.CHEEKS)).toBe(true);
    const genz = realTourSteps(viewOf(analysis), analysis, 'genz');
    expect(genz[0].text).toContain(FLAGGED_COPY.texture.genz.slice(1));
    expect(genz[0].text).not.toBe(steps[0].text);
  });

  it('use the off-scale copy for a reading past the range', () => {
    const analysis = placedAnalysis({ texture: 100 });
    const steps = realTourSteps(viewOf(analysis), analysis, 'detailed');
    const forehead = steps.find((s) => s.slot === 'forehead')!;
    expect(forehead.text).toContain('Texture, off scale:');
    expect(forehead.text).toContain(BEYOND_COPY.detailed.slice(1));
  });

  it('pick the intro for what there is to go through', () => {
    const placed = viewOf(placedAnalysis());
    expect(tourIntro(placed)).toBe(TOUR_INTRO);
    // Flagged, but nowhere in particular (no region statistics).
    const unplaced = placedAnalysis();
    (unplaced as { regions: unknown }).regions = {};
    const v = viewOf(unplaced);
    expect(v.callouts).toEqual([]);
    expect(tourIntro(v)).toBe(NO_PIN_LINE);
    // Nothing flagged at all.
    const quiet = viewOf(placedAnalysis({ hydration: 95, evenness: 95, oiliness: 5, redness: 5, texture: 5, pores: 5, darkSpots: 5, underEye: 5, acneIndicators: 5 }));
    expect(tourIntro(quiet)).toBe(NO_FLAG_LINE);
    expect(tourIntro(SAMPLE_SCAN)).toBe(TOUR_INTRO);
  });

  it('are what the controller fetches for her voice before the face forms', () => {
    const analysis = placedAnalysis();
    const texts = realTourTexts(analysis, 'detailed');
    expect(texts[0]).toBe(TOUR_INTRO);
    expect(texts.slice(1)).toEqual(realTourSteps(viewOf(analysis), analysis, 'detailed').map((s) => s.text));
  });
});

describe('titles', () => {
  it('put callout headings in sentence case', () => {
    expect(titleOf('FOREHEAD')).toBe('Forehead');
    expect(titleOf('T-ZONE')).toBe('T-zone');
    expect(titleOf('UNDER-EYES')).toBe('Under-eyes');
    expect(titleOf('CHIN & MOUTH')).toBe('Chin & mouth');
    expect(titleOf('BETWEEN THE BROWS')).toBe('Between the brows');
  });
});
