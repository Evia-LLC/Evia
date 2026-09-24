/**
 * The consult room's Blender plate, as the Scan page places it.
 *
 * `public/env/consult/anchors.json` is written by the Blender job
 * (scripts/blender/consult_post.py) in its own format - `plate`, `refFrame`,
 * `files`, `surfaces`, `curves` - which `Room.svelte`'s anchor reader does not
 * parse yet (it expects `frame` and `plates`; requested from the lead). The
 * Scan page also needs one thing Room does not do: line the plate up with the
 * ref4 design stage through `refFrame` (where the mockup's 1672x941 framing
 * sits inside the over-scanned render), so the pedestal lands under the tray
 * and the wall text on its walls. So the page reads the file here and places
 * the plate itself, over Room's CSS stand-in, until Room can.
 *
 * The job also renders a phone-portrait set (`mobile-*`, `anchors-mobile.json`)
 * from its own camera: it has no ref4 framing (`refFrame: null`), so it is only
 * ever pinned (`pinPlate`), and the page uses it for narrow portrait windows,
 * where the landscape plate would have to be blown up to cover the height.
 *
 * Pure placement arithmetic below; `loadConsultPlate` is the only I/O.
 */
import type { Point, Quad } from '@/stage/room-anchors.ts';

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
  /** The LED boost layer (plus-lighter), same sizes. */
  neon: { src: string; w: number }[];
  surfaces: Record<string, ConsultSurface>;
  curves: Record<string, Point[]>;
  points: Record<string, Point>;
}

const ROOT = '/env/consult/';

function widthOf(file: string): number {
  const m = /-(\d+)\.webp$/.exec(file);
  return m ? Number(m[1]) : 0;
}

function isPoint(p: unknown): p is Point {
  return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function fileList(value: unknown): { src: string; w: number }[] {
  const files = (value as { files?: unknown })?.files;
  if (!Array.isArray(files)) return [];
  return files
    .filter((f): f is string => typeof f === 'string' && /^[\w.-]+\.webp$/.test(f))
    .map((f) => ({ src: ROOT + f, w: widthOf(f) }))
    .filter((f) => f.w > 0)
    .sort((a, b) => b.w - a.w);
}

/** Which render: the landscape one framed on ref4, or the phone-portrait one. */
export type PlateKind = 'desk' | 'mobile';

function readRefFrame(value: unknown): ConsultPlate['refFrame'] | undefined {
  if (value === null) return null;
  const rf = value as { x?: number; y?: number; w?: number; h?: number } | undefined;
  if (!rf || ![rf.x, rf.y, rf.w, rf.h].every((n) => typeof n === 'number' && Number.isFinite(n)) || !(rf.w! > 0) || !(rf.h! > 0)) return undefined;
  return { x: rf.x!, y: rf.y!, w: rf.w!, h: rf.h! };
}

/**
 * Reads the Blender job's anchors file defensively; anything malformed is null.
 * The landscape set must say where ref4 sits in it; the portrait set may not.
 */
export function parseConsultPlate(raw: unknown, kind: PlateKind = 'desk'): ConsultPlate | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const plate = a.plate as { w?: number; h?: number } | undefined;
  if (!plate || !(Number(plate.w) > 0) || !(Number(plate.h) > 0)) return null;
  const refFrame = readRefFrame(a.refFrame ?? null);
  if (refFrame === undefined || (kind === 'desk' && !refFrame)) return null;
  const files = (a.files ?? {}) as Record<string, unknown>;
  const base = fileList(files.plate);
  if (!base.length) return null;
  const surfaces: Record<string, ConsultSurface> = {};
  for (const [name, s] of Object.entries((a.surfaces ?? {}) as Record<string, ConsultSurface>)) {
    if (s && Array.isArray(s.quad) && s.quad.length === 4 && s.quad.every(isPoint)) surfaces[name] = s;
  }
  const curves: Record<string, Point[]> = {};
  for (const [name, c] of Object.entries((a.curves ?? {}) as Record<string, { points?: unknown }>)) {
    if (Array.isArray(c?.points) && c.points.every(isPoint)) curves[name] = c.points as Point[];
  }
  const points: Record<string, Point> = {};
  for (const [name, p] of Object.entries((a.points ?? {}) as Record<string, unknown>)) if (isPoint(p)) points[name] = p;
  return {
    w: Number(plate.w),
    h: Number(plate.h),
    refFrame,
    base,
    neon: fileList(files.glow_neon),
    surfaces,
    curves,
    points,
  };
}

const pending: Partial<Record<PlateKind, Promise<ConsultPlate | null>>> = {};

/** Fetches and parses a set's anchors once per page load; null when there is no render. */
export function loadConsultPlate(kind: PlateKind = 'desk'): Promise<ConsultPlate | null> {
  const file = kind === 'mobile' ? 'anchors-mobile.json' : 'anchors.json';
  pending[kind] ??= fetch(`${ROOT}${file}`, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      return parseConsultPlate(await res.json(), kind);
    })
    .catch(() => null);
  return pending[kind];
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
