/**
 * The Scan page's view model: everything the consult room shows, in one
 * record, from either the sample fixture or the live reading.
 *
 * `scanView()` is what the page calls (inside a `$derived`): sample mode gets
 * `SAMPLE_SCAN`, the mockup's own text; real mode gets `buildScanView(...)`
 * over the session and the stage director's hologram state. The builder is
 * pure so it can be tested without a browser.
 *
 * Real mode shows only what the analysis produced (specs/data-map.md 6 and 8):
 *
 * - Callouts are the per-metric observations (`observationsFor`), grouped by
 *   the region their own locus sentence names (`locusFor`). A metric without a
 *   locus (pores, breakout signs, tone evenness, or one that reads "fairly
 *   even") is not pinned to a place on the face; it is still in the concern
 *   list. A region with nothing to say has no callout.
 * - Severity words are the code's own bands from `severityFor`: Slight,
 *   Moderate, Marked, Off scale (callouts, concerns, cards). The mockup's "High"
 *   and "Mild" are not in that vocabulary and are never produced here. The
 *   fifth band, "Clear", is not shown: a card for a metric below Slight says
 *   "Not flagged" (see NOT_FLAGGED).
 * - Metric cards carry the band word, never a percentage (the readings are
 *   0-100 appearance indices, not quantities), with a neutral ring instead of
 *   a gauge, and only for metrics that exist: there is no "Barrier support".
 * - Thumbnails are crops of this session's capture while it is still in
 *   memory (the page cuts them; nothing is stored), else neutral tiles.
 * - The header says what the real pipeline is doing, never a timer.
 */
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_LABELS,
  type FaceRegionKey,
  type SkinAnalysis,
  type SkinMetricKey,
} from '@shared/types.ts';
import type { RegionHighlight, ZoneTone } from '@/hologram/regions.ts';
import { observationsFor, type Severity, type SkinObservation } from '@/skin-analysis/observations.ts';
import { SAMPLE_SCAN } from '@/sample/fixtures/scan.ts';
import { captureStatus, type CameraState } from '@/scan/capture-status.svelte.ts';
import { sample } from '@/sample/mode.svelte.ts';
import { director } from '@/stage/director.ts';
import { session } from '@/state/session.svelte.ts';

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** The five callout places around the head, in the mockup's order. */
export type CalloutSlot = 'forehead' | 'tzone' | 'cheeks' | 'underEyes' | 'chin';

/** Neutral skin-texture tiles for sample mode (no faces). */
export type ThumbArt = 'forehead' | 'pores' | 'cheeks' | 'underEyes' | 'chin';

/**
 * What a capture thumbnail shows, in words. It names the part of the photo the
 * tile was cut from, and no more: a finding is measured over the whole face and
 * said to be "most visible" in a place, so the tile is where it shows, not the
 * only pixels it came from. Sides are not named (the frame may be mirrored).
 */
export const CAPTURE_PART: Record<FaceRegionKey, string> = {
  forehead: 'the forehead',
  glabella: 'between the brows',
  nose: 'the nose',
  cheekLeft: 'one cheek',
  cheekRight: 'one cheek',
  periorbitalLeft: 'under one eye',
  periorbitalRight: 'under one eye',
  perioral: 'around the mouth',
  chin: 'the chin',
};

/** The accessible name of a callout's thumbnail. */
export function thumbLabel(callout: Pick<ScanCallout, 'heading' | 'thumb'>): string {
  const title = callout.heading.charAt(0) + callout.heading.slice(1).toLowerCase();
  switch (callout.thumb.kind) {
    case 'capture':
      return `${title}: ${CAPTURE_PART[callout.thumb.region]}, cut from this scan's photo`;
    case 'sample':
      return `${title}: sample skin texture, not a photo`;
    case 'none':
      return `${title}: no photo`;
  }
}

export type CalloutThumb =
  | { kind: 'sample'; art: ThumbArt }
  /** A crop of this session's capture, cut by the page while the capture is in memory. */
  | { kind: 'capture'; region: FaceRegionKey }
  | { kind: 'none' };

export interface ScanCallout {
  slot: CalloutSlot;
  heading: string;
  /** Up to three short lines. */
  lines: string[];
  /** The hologram anchor its leader line ends on. */
  anchor: FaceRegionKey;
  thumb: CalloutThumb;
  /** The metrics it speaks for (real mode), so the one being narrated can light it. */
  metrics: SkinMetricKey[];
}

