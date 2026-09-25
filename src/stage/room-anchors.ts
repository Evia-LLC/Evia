/**
 * Room plates and their anchors: the maths `Room.svelte` and `RoomSurface.svelte`
 * share, kept free of the DOM so it can be tested.
 *
 * A room is a rendered picture (a Blender plate). Anything that belongs *on*
 * the picture - wall text, the acrylic sign, the pedestal's engraving, where a
 * character would stand - is described in `anchors.json` in the picture's own
 * coordinates (0..1 of the render frame, top-left origin). `coverFit` works out
 * where the frame lands in a box under `object-fit: cover`, `refFit` where it
 * lands when the mockup's own framing (`ref`) is what must cover the box,
 * `toPx` carries a point across, and `quadMatrix` bends an HTML box onto a
 * four-cornered surface with a CSS `matrix3d`, so the text sits on its wall at
 * every aspect ratio.
 *
 * Every room loads one way: `loadAnchors(room, variant)` fetches
 * `/env/<room>/anchors.json` (or `anchors-mobile.json` for the phone-portrait
 * render) and `parseAnchors` reads either of the two formats the Blender jobs
 * write:
 *
 * Room format (lounge, lounge-strip-window, products-hero), all normalised:
 *
 *   {
 *     "frame":    { "w": 2560, "h": 1440, "focus": [0.5, 0.5] },
 *     "plates":   [ { "src": "room-2560.webp", "kind": "base", "widths": [1280, 2560] },
 *                   { "src": "cove-delta.webp", "kind": "glow", "blend": "plus-lighter", "animate": "breathe" },
 *                   { "src": "fg.webp", "kind": "fg" },
 *                   { "src": "blur.webp", "kind": "blur" } ],
 *     "surfaces": { "niche_text": { "quad": [[x,y],[x,y],[x,y],[x,y]], "blurPx": 1.1 } },
 *     "points":   { "character": [x, y], "home_ref_tl": [x, y], "home_ref_br": [x, y] },
 *     "ellipses": { "pedestal_top": { "cx": .5, "cy": .8, "rx": .1, "ry": .02 } },
 *     "cameras":  { "<camera>": { "refFrame": { "x", "y", "w", "h" }, ... } }
 *   }
 *
 * Blender job format (consult, written by scripts/blender/consult_post.py):
 *
 *   {
 *     "plate":    { "w": 2560, "h": 1440 },
 *     "refFrame": { "x": .083, "y": .083, "w": .833, "h": .833 } | null,
 *     "files":    { "plate": { "files": ["plate-2560.webp", ...] },
 *                   "glow_neon": { "files": [...] }, ... },
 *     "surfaces", "points", "ellipses", "curves": { "<name>": { "points": [[x,y], ...] } }
 *   }
 *
 * Both come out as one `RoomAnchors`. `ref` - where the mockup's framing sits
 * inside an over-scanned render - is read from `refFrame`, from
 * `cameras.*.refFrame`, or from a `points.<name>_ref_tl` / `_ref_br` pair.
 * `widths` (or a Blender `files` list) turns a plate into a srcset of its
 * `-<width>.webp` siblings. Quads run clockwise from the top-left: TL, TR, BR,
 * BL. `blurPx` is measured at the frame's own width and is scaled to the
 * rendered width. Without `plates`, a single `room.webp` is assumed. Other
 * fields (layers, light, build) are allowed and ignored until something reads
 * them.
 */

import { getContext, setContext } from 'svelte';
import { PUBLISHED_ROOMS, type PublishedRooms } from './env-rooms.ts';

export type RoomId = 'lounge' | 'consult' | 'lounge-strip-window' | 'lounge-strip-interior' | 'products-hero';

/** Which render of a room: the landscape one, or the phone-portrait one (`anchors-mobile.json`). */
export type RoomVariant = 'desk' | 'mobile';

export type Point = [number, number];
/** TL, TR, BR, BL. */
export type Quad = [Point, Point, Point, Point];

