/**
 * The measured regions as shapes on the face, and the textures they are painted into.
 *
 * Each of the nine `FaceRegionKey`s is drawn as an organic shape built from
 * the mesh's own landmarks (an ellipse fitted to a landmark group, a smoothed
 * landmark loop, or a crescent between two landmark rings), so a zone sits on
 * *this* face's forehead or cheek rather than on a stock head. Shapes are
 * painted in the surface's frontal texture space (`FaceSurface.uvs`), which is
 * what the face and dot shaders sample.
 *
 * Landmark numbers are MediaPipe's canonical 478-point topology, which every
 * `ScanMesh` uses. "Left" follows the skin pipeline: image-left of the
 * un-mirrored camera frame (see `FACE_REGIONS` in shared/types.ts).
 *
 * Two textures come out of here, both drawn on an opaque black canvas so every
 * channel is independent:
 * - zones: RGB is each highlighted region's tone, normalised so its brightest
 *   channel is 1, times how strongly that texel is covered (so the shaders
 *   read the hue as rgb / max(rgb) and the amount as max(rgb)); outlines are
 *   painted over-bright so they come out paler than the fill;
 * - features: R lips, G brows and lash lines, B the active region's shape.
 */
import type { FaceRegionKey } from '@shared/types.ts';
import { smoothLoop } from './geometry.ts';

export type ZoneTone = 'pink' | 'lavender' | 'periwinkle';

export interface RegionHighlight {
  region: FaceRegionKey;
  tone: ZoneTone;
  /** 0..1: how strongly the region glows. */
  strength: number;
  /** Draw the thin outline. Default per region (`REGION_OUTLINE`): the right cheek is a dot field with none, as in the mockup. */
  outline?: boolean;
}

/**
 * The landmark each region's callout points at. They start from the capture's
 * `MESH_REGION_ANCHORS` (src/scan/mesh.ts) and are moved where that point is
 * not on the drawn zone or not where the mockup's callout lands:
 * - forehead 151 (forehead centre) instead of 10, which is the mesh's top edge,
 *   above the zone;
 * - cheeks 207 / 427 (lower cheek, the mockup's CHEEKS anchor) instead of
 *   50 / 280, which sit a few px under the under-eye anchors;
 * - chin 428 (the right edge of the chin zone, where the mockup's leader leaves)
 *   instead of 152, the jaw's lowest point below the zone.
 * On the sample mesh the anchors land within 15 px of the mockup's (ref4 2.2-2.3)
 * except the forehead's, about 30 px lower: the mockup draws its forehead zone
 * above y 155, where no landmark exists, and the zone here stays on the face.
 */
export const ANCHOR_LANDMARK: Record<FaceRegionKey, number> = {
  forehead: 151,
  glabella: 9,
  nose: 4,
  cheekLeft: 207,
  cheekRight: 427,
  periorbitalLeft: 118,
  periorbitalRight: 347,
  perioral: 13,
  chin: 428,
};

/**
 * Anchors set part of the way from their landmark toward a second one. The
 * forehead's 151 sits only about 7% of the face's height under the mesh's top
 * edge, inside the band where the forehead dissolves into the lattice (the face
 * shader's dome fade), so its leader seemed to end on the hairline. Half-way to
 * 9 (mid-forehead) it lands on lit forehead, still inside the forehead zone.
 */
export const ANCHOR_BLEND: Partial<Record<FaceRegionKey, { toward: number; t: number }>> = {
  forehead: { toward: 9, t: 0.5 },
};

/** A region's anchor point on a flat xyz array (landmark order), with its blend applied. */
export function anchorPoint(positions: ArrayLike<number>, region: FaceRegionKey, out: [number, number, number]): [number, number, number] {
  const i = ANCHOR_LANDMARK[region];
  const b = ANCHOR_BLEND[region];
  for (let c = 0; c < 3; c++) {
    const a = positions[i * 3 + c];
    out[c] = b ? a + (positions[b.toward * 3 + c] - a) * b.t : a;
  }
  return out;
}

/** Whether a region's zone gets its thin outline by default (the mockup's right cheek is a bare dot field). */
export const REGION_OUTLINE: Record<FaceRegionKey, boolean> = {
  forehead: true,
  glabella: true,
  nose: true,
  cheekLeft: true,
  cheekRight: false,
  periorbitalLeft: true,
  periorbitalRight: true,
  perioral: true,
  chin: true,
};

type Shape =
  /** An ellipse fitted to a landmark group, `k` standard deviations out; `turn` adds a tilt (radians, clockwise on screen); `focus` pulls the glow toward one end of the long axis (-1..1). */
  | { kind: 'ellipse'; idx: number[]; k: number; turn?: number; focus?: number }
  | { kind: 'loop'; idx: number[] }
  | { kind: 'crescent'; top: number[]; bottom: number[]; depth: number };