export type ScanGlyph =
  | 'droplet'
  | 'texture'
  | 'redness'
  | 'pores'
  | 'barrier'
  | 'shield'
  | 'shine'
  | 'spot'
  | 'tone'
  | 'under-eye'
  | 'breakout';

/** The concern icon's stroke colour (the mockup gives each row its own). */
export type ConcernTone = 'blue' | 'steel' | 'rose' | 'periwinkle' | 'lavender';

export interface ScanConcern {
  id: string;
  label: string;
  glyph: ScanGlyph;
  tone: ConcernTone;
  /** The band word, or null to leave the column empty. */
  severity: string | null;
  metric: SkinMetricKey | null;
}

export type ExplainStyle = 'detailed' | 'genz';

export interface ScanCard {
  id: string;
  title: string;
  glyph: ScanGlyph;
  /** "62%" in sample mode; the band word ("Moderate") in real mode. */
  value: string;
  valueKind: 'percent' | 'band';
  /** Fraction of the ring drawn (decorative, sample only), or null for a plain ring. */
  arc: number | null;
  status: string | null;
  copy: Record<ExplainStyle, string>;
  metric: SkinMetricKey | null;
}

export interface ScanStatus {
  title: string;
  eyebrow: string;
  /** The real pipeline or her explanation is running right now: the dot pulses. */
  live: boolean;
}

export type ScanPhase = 'capture' | 'reading' | 'consultation' | 'body' | 'empty';

export interface ScanView {
  mode: 'sample' | 'real';
  phase: ScanPhase;
  status: ScanStatus;
  /**
   * Which face the hologram shows: the sample mesh, the live session mesh, none
   * because the presentation is over and the mesh was cleared, or none at all.
   */
  mesh: 'sample' | 'live' | 'cleared' | 'none';
  highlights: RegionHighlight[];
  /** The callout her narration is on right now. */
  activeSlot: CalloutSlot | null;
  callouts: ScanCallout[];
  concerns: { rows: ScanConcern[]; empty: string | null };
  cards: ScanCard[];
  capturedAt: string | null;
}

// ---------------------------------------------------------------------------
// Real mode
// ---------------------------------------------------------------------------

/**
 * Where each locus sentence (`locusFor`, src/skin-analysis/observations.ts)
 * puts a finding. Keyed on the exact sentences that function returns;
 * "Fairly even across the face." is deliberately absent - it names no place.
 */
export const LOCUS_PLACE: Record<string, { slot: CalloutSlot; regions: FaceRegionKey[] }> = {
  'Most visible across the T-zone.': { slot: 'tzone', regions: ['forehead', 'glabella', 'nose'] },
  'Most visible on the cheeks.': { slot: 'cheeks', regions: ['cheekLeft', 'cheekRight'] },
  'Most visible across the forehead.': { slot: 'forehead', regions: ['forehead'] },
  'Most visible between the brows.': { slot: 'forehead', regions: ['glabella'] },
  'Most visible around the nose.': { slot: 'tzone', regions: ['nose'] },
  'Most visible under the eyes.': { slot: 'underEyes', regions: ['periorbitalLeft', 'periorbitalRight'] },
  'Most visible around the mouth.': { slot: 'chin', regions: ['perioral'] },
  'Most visible around the chin.': { slot: 'chin', regions: ['chin'] },
};

const SLOT_ORDER: CalloutSlot[] = ['forehead', 'tzone', 'cheeks', 'underEyes', 'chin'];

/** The mockup's zone colours: forehead and cheeks pink, chin and left under-eye lavender, right under-eye periwinkle. */
const REGION_TONE: Record<FaceRegionKey, ZoneTone> = {
  forehead: 'pink',
  glabella: 'pink',
  nose: 'pink',
  cheekLeft: 'pink',
  cheekRight: 'pink',
  periorbitalLeft: 'lavender',
  periorbitalRight: 'periwinkle',
  perioral: 'lavender',
  chin: 'lavender',
};

/** How strongly a band lights its zone. */
const BAND_STRENGTH: Record<Severity, number> = {
  clear: 0,
  slight: 0.45,
  moderate: 0.7,
  marked: 0.9,
  'beyond-range': 0.9,
};

