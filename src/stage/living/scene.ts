/**
 * What a living room needs, worked out from its anchors (the `living` section
 * room-anchors.ts reads) and its tuning: which textures at which width, which
 * effects are on, and the few things read from the masks on the CPU (the
 * aircraft's lane across the sky, the depth under a wall's text). Pure, so
 * it can be tested against the published anchors (test/living-scene.test.ts).
 */
import type { Fit, LivingLayer, LivingLight, LivingPlant, LivingStrip, Point, RoomLiving } from '../room-anchors.ts';
import type { LivingTuning } from './tuning.ts';

export type TextureKey =
  | 'plate'
  | 'glow'
  | 'plants'
  | 'sky'
  | 'glass'
  | 'windows'
  | 'lamps'
  | 'coves'
  | 'emitter'
  | 'depth'
  | 'neon'
  | 'under'
  | 'emitBoost';

export interface TexturePlan {
  key: TextureKey;
  url: string;
  width: number;
  /** picture: shown (plate, glow and boost layers); data: exact bytes, ids read with texelFetch. */
  kind: 'picture' | 'data';
  /** Build mipmaps (the plate for the dark-window estimate, glow for the blurred strip, coves for its soft falloff). */
  mips: boolean;
}

export interface LivingFeatures {
  plants: boolean;
  lamps: boolean;
  /** LEDs breathe through the glow layer (plate + k * glow). */
  glow: boolean;
  /** A bead travels along the strips (coves mask). */
  travel: boolean;
  windows: boolean;
  sky: boolean;
  /** The night haze on the glass (consult). */
  haze: boolean;
  /** The consult room's boost layers (neon, under-glow, emitter). */
  boosts: boolean;
  emitter: boolean;
  parallax: 'depth' | 'glass' | 'none';
  aircraft: boolean;
}

export interface LivingPlan {
  textures: TexturePlan[];
  features: LivingFeatures;
  /** The data masks' width (they all share it) and height. */
  maskWidth: number;
  /** Plant sway amplitude and flutter, in px of the mask width. */
  swayPx: number;
  flutterPx: number;
  /** How far a strip's id reaches (px at the mask width): the travelling bead's soft falloff stays inside it. */
  zonePx: number;
  lights: LivingLight[];
  strips: LivingStrip[];
  plants: LivingPlant[];
  depthRange: [number, number];
  tuning: LivingTuning;
}

/** The smallest published width that is at least `want`, else the largest. */
export function pickWidth(widths: readonly number[], want: number): number {
  const sorted = [...widths].sort((a, b) => a - b);
  return sorted.find((w) => w >= want) ?? sorted[sorted.length - 1] ?? 0;
}

/** A layer's file at one of its widths (its `-<width>.webp` sibling), resolved to a URL. */
export function layerUrl(layer: LivingLayer, width: number, resolve: (src: string) => string): string {
  return resolve(layer.src.replace(/-\d+\.webp$/, `-${width}.webp`));
}

/** Of a {width: px} table, the value for `width` (else scaled from the nearest listed width). */
export function pxAt(table: Record<number, number> | undefined, width: number, fallback: number): number {
  if (!table) return fallback;
  if (table[width] !== undefined) return table[width];
  const keys = Object.keys(table).map(Number);
  if (!keys.length) return fallback;
  const near = keys.reduce((a, b) => (Math.abs(b - width) < Math.abs(a - width) ? b : a));
  return (table[near] * width) / near;
}

export interface PlanInput {
  living: RoomLiving;
  tuning: LivingTuning;
  /** The plate the page is showing (the <img>'s currentSrc), which the canvas draws from. */
  plateUrl: string;
  /** Resolves an anchors src (relative to the room folder, or absolute under /env/). */
  resolve: (src: string) => string;
  /** The sidebar's softened plate: the glow layer is sampled soft to match. */
  blurred?: boolean;
}