/** Region shapes, from landmark groups. */
export const REGION_SHAPES: Record<FaceRegionKey, Shape> = {
  // Across the forehead between the brows and the mesh's top edge, tilted down to the right with the glow in its right half (as drawn in ref4).
  forehead: { kind: 'ellipse', idx: [69, 108, 151, 337, 299, 109, 338, 107, 336, 9], k: 1.75, turn: 0.1, focus: 0.45 },
  glabella: { kind: 'ellipse', idx: [9, 8, 107, 336, 55, 285, 168, 193, 417], k: 1.6 },
  nose: { kind: 'ellipse', idx: [6, 197, 195, 5, 4, 1, 45, 275, 48, 278, 2, 19], k: 1.55 },
  cheekLeft: { kind: 'ellipse', idx: [116, 117, 118, 101, 36, 205, 207, 187, 147, 123, 50], k: 1.75 },
  cheekRight: { kind: 'ellipse', idx: [345, 346, 347, 330, 266, 425, 427, 411, 376, 352, 280], k: 1.75 },
  // Under-eye crescents: the lower lid line without the eye corners themselves (the
  // lid turns up into them, which bent the tips into hooks), and a deeper arc below.
  periorbitalLeft: {
    kind: 'crescent',
    top: [31, 228, 229, 230, 231, 232, 233],
    bottom: [111, 117, 118, 119, 120, 121, 128],
    depth: 1.7,
  },
  periorbitalRight: {
    kind: 'crescent',
    top: [261, 448, 449, 450, 451, 452, 453],
    bottom: [340, 346, 347, 348, 349, 350, 357],
    depth: 1.7,
  },
  perioral: { kind: 'ellipse', idx: [61, 291, 0, 17, 37, 267, 84, 314, 57, 287, 164, 18, 40, 270, 91, 321], k: 1.5 },
  chin: { kind: 'ellipse', idx: [200, 199, 175, 201, 421, 208, 428, 171, 396, 18], k: 1.55 },
};

/** Landmarks that get a small bright node when their region is lit (outline corners, as in the mockup). */
export const REGION_NODES: Record<FaceRegionKey, number[]> = {
  forehead: [69, 299],
  glabella: [],
  nose: [],
  cheekLeft: [116, 207],
  cheekRight: [],
  periorbitalLeft: [31, 233],
  periorbitalRight: [261, 453],
  perioral: [],
  chin: [171, 396],
};

const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const BROW_A = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const BROW_B = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const EYE_A = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_B = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];

/**
 * Colours per tone (sRGB). `fill` is the spec's zone colour scaled so its
 * brightest channel is 255 (the texture carries hue and amount separately);
 * `line` is the pale outline, which adds up over the fill to a near-white rim.
 */
export const TONE_COLOURS: Record<ZoneTone, { fill: string; line: string }> = {
  pink: { fill: '255,150,205', line: '240,200,226' },
  lavender: { fill: '205,178,255', line: '222,214,250' },
  periwinkle: { fill: '164,172,255', line: '214,226,255' },
};

type Pt = [number, number];
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A fitted region ellipse: centre, radii and angle, in canvas px. */
interface Ellipse {
  cx: number;
  cy: number;
  r1: number;
  r2: number;
  ang: number;
}

function fitEllipse(shape: Extract<Shape, { kind: 'ellipse' }>, uv: (i: number) => Pt): Ellipse {
  // Centroid and principal axes of the group, radii from the spread.
  const pts = shape.idx.map(uv);
  let cx = 0, cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= pts.length;
  syy /= pts.length;
  sxy /= pts.length;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const ang = Math.abs(sxy) < 1e-9 ? (sxx >= syy ? 0 : Math.PI / 2) : Math.atan2(l1 - sxx, sxy);
  return {
    cx,
    cy,
    r1: Math.sqrt(Math.max(1e-6, l1)) * shape.k,
    r2: Math.sqrt(Math.max(1e-6, l2)) * shape.k,
    ang: ang + (shape.turn ?? 0),
  };
}