const GLYPH: Record<SkinMetricKey, ScanGlyph> = {
  hydration: 'droplet',
  oiliness: 'shine',
  redness: 'redness',
  texture: 'texture',
  pores: 'pores',
  darkSpots: 'spot',
  evenness: 'tone',
  underEye: 'under-eye',
  acneIndicators: 'breakout',
};

const TONE: Record<SkinMetricKey, ConcernTone> = {
  hydration: 'blue',
  oiliness: 'steel',
  redness: 'rose',
  texture: 'steel',
  pores: 'periwinkle',
  darkSpots: 'lavender',
  evenness: 'lavender',
  underEye: 'periwinkle',
  acneIndicators: 'rose',
};

/**
 * Card copy, in both registers, per metric. Short on purpose (two lines on a
 * card), qualified as appearance ("shows", "looks", "in this photo"), never a
 * diagnosis and never reassurance that skin is healthy (SRS MED-01, section
 * 10). On the counsel list (design/counsel/scan.md).
 */
const FLAGGED_COPY: Record<SkinMetricKey, Record<ExplainStyle, string>> = {
  hydration: {
    detailed: 'The surface reads rough, which often goes with dryness. Not a water test.',
    genz: 'Giving a little dry. It reads texture, not actual water.',
  },
  oiliness: {
    detailed: 'More shine shows in this photo than the rest of the reading.',
    genz: 'Shine is showing up on camera today.',
  },
  redness: {
    detailed: 'Some redness shows in this photo.',
    genz: 'Looking a little flushed in this pic.',
  },
  texture: {
    detailed: 'The surface looks uneven in this photo.',
    genz: 'Texture is a bit bumpy in this pic.',
  },
  pores: {
    detailed: 'Pores look more visible in this photo.',
    genz: 'Pores are showing up on camera.',
  },
  darkSpots: {
    detailed: 'Some darker spots show in this photo.',
    genz: 'A few darker spots on camera.',
  },
  evenness: {
    detailed: 'Tone looks uneven from one area to the next.',
    genz: 'Tone is a bit patchy across the face.',
  },
  underEye: {
    detailed: 'The under-eyes look darker than the cheeks.',
    genz: 'Under-eyes are a little shadowy.',
  },
  acneIndicators: {
    detailed: 'Some breakout-like spots show in this photo.',
    genz: 'A few breakout-looking spots on camera.',
  },
};

/**
 * A metric that reached no band. The card's headline says "Not flagged", not the
 * code's band word "Clear": in large type on a card, "Clear" reads as a clean
 * bill of health (code-scan.md 7 item 2, SRS section 10), and the absence of a
 * band is all this reading can say.
 */
export const NOT_FLAGGED = 'Not flagged';

const CLEAR_COPY: Record<ExplainStyle, string> = {
  detailed: 'This photo did not reach the Slight band. One photo is not a health check.',
  genz: 'Nothing flagged in this pic. One photo, not a check-up.',
};

const BEYOND_COPY: Record<ExplainStyle, string> = {
  detailed: 'Past the range a photo can read, so no band for this one.',
  genz: 'Out of range for a photo read, so no call on this one.',
};

function copyFor(o: SkinObservation): Record<ExplainStyle, string> {
  if (o.severity === 'clear') return CLEAR_COPY;
  if (o.severity === 'beyond-range') return BEYOND_COPY;
  return FLAGGED_COPY[o.key];
}

/** How much attention a reading asks for, whichever way the metric runs (as observations.ts). */
function concernOf(o: SkinObservation): number {
  return METRIC_HIGHER_IS_BETTER[o.key] ? 100 - o.value : o.value;
}

/** A metric key as the header says it. */
export function metricName(key: SkinMetricKey): string {
  return METRIC_LABELS[key];
}

function headingFor(slot: CalloutSlot, regions: Set<FaceRegionKey>): string {
  switch (slot) {
    case 'forehead':
      return regions.has('forehead') ? 'FOREHEAD' : 'BETWEEN THE BROWS';
    case 'tzone':
      return regions.has('forehead') || regions.has('glabella') ? 'T-ZONE' : 'NOSE';
    case 'cheeks':
      return 'CHEEKS';
    case 'underEyes':
      return 'UNDER-EYES';
    case 'chin':
      if (regions.has('chin') && regions.has('perioral')) return 'CHIN & MOUTH';
      return regions.has('chin') ? 'CHIN' : 'AROUND THE MOUTH';
  }
}

