/**
 * The consult room's Blender plate, as the Scan page composes it.
 *
 * Loading goes the one way every room loads: `loadAnchors('consult', kind)`
 * (src/stage/room-anchors.ts) reads `public/env/consult/anchors.json` - or
 * `anchors-mobile.json` for the phone-portrait set - in the Blender job's own
 * format (consult_post.py: `plate`, `refFrame`, `files`, `surfaces`,
 * `curves`), and `Room.svelte` draws the plates (srcset, the LED boost layer,
 * the stand-in until the render has decoded).
 *
 * What stays here is the one thing a box-shaped cover cannot do: line the
 * plate up with the ref4 design *stage* - a rect inside the viewport, not the
 * viewport itself - through `refFrame` (where the mockup's 1672x941 framing
 * sits inside the over-scanned render), so the pedestal lands under the tray
 * and the wall text on its walls; and, for the portrait layouts, pin the
 * pedestal's emitter under the hologram. The page computes that rect here and
 * hands it to `<Room rect>`.
 *
 * The phone-portrait set has no ref4 framing (`refFrame: null`), so it is only
 * ever pinned (`pinPlate`), and the page uses it for narrow portrait windows,
 * where the landscape plate would have to be blown up to cover the height.
 *
 * Pure placement arithmetic below; `loadConsultPlate` is the only I/O.
 */
import { loadAnchors, parseAnchors, type Point, type Quad, type RoomAnchors } from '@/stage/room-anchors.ts';

export interface ConsultSurface {
  quad: Quad;
  text?: string;
  lines?: string[];
  tone?: string;
  blurPx?: number;
}

export interface ConsultPlate {
  /** Render size, px. */
  w: number;
  h: number;
  /** Where the ref4 framing sits in the plate, normalised; null for the portrait set. */
  refFrame: { x: number; y: number; w: number; h: number } | null;
  /** Base plate files, largest first, with their widths. */
  base: { src: string; w: number }[];
  surfaces: Record<string, ConsultSurface>;
  curves: Record<string, Point[]>;
  points: Record<string, Point>;
  /** The anchors as Room reads them. */
  anchors: RoomAnchors;
}

/** Which render: the landscape one framed on ref4, or the phone-portrait one. */
export type PlateKind = 'desk' | 'mobile';

const ROOT = '/env/consult/';

/**
 * The Scan page's view of a room's anchors. The landscape set must say where
 * ref4 sits in it (it is useless to the desk composition otherwise); the
 * portrait set may not.
 */
export function consultPlateFrom(anchors: RoomAnchors | null, kind: PlateKind = 'desk'): ConsultPlate | null {
  if (!anchors) return null;
  const refFrame = anchors.ref ?? null;
  if (kind === 'desk' && !refFrame) return null;
  const main = anchors.plates?.find((p) => (p.kind ?? 'base') === 'base');
  if (!main) return null;
  const widths = main.widths?.length ? main.widths : [Number(/-(\d+)\.webp$/.exec(main.src)?.[1] ?? 0)];
  const base = widths
    .filter((w) => w > 0)
    .sort((a, b) => b - a)
    .map((w) => ({ src: ROOT + main.src.replace(/-\d+\.webp$/, `-${w}.webp`), w }));
  if (!base.length) return null;
  return {
    w: anchors.frame.w,
    h: anchors.frame.h,
    refFrame,
    base,
    surfaces: anchors.surfaces ?? {},
    curves: anchors.curves ?? {},
    points: anchors.points ?? {},
    anchors,
  };
}

/** Reads the Blender job's anchors file defensively (via parseAnchors); anything malformed is null. */
export function parseConsultPlate(raw: unknown, kind: PlateKind = 'desk'): ConsultPlate | null {
  return consultPlateFrom(parseAnchors(raw), kind);
}

/** The set's anchors, loaded once per page load the way every room's are; null when there is no render. */
export function loadConsultPlate(kind: PlateKind = 'desk'): Promise<ConsultPlate | null> {
  return loadAnchors('consult', kind).then((anchors) => consultPlateFrom(anchors, kind));
}

/** A plate placed in a box: its top-left and size in CSS px. */
export interface PlateRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Places the plate so its `refFrame` covers `stage` exactly (the desktop
 * composition, drawn in ref4 pixels), then grows it about the stage centre if
 * that leaves any of the `box` uncovered, and keeps it covering.
 */
export function placeOnStage(plate: ConsultPlate, box: { w: number; h: number }, stage: PlateRect): PlateRect {
  const rf = plate.refFrame ?? { x: 0, y: 0, w: 1, h: 1 };
  let w = stage.w / rf.w;
  let h = stage.h / rf.h;
  let x = stage.x - rf.x * w;
  let y = stage.y - rf.y * h;
  const need = Math.max(1, box.w / w, box.h / h);
  if (x > 0 || y > 0 || x + w < box.w || y + h < box.h) {
    // Grow about the stage centre until the box is covered on every side.
    const cx = stage.x + stage.w / 2;
    const cy = stage.y + stage.h / 2;
    let k = need;
    const fits = (s: number) => {
      const nx = cx - (cx - x) * s;
      const ny = cy - (cy - y) * s;
      return nx <= 0 && ny <= 0 && nx + w * s >= box.w && ny + h * s >= box.h;
    };
    while (!fits(k) && k < 4) k *= 1.02;
    x = cx - (cx - x) * k;
    y = cy - (cy - y) * k;
    w *= k;
    h *= k;
  }
  return { x, y, w, h };
}

/**
 * Places the plate so a point of it (normalised) lands at a point of the box
 * (fractions), at the smallest scale that still covers the box. For the
 * portrait layouts, which pin the pedestal's emitter under the hologram.
 */
export function pinPlate(plate: ConsultPlate, box: { w: number; h: number }, point: Point, at: Point): PlateRect {
  const aspect = plate.w / plate.h;
  const tx = at[0] * box.w;
  const ty = at[1] * box.h;
  // Height so that the point is at ty with the plate still reaching both the top and the bottom.
  const hTop = point[1] > 0 ? ty / point[1] : 0;
  const hBottom = point[1] < 1 ? (box.h - ty) / (1 - point[1]) : 0;
  let h = Math.max(box.h, hTop, hBottom);
  let w = h * aspect;
  const wLeft = point[0] > 0 ? tx / point[0] : 0;
  const wRight = point[0] < 1 ? (box.w - tx) / (1 - point[0]) : 0;
  const wNeed = Math.max(box.w, wLeft, wRight);
  if (w < wNeed) {
    w = wNeed;
    h = w / aspect;
  }
  return { x: tx - point[0] * w, y: ty - point[1] * h, w, h };
}

/** A plate-normalised point, in box px. */
export function platePoint(rect: PlateRect, [u, v]: Point): Point {
  return [rect.x + u * rect.w, rect.y + v * rect.h];
}