export interface RoomPlate {
  src: string;
  kind?: 'base' | 'sky' | 'glow' | 'fg' | 'blur';
  blend?: string;
  /**
   * breathe  the glow is the difference between the plate and a dimmed plate:
   *          opacity 0.6..1 (1 = the plate as rendered).
   * boost    the glow is an extra on top of the plate as rendered: opacity
   *          0..0.3 (0 = as rendered), slowly.
   */
  animate?: 'breathe' | 'boost' | 'none';
  opacity?: number;
  /** The widths this picture is also published at, as `-<width>.webp` siblings of `src` (for srcset). */
  widths?: number[];
}

export interface RoomSurfaceAnchor {
  quad: Quad;
  blurPx?: number;
  tone?: string;
  /** Copy the render was composed for (the Blender job's own note of it). */
  text?: string;
  lines?: string[];
}

/** A rectangle of the frame, normalised. */
export interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomAnchors {
  frame: { w: number; h: number; focus?: Point };
  plates?: RoomPlate[];
  surfaces?: Record<string, RoomSurfaceAnchor>;
  points?: Record<string, Point>;
  ellipses?: Record<string, { cx: number; cy: number; rx: number; ry: number }>;
  /** Where the mockup's own framing sits in an over-scanned render (null: the render has none). */
  ref?: RoomRect | null;
  /** Polylines along curved surfaces (the pedestal's band), for an SVG textPath. */
  curves?: Record<string, Point[]>;
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

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/**
 * Where the frame lands when the mockup's framing `ref` (normalised, inside an
 * over-scanned render) must cover the box: the render is drawn at the scale
 * the mockup was designed at, so the room reads at the mockup's size rather
 * than the ~17 % smaller a plain cover of the whole over-scanned plate gives.
 * Whatever of `ref` overflows the box is cut by `focus`, as object-position
 * would, and the render's own margin fills anything outside `ref`. Without a
 * `ref` it is `coverFit`.
 */
export function refFit(
  frameW: number,
  frameH: number,
  ref: RoomRect | null | undefined,
  boxW: number,
  boxH: number,
  focus: Point = [0.5, 0.5],
): Fit {
  if (!ref || !(ref.w > 0) || !(ref.h > 0)) return coverFit(frameW, frameH, boxW, boxH, focus);
  if (frameW <= 0 || frameH <= 0 || boxW <= 0 || boxH <= 0) return { scale: 0, x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.max(boxW / (ref.w * frameW), boxH / (ref.h * frameH));
  const w = frameW * scale;
  const h = frameH * scale;
  const x = -ref.x * w + (boxW - ref.w * w) * focus[0];
  const y = -ref.y * h + (boxH - ref.h * h) * focus[1];
  return { scale, w, h, x: clamp(x, boxW - w, 0), y: clamp(y, boxH - h, 0) };
}

/** A frame placed by its caller at `rect` (box px), as a Fit. */
export function rectFit(frameW: number, rect: { x: number; y: number; w: number; h: number }): Fit {
  return { scale: frameW > 0 ? rect.w / frameW : 0, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

/** The srcset of a plate published at several widths (`-<width>.webp` siblings), or null. */
export function plateSrcset(plate: RoomPlate, resolve: (src: string) => string = (src) => src): string | null {
  const widths = plate.widths?.filter((w) => Number.isInteger(w) && w > 0);
  if (!widths?.length || !/-\d+\.webp$/.test(plate.src)) return null;
  return [...new Set(widths)]
    .sort((a, b) => a - b)
    .map((w) => `${resolve(plate.src.replace(/-\d+\.webp$/, `-${w}.webp`))} ${w}w`)
    .join(', ');
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

const isPoint = (p: unknown): p is Point =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function readRect(value: unknown): RoomRect | null {
  const r = value as Partial<RoomRect> | null | undefined;
  if (!r || !isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h) || !(r.w > 0) || !(r.h > 0)) return null;
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/** A plate file name the page may load: relative, or absolute under /env/; never out of it. */
const safeSrc = (src: unknown): src is string =>
  typeof src === 'string' && !src.includes('..') && (/^[\w./-]+$/.test(src)) && (!src.startsWith('/') || src.startsWith('/env/'));

function readSurfaces(raw: unknown): Record<string, RoomSurfaceAnchor> {
  const surfaces: Record<string, RoomSurfaceAnchor> = {};
  for (const [name, s] of Object.entries((raw ?? {}) as Record<string, Partial<RoomSurfaceAnchor>>)) {
    if (s && Array.isArray(s.quad) && s.quad.length === 4 && s.quad.every(isPoint)) {
      const out: RoomSurfaceAnchor = { quad: s.quad as Quad };
      if (isNum(s.blurPx)) out.blurPx = s.blurPx;
      if (typeof s.tone === 'string') out.tone = s.tone;
      if (typeof s.text === 'string') out.text = s.text;
      if (Array.isArray(s.lines) && s.lines.every((l) => typeof l === 'string')) out.lines = s.lines;
      surfaces[name] = out;
    }
  }
  return surfaces;
}

function readPoints(raw: unknown): Record<string, Point> {
  const points: Record<string, Point> = {};
  for (const [name, p] of Object.entries((raw ?? {}) as Record<string, unknown>)) if (isPoint(p)) points[name] = p;
  return points;
}

function readCurves(raw: unknown): Record<string, Point[]> {
  const curves: Record<string, Point[]> = {};
  for (const [name, c] of Object.entries((raw ?? {}) as Record<string, { points?: unknown } | unknown[]>)) {
    const pts = Array.isArray(c) ? c : (c as { points?: unknown })?.points;
    if (Array.isArray(pts) && pts.length > 1 && pts.every(isPoint)) curves[name] = pts as Point[];
  }
  return curves;
}

type Ellipses = NonNullable<RoomAnchors['ellipses']>;
function readEllipses(raw: unknown): Ellipses {
  const out: Ellipses = {};
  for (const [name, e] of Object.entries((raw ?? {}) as Record<string, Record<string, unknown>>)) {
    if (e && isNum(e.cx) && isNum(e.cy) && isNum(e.rx) && isNum(e.ry)) out[name] = { cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry };
  }
  return out;
}

/**
 * The mockup's framing inside the render: a top-level `refFrame`, else the
 * first camera's `refFrame`, else a `points.<name>_ref_tl` / `_ref_br` pair.
 */
function readRef(raw: Record<string, unknown>, points: Record<string, Point>): RoomRect | null {
  const top = readRect(raw.refFrame) ?? readRect(raw.ref);
  if (top) return top;
  for (const cam of Object.values((raw.cameras ?? {}) as Record<string, { refFrame?: unknown }>)) {
    const r = readRect(cam?.refFrame);
    if (r) return r;
  }
  for (const [name, tl] of Object.entries(points)) {
    const br = name.endsWith('_ref_tl') ? points[name.replace(/_tl$/, '_br')] : undefined;
    if (br && br[0] > tl[0] && br[1] > tl[1]) return { x: tl[0], y: tl[1], w: br[0] - tl[0], h: br[1] - tl[1] };
  }
  return null;
}

/** A Blender `files` entry (`{ files: ["plate-2560.webp", ...] }`) as one plate with its widths. */
function filesPlate(value: unknown, plate: Omit<RoomPlate, 'src' | 'widths'>): RoomPlate | null {
  const files = (value as { files?: unknown } | undefined)?.files;
  if (!Array.isArray(files)) return null;
  const sized = files
    .filter((f): f is string => typeof f === 'string' && /^[\w.-]+-\d+\.webp$/.test(f) && !f.includes('..'))
    .map((f) => ({ f, w: Number(/-(\d+)\.webp$/.exec(f)![1]) }))
    .sort((a, b) => b.w - a.w);
  if (!sized.length) return null;
  return { src: sized[0].f, widths: sized.map((s) => s.w), ...plate };
}

/**
 * Reads a fetched anchors file defensively, in either format (see the top of
 * this file): anything malformed is dropped, and a file without a usable frame
 * - or the dev server answering with index.html - is null.
 */
export function parseAnchors(value: unknown): RoomAnchors | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const points = readPoints(raw.points);
  const base = {
    surfaces: readSurfaces(raw.surfaces),
    points,
    ellipses: readEllipses(raw.ellipses),
    ref: readRef(raw, points),
    curves: readCurves(raw.curves),
  };

  const frame = raw.frame as { w?: unknown; h?: unknown; focus?: unknown } | undefined;
  if (frame && isNum(frame.w) && isNum(frame.h) && frame.w > 0 && frame.h > 0) {
    const plates = Array.isArray(raw.plates)
      ? (raw.plates as Partial<RoomPlate>[])
          .filter((p): p is RoomPlate => !!p && safeSrc(p.src))
          .map((p) => {
            const out: RoomPlate = { src: p.src };
            if (p.kind) out.kind = p.kind;
            if (typeof p.blend === 'string') out.blend = p.blend;
            if (p.animate) out.animate = p.animate;
            if (isNum(p.opacity)) out.opacity = p.opacity;
            if (Array.isArray(p.widths) && p.widths.every((w) => Number.isInteger(w) && w > 0)) out.widths = p.widths;
            return out;
          })
      : undefined;
    return { frame: { w: frame.w, h: frame.h, focus: isPoint(frame.focus) ? frame.focus : undefined }, plates, ...base };
  }

  // The Blender job's own format: `plate` is the frame, `files` the plates.
  const plate = raw.plate as { w?: unknown; h?: unknown } | undefined;
  if (plate && isNum(plate.w) && isNum(plate.h) && plate.w > 0 && plate.h > 0) {
    const files = (raw.files ?? {}) as Record<string, unknown>;
    const main = filesPlate(files.plate, { kind: 'base' });
    if (!main) return null;
    const neon = filesPlate(files.glow_neon, { kind: 'glow', blend: 'plus-lighter', animate: 'boost' });
    return { frame: { w: plate.w, h: plate.h }, plates: neon ? [main, neon] : [main], ...base };
  }
  return null;
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

/**
 * loading   the stand-in is showing while the render is on its way (or while
 *           it is being asked whether there is one).
 * plate     the render is on screen.
 * stand-in  the stand-in is what stays: no render is published, or it failed.
 */
export type RoomStatus = 'loading' | 'plate' | 'stand-in';

export interface RoomContext {
  readonly room: RoomId;
  readonly anchors: RoomAnchors;
  readonly fit: Fit;
  /** True while the CSS stand-in is showing (no plate yet, or it failed). */
  readonly fallback: boolean;
  readonly status: RoomStatus;
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

/* ---- loading, cached per room and variant for the life of the page ------- */

const cache = new Map<string, Promise<RoomAnchors | null>>();

/** Whether a room has that render published (env-rooms.ts). */
export function hasRender(room: RoomId, variant: RoomVariant = 'desk', published: PublishedRooms = PUBLISHED_ROOMS): boolean {
  return published[room]?.includes(variant) ?? false;
}

/**
 * Fetches `/env/<room>/anchors.json` (`anchors-mobile.json` for the
 * phone-portrait render) for a room with that render published
 * (env-rooms.ts), and resolves to null at once for one without. A missing or
 * malformed file also resolves to null - including a server answering an
 * unknown path with index.html - so the caller falls back cleanly.
 */
export function loadAnchors(
  room: RoomId,
  variant: RoomVariant = 'desk',
  published: PublishedRooms = PUBLISHED_ROOMS,
): Promise<RoomAnchors | null> {
  if (!hasRender(room, variant, published)) return Promise.resolve(null);
  const file = variant === 'mobile' ? 'anchors-mobile.json' : 'anchors.json';
  const key = `${room}/${file}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetch(`/env/${room}/${file}`, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
        return parseAnchors(await res.json());
      })
      .catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}