/** The anchor a slot's leader lands on, given which regions it speaks for. */
function anchorFor(slot: CalloutSlot, regions: Set<FaceRegionKey>): FaceRegionKey {
  switch (slot) {
    case 'forehead':
      return regions.has('forehead') ? 'forehead' : 'glabella';
    case 'tzone':
      return 'nose';
    case 'cheeks':
      return 'cheekLeft';
    case 'underEyes':
      return 'periorbitalRight';
    case 'chin':
      return regions.has('chin') ? 'chin' : 'perioral';
  }
}

export interface ScanInput {
  /** The reading on display (the director's), or null. */
  analysis: SkinAnalysis | null;
  hasBody: boolean;
  /** The live session mesh exists right now. */
  hasMesh: boolean;
  /** The measured frame is still in memory (for thumbnails). */
  hasCapture: boolean;
  scanActive: boolean;
  scanProgress: number;
  scanStage: string;
  activeMetric: SkinMetricKey | null;
  /** Her narration still has regions to light. */
  revealing: boolean;
  speaking: boolean;
  /** What the capture's camera is doing (capture phase). Defaults to 'live'. */
  camera?: CameraState;
  /**
   * A signed-in account, whose capture the configured provider (Perfect Corp,
   * main's Section 1) may read through Evia's server after the facial scan
   * consent. The capture header then does not say "read on this device".
   */
  providerMayRead?: boolean;
}

function timeOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The capture header's eyebrow: what the camera is actually doing. */
const CAMERA_EYEBROW: Record<CameraState, string> = {
  idle: 'CAMERA OFF · READ ON THIS DEVICE',
  starting: 'OPENING THE CAMERA',
  live: 'LIVE CAMERA · READ ON THIS DEVICE',
  blocked: 'NO CAMERA ACCESS · A PHOTO WORKS TOO',
  photo: 'PHOTO CHOSEN · READ ON THIS DEVICE',
};

/** The same, where the provider may read the capture: what the camera does, and no claim about where. */
const CAMERA_EYEBROW_PROVIDER: Record<CameraState, string> = {
  ...CAMERA_EYEBROW,
  idle: 'CAMERA OFF',
  live: 'LIVE CAMERA',
  photo: 'PHOTO CHOSEN',
};

/** The live header: what the pipeline, or her explanation, is doing now. */
function statusFor(input: ScanInput, phase: ScanPhase, capturedAt: string | null): ScanStatus {
  switch (phase) {
    case 'capture':
      return {
        title: 'Scan to see your map',
        eyebrow: (input.providerMayRead ? CAMERA_EYEBROW_PROVIDER : CAMERA_EYEBROW)[input.camera ?? 'live'],
        live: false,
      };
    case 'reading': {
      const stage = (input.scanStage || 'measuring').toUpperCase();
      return { title: 'Reading your skin', eyebrow: `${stage} · ${Math.round(input.scanProgress * 100)}%`, live: true };
    }
    case 'body':
      return { title: 'Your body reading', eyebrow: 'POSTURE · PROPORTIONS · READ ON THIS DEVICE', live: false };
    case 'empty':
      return { title: 'Scan to see your map', eyebrow: 'FACE MAPS ARE NEVER STORED', live: false };
    case 'consultation': {
      const explaining = input.revealing || (input.speaking && input.activeMetric !== null);
      if (explaining) {
        return {
          title: 'Going through your reading',
          eyebrow: input.activeMetric ? `NOW · ${metricName(input.activeMetric).toUpperCase()}` : 'FACE MAP · APPEARANCE ONLY',
          live: true,
        };
      }
      const at = timeOf(capturedAt);
      return { title: 'Your reading', eyebrow: `FACE MAP${at ? ` · ${at}` : ''} · APPEARANCE ONLY`, live: false };
    }
  }
}

