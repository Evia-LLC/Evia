/**
 * The consult tour's steps (specs/consult-tour.md 5.7 and 12): what is tapped, what glows, what the
 * card says and what she says, one place on the face at a time. Pure.
 *
 * Sample mode: SAMPLE_TOUR over SAMPLE_SCAN's callouts (the mockup's text, under the badge).
 *
 * Real mode: one step per callout of the live view, in the page's reading order (forehead, T-zone,
 * cheeks, under-eyes, chin), and nothing else: only findings that reached a band and that the reading
 * itself places on the face. Her sentence names the place, then each finding with its band word and
 * the card copy counsel already has (FLAGGED_COPY / BEYOND_COPY, verbatim but for the first letter).
 * Never a 0-100 value, a percentage, a composite grade, a verdict of "clear", a place the reading
 * did not name, or anything from the sample fixture.
 *
 * Every string here is a cosmetic observation of appearance ("I can see", "looks", "in this photo")
 * and is on the counsel list (design/counsel/scan.md section 10); test/tour-wording.test.ts keeps
 * diagnosis words out of them.
 */
import type { SkinAnalysis } from '@shared/types.ts';
import { SAMPLE_SCAN, SAMPLE_TOUR } from '@/sample/fixtures/scan.ts';
import { observationsFor } from '@/skin-analysis/observations.ts';
import { sideFor, type TourStep } from '@/stage/tour-machine.ts';
import { BEYOND_COPY, FLAGGED_COPY, buildScanView, type ExplainStyle, type ScanCallout, type ScanView } from '@/view/scan.ts';

/** Clean (both modes): before the first place. */
export const TOUR_INTRO = "Let's look at what I can see, one area at a time.";
/** Real: findings reached a band, but none is placed on the face. */
export const NO_PIN_LINE = 'Nothing in this reading is pinned to one place on the face, so here is everything at once.';
/** Real: nothing reached a band. */
export const NO_FLAG_LINE = 'Nothing in this photo reached the Slight band. One photo is not a health check.';

/** How each place is introduced (real mode), by the callout heading. */
export const PLACE_INTRO: Record<string, string> = {
  FOREHEAD: 'On the forehead.',
  'BETWEEN THE BROWS': 'Between the brows.',
  'T-ZONE': 'Across the T-zone.',
  NOSE: 'Around the nose.',
  CHEEKS: 'On the cheeks.',
  'UNDER-EYES': 'Under the eyes.',
  CHIN: 'On the chin.',
  'AROUND THE MOUTH': 'Around the mouth.',
  'CHIN & MOUTH': 'Around the chin and mouth.',
};

/** A callout heading in sentence case: FOREHEAD -> Forehead, T-ZONE -> T-zone, CHIN & MOUTH -> Chin & mouth. */
export function titleOf(heading: string): string {
  return heading.charAt(0) + heading.slice(1).toLowerCase();
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Sample: SAMPLE_TOUR joined with SAMPLE_SCAN's callouts (lines, title). */
export function sampleTourSteps(): TourStep[] {
  return SAMPLE_TOUR.flatMap((t) => {
    const callout = SAMPLE_SCAN.callouts.find((c) => c.slot === t.slot);
    if (!callout) return [];
    return [
      {
        slot: t.slot,
        title: titleOf(callout.heading),
        contact: t.contact,
        zones: t.zones.map((z) => ({ ...z })),
        metric: t.metric,
        side: sideFor(t.contact),
        lines: [...callout.lines],
        text: t.text,
      },
    ];
  });
}

/** Her sentence for one real callout (spec 12.1). */
export function realStepText(callout: ScanCallout, analysis: SkinAnalysis, style: ExplainStyle): string {
  const byKey = new Map(observationsFor(analysis.metrics, analysis.regions ?? {}).map((o) => [o.key, o]));
  const parts = [PLACE_INTRO[callout.heading] ?? `${titleOf(callout.heading)}.`];
  for (const key of callout.metrics.slice(0, 3)) {
    const o = byKey.get(key);
    if (!o || o.severity === 'clear') continue;
    const copy = o.severity === 'beyond-range' ? BEYOND_COPY[style] : FLAGGED_COPY[key][style];
    parts.push(`${o.label}, ${o.severityLabel.toLowerCase()}: ${lowerFirst(copy)}`);
  }
  return parts.join(' ');
}

/** Real: one step per callout of the view, in its (reading) order. */
export function realTourSteps(view: ScanView, analysis: SkinAnalysis, style: ExplainStyle): TourStep[] {
  return view.callouts.map((callout) => {
    const places = new Set(callout.regions);
    return {
      slot: callout.slot,
      title: titleOf(callout.heading),
      contact: callout.anchor,
      zones: view.highlights.filter((h) => places.has(h.region)).map((h) => ({ ...h })),
      metric: callout.metrics[0] ?? null,
      side: sideFor(callout.anchor),
      lines: [...callout.lines],
      text: realStepText(callout, analysis, style),
    };
  });
}

/** What she says on the clean face: the intro, or why there is nothing to go through place by place. */
export function tourIntro(view: ScanView): string {
  if (view.mode === 'real') {
    if (!view.concerns.rows.length) return NO_FLAG_LINE;
    if (!view.callouts.length) return NO_PIN_LINE;
  }
  return TOUR_INTRO;
}

/** Everything she may say on a real reading's tour, for the voice to fetch before the face forms. */
export function realTourTexts(analysis: SkinAnalysis, style: ExplainStyle): string[] {
  const view = buildScanView({
    analysis,
    hasBody: false,
    hasMesh: true,
    hasCapture: false,
    scanActive: false,
    scanProgress: 0,
    scanStage: '',
  });
  return [tourIntro(view), ...realTourSteps(view, analysis, style).map((s) => s.text)];
}