export function planLiving({ living, tuning, plateUrl, resolve }: PlanInput): LivingPlan | null {
  const m = living.masks;
  const textures: TexturePlan[] = [{ key: 'plate', url: plateUrl, width: 0, kind: 'picture', mips: true }];
  // Every data mask is drawn at the smallest width it is published at: they are soft fields and ids,
  // and at that width a room's whole set costs a few hundred KB.
  const dataWidths = (['plants', 'sky', 'glass', 'windows', 'lamps', 'coves', 'emitter'] as const)
    .map((k) => m[k]?.widths[0])
    .filter((w): w is number => !!w);
  const maskWidth = dataWidths.length ? Math.min(...dataWidths) : 0;
  const add = (key: TextureKey, layer: LivingLayer | undefined, kind: TexturePlan['kind'], mips = false): boolean => {
    if (!layer) return false;
    const width = kind === 'data' && layer.widths.includes(maskWidth) ? maskWidth : layer.widths[0];
    textures.push({ key, url: layerUrl(layer, width, resolve), width, kind, mips });
    return true;
  };

  const movingLamp = living.lights.some((l) => l.motion !== 'steady' && (l.visible ?? 1) > 0.05);
  const boosts = !!(living.boosts.neon || living.boosts.under || living.boosts.emitter);
  const features: LivingFeatures = {
    plants: tuning.sway > 0 && add('plants', m.plants, 'data'),
    lamps: tuning.lamps > 0 && movingLamp && add('lamps', m.lamps, 'data'),
    glow: (tuning.breathe > 0 || tuning.travel > 0) && add('glow', m.glow, 'picture', true),
    travel: false,
    windows: tuning.twinkle > 0 && add('windows', m.windows, 'data'),
    sky: tuning.sky !== 'none' && add('sky', m.sky, 'data'),
    haze: false,
    boosts: false,
    emitter: false,
    parallax: 'none',
    aircraft: false,
  };
  if (boosts && (tuning.breathe > 0 || tuning.travel > 0 || tuning.emitter > 0)) {
    features.boosts = true;
    add('neon', living.boosts.neon, 'picture');
    add('under', living.boosts.under, 'picture');
    add('emitBoost', living.boosts.emitter, 'picture');
  }
  const lit = features.glow || features.boosts;
  features.travel = tuning.travel > 0 && lit && living.strips.length > 0 && add('coves', m.coves, 'data', true);
  features.emitter = tuning.emitter > 0 && !!living.boosts.emitter && add('emitter', m.emitter, 'data');
  const wantsGlass = tuning.sky === 'night' || tuning.parallax === 'glass';
  const glass = wantsGlass && add('glass', m.glass, 'data');
  features.haze = glass && tuning.sky === 'night';
  if (tuning.parallax === 'depth' && living.depthRange && add('depth', m.depth, 'data')) features.parallax = 'depth';
  else if (tuning.parallax === 'glass' && glass) features.parallax = 'glass';
  features.aircraft = tuning.aircraft && features.sky;

  const anything =
    features.plants || features.lamps || features.glow || features.windows || features.sky || features.boosts || features.parallax !== 'none';
  if (!anything || !maskWidth) return null;

  return {
    textures,
    features,
    maskWidth,
    swayPx: tuning.sway * pxAt(m.plants?.featherPxAt, maskWidth, 4),
    flutterPx: tuning.flutterPx,
    zonePx: pxAt(m.coves?.zonePxAt, maskWidth, 12),
    lights: living.lights,
    strips: living.strips,
    plants: living.plants,
    depthRange: living.depthRange ?? [0.5, 30.5],
    tuning,
  };
}

/* ---- read on the CPU from small copies of the masks ---------------------- */

/**
 * A lane for an aircraft across the open sky: from an RGBA copy of the sky
 * mask (R = coverage), the widest row of open sky in the middle third of the
 * sky's height, and where that row's sky starts and ends. Normalised; null
 * when the sky is too small to cross.
 */