/** The real view, from the analysis and the pipeline's state. Pure. */
export function buildScanView(input: ScanInput): ScanView {
  const phase: ScanPhase = input.scanActive
    ? input.scanProgress > 0
      ? 'reading'
      : 'capture'
    : input.analysis
      ? 'consultation'
      : input.hasBody
        ? 'body'
        : 'empty';
  const capturedAt = input.analysis?.capturedAt ?? null;
  const base: ScanView = {
    mode: 'real',
    phase,
    status: statusFor(input, phase, capturedAt),
    // The face is shown only with its reading: a mesh without one is mid-hand-off.
    mesh: input.analysis ? (input.hasMesh ? 'live' : 'cleared') : 'none',
    highlights: [],
    activeSlot: null,
    callouts: [],
    concerns: { rows: [], empty: null },
    cards: [],
    capturedAt,
  };
  if (phase !== 'consultation' || !input.analysis) return base;

  const observations = observationsFor(input.analysis.metrics, input.analysis.regions ?? {});
  const flagged = observations.filter((o) => o.severity !== 'clear').sort((a, b) => concernOf(b) - concernOf(a));

  // Callouts: flagged findings grouped by the place their locus names.
  const bySlot = new Map<CalloutSlot, { obs: SkinObservation[]; regions: Set<FaceRegionKey> }>();
  const strength = new Map<FaceRegionKey, number>();
  for (const o of flagged) {
    const place = o.locus ? LOCUS_PLACE[o.locus] : undefined;
    if (!place) continue;
    const entry = bySlot.get(place.slot) ?? { obs: [], regions: new Set<FaceRegionKey>() };
    entry.obs.push(o);
    place.regions.forEach((r) => entry.regions.add(r));
    bySlot.set(place.slot, entry);
    for (const r of place.regions) strength.set(r, Math.max(strength.get(r) ?? 0, BAND_STRENGTH[o.severity]));
  }
  const callouts: ScanCallout[] = SLOT_ORDER.filter((s) => bySlot.has(s)).map((slot) => {
    const { obs, regions } = bySlot.get(slot)!;
    const anchor = anchorFor(slot, regions);
    return {
      slot,
      heading: headingFor(slot, regions),
      lines: obs.slice(0, 3).map((o) => `${o.label} · ${o.severityLabel}`),
      anchor,
      thumb: input.hasCapture ? { kind: 'capture', region: anchor } : { kind: 'none' },
      metrics: obs.map((o) => o.key),
    };
  });
  const highlights: RegionHighlight[] = [...strength].map(([region, s]) => ({ region, tone: REGION_TONE[region], strength: s }));

  // Every flagged metric, so a finding with a callout on the face is always in the list too.
  const rows: ScanConcern[] = flagged.map((o) => ({
    id: o.key,
    label: o.label,
    glyph: GLYPH[o.key],
    tone: TONE[o.key],
    severity: o.severityLabel,
    metric: o.key,
  }));

  // Cards: the mockup's two real metrics, then whichever other reads highest.
  const byKey = new Map(observations.map((o) => [o.key, o]));
  const third = observations
    .filter((o) => o.key !== 'hydration' && o.key !== 'texture')
    .sort((a, b) => concernOf(b) - concernOf(a))[0];
  const cardKeys = (['hydration', 'texture'] as SkinMetricKey[]).concat(third ? [third.key] : []);
  const cards: ScanCard[] = cardKeys
    .map((k) => byKey.get(k))
    .filter((o): o is SkinObservation => !!o)
    .map((o) => ({
      id: o.key,
      title: o.label.toUpperCase(),
      glyph: GLYPH[o.key],
      value: o.severity === 'clear' ? NOT_FLAGGED : o.severityLabel,
      valueKind: 'band',
      arc: null,
      status: o.severity === 'clear' ? 'In this photo' : o.locus,
      copy: copyFor(o),
      metric: o.key,
    }));

  const activeSlot = input.activeMetric ? (callouts.find((c) => c.metrics.includes(input.activeMetric!))?.slot ?? null) : null;

  return {
    ...base,
    highlights,
    activeSlot,
    callouts,
    concerns: {
      rows,
      empty: rows.length ? null : 'Nothing reached the Slight band in this reading.',
    },
    cards,
  };
}

/** The page's view: the sample fixture, or the live reading. Reactive; call it inside `$derived`. */
export function scanView(): ScanView {
  if (sample.on) return SAMPLE_SCAN;
  const h = director.hologram;
  return buildScanView({
    analysis: h.analysis,
    hasBody: h.body !== null,
    hasMesh: h.mesh !== null,
    hasCapture: h.capture !== null,
    scanActive: session.scanActive,
    scanProgress: session.scanProgress,
    scanStage: session.scanStage,
    activeMetric: h.activeRegion,
    revealing: h.revealed.length < h.revealQueue.length,
    speaking: session.speaking,
    camera: captureStatus.camera,
    providerMayRead: !session.guest && session.user !== null,
  });
}
