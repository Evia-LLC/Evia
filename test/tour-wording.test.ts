/**
 * The consult tour's wording (specs/consult-tour.md 12.3): cosmetic observations of appearance only.
 * The founder's word "diagnoses" and its relatives never reach the screen or her voice; real-mode
 * step text never carries a number. Every string here is on the counsel list (design/counsel/scan.md 10).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NO_FLAG_LINE, NO_PIN_LINE, PLACE_INTRO, TOUR_INTRO, realTourSteps } from '../src/scan/tour-steps.ts';
import { SAMPLE_TOUR } from '../src/sample/fixtures/scan.ts';
import { TOUR_STATUS } from '../src/stage/tour-machine.ts';
import { buildScanView, type ExplainStyle } from '../src/view/scan.ts';
import { placedAnalysis } from './fixtures/tour-reading.ts';
import type { SkinMetricKey } from '../shared/types.ts';

const BANNED =
  /diagnos|disease|disorder|condition|clinical|medical|treat|cure|prescri|symptom|dermatolog|patholog|infect|lesion|eczema|rosacea|psoriasis|melasma|acne\b|healthy|normal range|all clear|damage/i;

/** The UI and accessibility strings of 12.3 as they appear in the components. */
const UI = [
  'Walkthrough',
  'WALKTHROUGH',
  'Pause',
  'Resume',
  'Previous',
  'Next',
  'Show all results',
  'Replay walkthrough',
  'Or select any area to hear it again.',
  'Prototype stand-in',
  'AGAIN',
  'OF',
  'NOW',
  'Pause the walkthrough',
  'Resume the walkthrough',
  'Previous area',
  'Next area',
  'Explain Forehead again',
  TOUR_STATUS.paused,
  TOUR_STATUS.resumed,
  TOUR_STATUS.summary,
  TOUR_STATUS.again('Forehead'),
];

describe('tour wording', () => {
  it('keeps diagnosis words out of every fixed string', () => {
    const fixed = [TOUR_INTRO, NO_PIN_LINE, NO_FLAG_LINE, ...Object.values(PLACE_INTRO), ...SAMPLE_TOUR.map((s) => s.text), ...UI];
    for (const s of fixed) expect(s, s).not.toMatch(BANNED);
  });

  it('says what she can see (observations, not verdicts) in the sample lines', () => {
    for (const s of SAMPLE_TOUR) expect(s.text).toMatch(/I can see|looks?/);
  });

  it('shows the UI strings as written in the components', () => {
    const talk = readFileSync(new URL('../src/pages/scan/TalkCard.svelte', import.meta.url), 'utf8');
    const replay = readFileSync(new URL('../src/pages/scan/ReplayRow.svelte', import.meta.url), 'utf8');
    for (const s of ['Pause the walkthrough', 'Resume the walkthrough', 'Previous area', 'Next area', 'Show all results', 'Prototype stand-in', 'WALKTHROUGH', 'aria-label="Walkthrough"']) {
      expect(talk).toContain(s);
    }
    expect(replay).toContain('Replay walkthrough');
    expect(replay).toContain('Or select any area to hear it again.');
  });

  it('keeps real-mode step text free of diagnosis words and of any number, over every metric, band and style', () => {
    const keys: SkinMetricKey[] = ['hydration', 'oiliness', 'redness', 'texture', 'pores', 'darkSpots', 'evenness', 'underEye', 'acneIndicators'];
    const higherIsBetter = new Set<SkinMetricKey>(['hydration', 'evenness']);
    // Concern levels: clear, slight, moderate, marked, off scale.
    const concerns = [10, 30, 60, 85, 100];
    for (const style of ['detailed', 'genz'] as ExplainStyle[]) {
      for (const key of keys) {
        for (const concern of concerns) {
          const value = higherIsBetter.has(key) ? 100 - concern : concern;
          const analysis = placedAnalysis({ [key]: value });
          const view = buildScanView({ analysis, hasBody: false, hasMesh: true, hasCapture: false, scanActive: false, scanProgress: 0, scanStage: '' });
          for (const step of realTourSteps(view, analysis, style)) {
            expect(step.text, step.text).not.toMatch(BANNED);
            expect(step.text, step.text).not.toMatch(/[0-9%]/);
          }
        }
      }
    }
  });
});
