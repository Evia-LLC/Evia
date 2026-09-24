/**
 * Room plates and their anchors: the maths `Room.svelte` and `RoomSurface.svelte`
 * share, kept free of the DOM so it can be tested.
 *
 * A room is a rendered picture (a Blender plate) shown with `object-fit: cover`,
 * so at any window shape part of it is cropped away. Anything that belongs *on*
 * the picture - wall text, the acrylic sign, the pedestal's engraving, where a
 * character would stand - is described in `anchors.json` in the picture's own
 * coordinates (0..1 of the render frame, top-left origin). `coverFit` works out
 * where the frame landed in the box, `toPx` carries a point across, and
 * `quadMatrix` bends an HTML box onto a four-cornered surface with a CSS
 * `matrix3d`, so the text sits on its wall at every aspect ratio.
 *
 * The file format (`/env/<room>/anchors.json`), all coordinates normalised:
 *
 *   {
 *     "frame":    { "w": 2560, "h": 1440, "focus": [0.5, 0.5] },
 *     "plates":   [ { "src": "room.webp", "kind": "base" },
 *                   { "src": "cove-delta.webp", "kind": "glow", "blend": "plus-lighter", "animate": "breathe" },
 *                   { "src": "fg.webp", "kind": "fg" },
 *                   { "src": "blur.webp", "kind": "blur" } ],
 *     "surfaces": { "niche_text": { "quad": [[x,y],[x,y],[x,y],[x,y]], "blurPx": 1.1 } },
 *     "points":   { "character": [x, y] },
 *     "ellipses": { "pedestal_top": { "cx": .5, "cy": .8, "rx": .1, "ry": .02 } }
 *   }
 *
 * Quads run clockwise from the top-left: TL, TR, BR, BL. `blurPx` is measured at
 * the frame's own width and is scaled to the rendered width. Without `plates`,
 * a single `room.webp` is assumed. The Blender job's richer fields (layers,
 * light, curves) are allowed and ignored here until something reads them.
 */

import { getContext, setContext } from 'svelte';
import { PUBLISHED_ROOMS } from './env-rooms.ts';

export type RoomId = 'lounge' | 'consult' | 'lounge-strip-window' | 'lounge-strip-interior' | 'products-hero';

export type Point = [number, number];
/** TL, TR, BR, BL. */
export type Quad = [Point, Point, Point, Point];

export interface RoomPlate {
  src: string;
  kind?: 'base' | 'sky' | 'glow' | 'fg' | 'blur';
  blend?: string;
  animate?: 'breathe' | 'none';
  opacity?: number;
}

export interface RoomSurfaceAnchor {
  quad: Quad;
  blurPx?: number;
  tone?: string;
}

export interface RoomAnchors {
  frame: { w: number; h: number; focus?: Point };
  plates?: RoomPlate[];
  surfaces?: Record<string, RoomSurfaceAnchor>;
  points?: Record<string, Point>;
  ellipses?: Record<string, { cx: number; cy: number; rx: number; ry: number }>;
}

/** Where a frame of `frameW` x `frameH` lands inside a box under object-fit: cover. */
export interface Fit {
  /** CSS px per frame px. */
  scale: number;
  /** Offset of the frame's top-left corner in the box (negative when cropped). */
  x: number;
  y: number;
  /** The frame's rendered size. */
  w: number;
  h: number;
}