/** A region's outline as a closed polyline in canvas px. `uv(i)` gives landmark i in canvas px. */
export function regionOutline(region: FaceRegionKey, uv: (i: number) => Pt): Pt[] {
  const shape = REGION_SHAPES[region];
  if (shape.kind === 'loop') return smoothLoop(shape.idx.map(uv), 6);
  if (shape.kind === 'crescent') {
    // The lid line on top, a deeper arc below, closed with rounded ends a little
    // below the eye corners (the lid line turns up into the corners, which made
    // hooked points).
    const top = shape.top.map(uv);
    const bot = shape.bottom.map(uv);
    const n = top.length;
    const upper: Pt[] = [];
    const lower: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const t = top[i], b = bot[i];
      const taper = Math.pow(Math.sin((Math.PI * i) / (n - 1)), 0.85);
      const drop = 0.55 * Math.pow(1 - taper, 1.5);
      upper.push([t[0] + (b[0] - t[0]) * drop, t[1] + (b[1] - t[1]) * drop]);
      // The lower arc keeps some depth at the ends, so each tip closes in a rounded cap.
      const f = drop + (shape.depth - drop) * (0.3 + 0.7 * taper);
      lower.push([t[0] + (b[0] - t[0]) * f, t[1] + (b[1] - t[1]) * f]);
    }
    return smoothLoop([...upper, ...lower.slice(1, -1).reverse()], 5);
  }
  const e = fitEllipse(shape, uv);
  const out: Pt[] = [];
  const ca = Math.cos(e.ang), sa = Math.sin(e.ang);
  for (let s = 0; s < 48; s++) {
    const t = (s / 48) * Math.PI * 2;
    const x = Math.cos(t) * e.r1, y = Math.sin(t) * e.r2;
    out.push([e.cx + x * ca - y * sa, e.cy + x * sa + y * ca]);
  }
  return out;
}

function trace(ctx: Ctx, pts: Pt[], dx = 0): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + dx, p[1]) : ctx.moveTo(p[0] + dx, p[1])));
  ctx.closePath();
}

/**
 * Fills a shape with only its blurred shadow, so the fill has no hard edge: the
 * shape is drawn one canvas-width off to the left and its shadow is thrown
 * back into place. The shadow takes its alpha from `paint`, so a gradient
 * there shapes the glow; its colour is `rgba`.
 */
function softFill(ctx: Ctx, size: number, pts: Pt[], rgba: string, blur: number, paint: string | CanvasGradient): void {
  ctx.shadowColor = rgba;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = size * 2;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = paint;
  trace(ctx, pts, -size * 2);
  ctx.fill();
  ctx.shadowOffsetX = 0;
}

/**
 * Paints the zone texture. Opaque black, colours added: each highlight is a
 * soft fill in its tone (with a wider, fainter halo) and, unless it is a bare
 * dot field, a thin pale outline, all scaled by its strength.
 */
export function paintZones(ctx: Ctx, size: number, uv: (i: number) => Pt, highlights: RegionHighlight[]): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  for (const h of highlights) {
    const s = Math.max(0, Math.min(1, h.strength));
    if (s <= 0) continue;
    const c = TONE_COLOURS[h.tone];
    const pts = regionOutline(h.region, uv);
    const shape = REGION_SHAPES[h.region];
    // Where the glow gathers: evenly, or toward one end of an ellipse.
    let paint: string | CanvasGradient = '#000';
    if (shape.kind === 'ellipse' && shape.focus) {
      const e = fitEllipse(shape, uv);
      const fx = e.cx + Math.cos(e.ang) * e.r1 * shape.focus, fy = e.cy + Math.sin(e.ang) * e.r1 * shape.focus;
      // The gradient is sampled where the shape is drawn (shifted left), so centre it there.
      const g = ctx.createRadialGradient(fx - size * 2, fy, 0, fx - size * 2, fy, e.r1 * 1.6);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0.3)');
      paint = g;
    }
    softFill(ctx, size, pts, `rgba(${c.fill},${0.22 * s})`, size * 0.05, paint);
    softFill(ctx, size, pts, `rgba(${c.fill},${0.62 * s})`, size * 0.016, paint);
    if (h.outline ?? REGION_OUTLINE[h.region]) {
      ctx.shadowBlur = size * 0.004;
      ctx.shadowColor = `rgba(${c.line},${0.5 * s})`;
      ctx.strokeStyle = `rgba(${c.line},${0.9 * s})`;
      ctx.lineWidth = Math.max(1, size / 360);
      trace(ctx, pts);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Paints the feature texture: lips (R), brows and lash lines (G), the active region (B). */
export function paintFeatures(ctx: Ctx, size: number, uv: (i: number) => Pt, active: FaceRegionKey | null): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowBlur = size * 0.006;

  ctx.fillStyle = ctx.shadowColor = 'rgb(255,0,0)';
  trace(ctx, smoothLoop(LIPS_OUTER.map(uv), 4));
  ctx.fill();

  ctx.fillStyle = ctx.shadowColor = 'rgb(0,200,0)';
  for (const brow of [BROW_A, BROW_B]) {
    trace(ctx, brow.map(uv));
    ctx.fill();
  }
  ctx.strokeStyle = ctx.shadowColor = 'rgb(0,255,0)';
  ctx.lineWidth = Math.max(1.5, size / 300);
  for (const eye of [EYE_A, EYE_B]) {
    trace(ctx, eye.map(uv));
    ctx.stroke();
  }

  if (active) {
    ctx.shadowBlur = size * 0.02;
    ctx.fillStyle = ctx.shadowColor = 'rgb(0,0,255)';
    trace(ctx, regionOutline(active, uv));
    ctx.fill();
  }
  ctx.restore();
}