export function skyLane(rgba: ArrayLike<number>, w: number, h: number): { y: number; x0: number; x1: number } | null {
  const rows: { y: number; count: number; x0: number; x1: number }[] = [];
  for (let y = 0; y < h; y++) {
    let count = 0;
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4] > 160) {
        count++;
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (count >= w * 0.06) rows.push({ y, count, x0, x1 });
  }
  if (rows.length < 2) return null;
  const top = rows[0].y;
  const bottom = rows[rows.length - 1].y;
  // Low in the sky, as a far-off aircraft is, but clear of the skyline (the sky's lower rows run
  // between towers): the widest row between a third and two thirds of the way down.
  const band = rows.filter((r) => r.y >= top + (bottom - top) * 0.33 && r.y <= top + (bottom - top) * 0.66);
  const pool = band.length ? band : rows;
  const best = pool.reduce((a, b) => (b.count > a.count ? b : a), pool[0]);
  const y = best.y;
  const row = rows.find((r) => r.y >= y) ?? best;
  return { y: (y + 0.5) / h, x0: row.x0 / w, x1: (row.x1 + 1) / w };
}

/**
 * How far a thing at depth `z` (m) moves with the pointer, as a share of the
 * largest shift: 0 at the focus depth, 1 at `nearM` and anything nearer,
 * negative (the other way, less) beyond the focus. The shader uses the same
 * formula per pixel.
 */
export const PARALLAX_MIN = -1;
export const PARALLAX_MAX = 1;
export function parallaxFactor(z: number, focusM: number, nearM: number): number {
  const zz = Math.max(0.3, z);
  const f = (1 / zz - 1 / focusM) / (1 / nearM - 1 / focusM);
  return Math.max(PARALLAX_MIN, Math.min(PARALLAX_MAX, f));
}

/* ---- where the canvas goes ------------------------------------------------ */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The part of a room's box the living canvas covers (whole px, relative to the
 * box): where the plate lands in it (`fit`), cut to what can be seen of it -
 * the window and any ancestor that clips (Home's plate box is larger than the
 * window, and cut at the Routine panel's edge). A clip cuts only along an axis
 * where the box is larger than it: a box that fits (the Products hero, the
 * sidebar) keeps its whole canvas, so scrolling it never reallocates the
 * drawing buffer; off screen it simply pauses.
 *
 * `clipped` says whether any clip could cut the box. Whether one can depends
 * on sizes only, so while it is false, scrolling cannot change the region and
 * the room need not be measured again until something is resized.
 */
export function visibleRegion(fit: Fit, boxW: number, boxH: number, host: Box, clips: readonly Box[]): { region: Region; clipped: boolean } {
  let x0 = Math.max(0, fit.x);
  let y0 = Math.max(0, fit.y);
  let x1 = Math.min(boxW, fit.x + fit.w);
  let y1 = Math.min(boxH, fit.y + fit.h);
  const hostW = host.right - host.left;
  const hostH = host.bottom - host.top;
  let clipped = false;
  for (const c of clips) {
    if (hostW > (c.right - c.left) * 1.02) {
      clipped = true;
      x0 = Math.max(x0, c.left - host.left);
      x1 = Math.min(x1, c.right - host.left);
    }
    if (hostH > (c.bottom - c.top) * 1.02) {
      clipped = true;
      y0 = Math.max(y0, c.top - host.top);
      y1 = Math.min(y1, c.bottom - host.top);
    }
  }
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.ceil(x1);
  y1 = Math.ceil(y1);
  return { region: { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }, clipped };
}

export function sameRegion(a: Region, b: Region): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** The depth (m) at a normalised point, from an RGBA copy of the depth mask. */
export function depthAt(rgba: ArrayLike<number>, w: number, h: number, [u, v]: Point, range: [number, number]): number {
  const x = Math.max(0, Math.min(w - 1, Math.floor(u * w)));
  const y = Math.max(0, Math.min(h - 1, Math.floor(v * h)));
  return range[0] + (rgba[(y * w + x) * 4] / 255) * (range[1] - range[0]);
}