export function coverFit(frameW: number, frameH: number, boxW: number, boxH: number, focus: Point = [0.5, 0.5]): Fit {
  if (frameW <= 0 || frameH <= 0 || boxW <= 0 || boxH <= 0) return { scale: 0, x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.max(boxW / frameW, boxH / frameH);
  const w = frameW * scale;
  const h = frameH * scale;
  // object-position semantics: the focus fraction of the overflow is cut from the left/top.
  return { scale, w, h, x: (boxW - w) * focus[0], y: (boxH - h) * focus[1] };
}

/** A normalised frame point to box px. */
export function toPx(fit: Fit, [u, v]: Point): Point {
  return [fit.x + u * fit.w, fit.y + v * fit.h];
}

/** `object-position` for the same focus, so the <img> and the maths agree. */
export function objectPosition(focus: Point = [0.5, 0.5]): string {
  return `${focus[0] * 100}% ${focus[1] * 100}%`;
}

/**
 * The CSS matrix3d that maps a `width` x `height` box (transform-origin 0 0,
 * placed at the box's 0,0) onto the quad `dst` (px, TL TR BR BL).
 *
 * The projective map from the unit square to a quad (Heckbert 1989), scaled
 * by the box size and written column-major the way matrix3d wants it.
 */
export function quadMatrix(width: number, height: number, dst: Quad): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = dst;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // A parallelogram: affine is enough.
    a = x1 - x0;
    b = x2 - x1;
    c = x0;
    d = y1 - y0;
    e = y2 - y1;
    f = y0;
    g = 0;
    h = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }

  const w = width || 1;
  const hh = height || 1;
  const m = [a / w, d / w, 0, g / w, b / hh, e / hh, 0, h / hh, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((n) => +n.toPrecision(10)).join(',')})`;
}

/** Applies the same projective map to a box point, for tests and hit-testing. */
export function applyQuad(width: number, height: number, dst: Quad, [x, y]: Point): Point {
  const m = quadMatrix(width, height, dst)
    .slice(9, -1)
    .split(',')
    .map(Number);
  const X = m[0] * x + m[4] * y + m[12];
  const Y = m[1] * x + m[5] * y + m[13];
  const W = m[3] * x + m[7] * y + m[15];
  return [X / W, Y / W];
}

/** Reads a fetched anchors file defensively: anything malformed is dropped. */
export function parseAnchors(value: unknown): RoomAnchors | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<RoomAnchors>;
  const frame = raw.frame;
  if (!frame || !(frame.w > 0) || !(frame.h > 0)) return null;
  const isPoint = (p: unknown): p is Point =>
    Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
  const surfaces: Record<string, RoomSurfaceAnchor> = {};
  for (const [name, s] of Object.entries(raw.surfaces ?? {})) {
    if (s && Array.isArray(s.quad) && s.quad.length === 4 && s.quad.every(isPoint)) {
      surfaces[name] = { quad: s.quad, blurPx: typeof s.blurPx === 'number' ? s.blurPx : undefined, tone: s.tone };
    }
  }
  const points: Record<string, Point> = {};
  for (const [name, p] of Object.entries(raw.points ?? {})) if (isPoint(p)) points[name] = p;
  const plates = Array.isArray(raw.plates)
    ? raw.plates.filter((p): p is RoomPlate => !!p && typeof p.src === 'string' && !p.src.includes('..'))
    : undefined;
  return {
    frame: { w: frame.w, h: frame.h, focus: isPoint(frame.focus) ? frame.focus : undefined },
    plates,
    surfaces,
    points,
    ellipses: raw.ellipses,
  };
}

/*
 * Built-in anchors for when no render has landed yet, so pages can already
 * place their wall text. Measured from the mockups (home.md section 2.14 for
 * the lounge niche and acrylic sign, in the 1536x1024 ref1 frame). The CSS
 * fallback room draws a soft panel on these same quads.
 */
const px = (fw: number, fh: number, q: [number, number][]): Quad =>
  q.map(([x, y]) => [x / fw, y / fh]) as Quad;

export const FALLBACK_ANCHORS: Record<RoomId, RoomAnchors> = {
  lounge: {
    frame: { w: 1536, h: 1024, focus: [0.5, 0.5] },
    surfaces: {
      niche_text: { quad: px(1536, 1024, [[852, 238], [975, 227], [975, 303], [851, 308]]), blurPx: 0.6 },
      sign_text: { quad: px(1536, 1024, [[898, 627], [990, 641], [990, 701], [897, 684]]), blurPx: 0.3 },
    },
    points: { character: [0.37, 0.95] },
  },
  consult: { frame: { w: 1672, h: 941, focus: [0.5, 0.5] }, surfaces: {}, points: {} },
  'lounge-strip-window': { frame: { w: 320, h: 1024, focus: [0.5, 0.5] }, surfaces: {}, points: {} },
  'lounge-strip-interior': { frame: { w: 160, h: 1287, focus: [0.5, 0.5] }, surfaces: {}, points: {} },
  'products-hero': { frame: { w: 1062, h: 311, focus: [0.5, 0.5] }, surfaces: {}, points: {} },
};

/* ---- context: Room publishes, RoomSurface and pages read ------------------ */

export interface RoomContext {
  readonly room: RoomId;
  readonly anchors: RoomAnchors;
  readonly fit: Fit;
  /** True while the CSS stand-in is showing (no plate yet, or it failed). */
  readonly fallback: boolean;
  toPx(point: Point): Point;
}

const KEY = Symbol('evia.room');

export function setRoomContext(ctx: RoomContext): void {
  setContext(KEY, ctx);
}

/** The enclosing Room's geometry, or undefined outside one. */
export function useRoom(): RoomContext | undefined {
  return getContext<RoomContext | undefined>(KEY);
}

/* ---- loading, cached per room for the life of the page ------------------- */

const cache = new Map<RoomId, Promise<RoomAnchors | null>>();

/**
 * Fetches `/env/<room>/anchors.json` for a room with a published render
 * (env-rooms.ts), and resolves to null at once for one without. A missing or
 * malformed file also resolves to null - including a server answering an
 * unknown path with index.html - so the caller falls back cleanly.
 */
export function loadAnchors(room: RoomId, published: readonly RoomId[] = PUBLISHED_ROOMS): Promise<RoomAnchors | null> {
  if (!published.includes(room)) return Promise.resolve(null);
  let pending = cache.get(room);
  if (!pending) {
    pending = fetch(`/env/${room}/anchors.json`, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
        return parseAnchors(await res.json());
      })
      .catch(() => null);
    cache.set(room, pending);
  }
  return pending;
}
