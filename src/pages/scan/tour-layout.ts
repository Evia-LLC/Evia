/**
 * Where the consult tour's region card goes (specs/consult-tour.md 7.3): pure placement, in the desk
 * stage's px (1 px per ref4 px at 1672 x 941, `u` css px per ref px otherwise).
 *
 * Without her (switch off, tablet, phone) the card is the summary's own callout in its own slot
 * ('home'), one at a time. With her on the desk, the card goes where neither she nor her arm is:
 * across the face for a midline spot ('out'), above her head or below her arm for a spot on her own
 * side ('up', 'down'), or home when the spot is on the far side (only before she can teleport). From
 * there it slides until it clears every keep-out: the face oval, her head and body, the arm from her
 * shoulder to the spot, the header, the badge, the talk card and the floor.
 *
 * `tourLook` is the other half: what of the running step is on screen at a given moment of the
 * tour's clock (the tap's light, the line drawing out and back, the card sliding in and out).
 */
import type { FaceRegionKey } from '@shared/types.ts';
import { sideFor, timingFor, type TourSide, type TourView } from '@/stage/tour-machine.ts';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export type TourZone = 'home' | 'out' | 'up' | 'down';
export type Orient = 'left' | 'right';

/** Her silhouette on screen (room.ts `figureKeepOut`), for the side she stands on. */
export interface FigureShape {
  side: TourSide;
  head: Box;
  body: Box;
  shoulder: Point;
  armRadius: number;
}

export interface PlaceInput {
  /** The spot tapped (a face region) and where its anchor is now, stage px. */
  region: FaceRegionKey;
  contact: Point | null;
  /** The card's measured size (either orientation). */
  card: { w: number; h: number };
  /**
   * The thumbnail frame inside the card: its size and how far it sits from the card's edge on the
   * thumbnail's side ('left' orientation: from the right edge; 'right' orientation: from the left).
   */
  thumb: { w: number; h: number; inset: Record<Orient, number> };
  /** The slot's summary box (laid out, hidden) and its orientation there. */
  home: Box;
  homeOrient: Orient;
  /** The face oval with its margin. */
  face: Ellipse;
  figure: FigureShape | null;
  /** Everything else the card must clear (header, badge, back, talk card, floor), margins included. */
  keepOut: Box[];
  /** The talk card (for the 'down' slide limit), margins included, or null. */
  talk: Box | null;
  stage: Box;
  u: number;
}

export interface Placement {
  zone: TourZone;
  box: Box;
  orient: Orient;
  port: Point;
  clear: boolean;
}

/** The margin kept inside the stage's edge. */
export const STAGE_INSET = 8;
/** Room for a midline card: its edge this far (ref px) beyond the face oval. */
export const OUT_GAP = 28;

const MIDLINE = new Set<FaceRegionKey>(['forehead', 'glabella', 'nose', 'perioral', 'chin']);

// ---- geometry ------------------------------------------------------------------------------------

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Whether an axis-aligned box and an ellipse overlap (exact: scale to the unit circle). */
export function boxHitsEllipse(b: Box, e: Ellipse): boolean {
  const x0 = (b.x - e.cx) / e.rx, x1 = (b.x + b.w - e.cx) / e.rx;
  const y0 = (b.y - e.cy) / e.ry, y1 = (b.y + b.h - e.cy) / e.ry;
  const nx = Math.max(x0, Math.min(0, x1));
  const ny = Math.max(y0, Math.min(0, y1));
  return nx * nx + ny * ny < 1;
}

function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointBox(p: Point, b: Box): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** The shortest distance between a segment and a box (0 when they touch). */
export function segmentBoxDistance(a: Point, b: Point, box: Box): number {
  if (pointBox(a, box) === 0 || pointBox(b, box) === 0) return 0;
  const corners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  for (let i = 0; i < 4; i++) if (segmentsCross(a, b, corners[i], corners[(i + 1) % 4])) return 0;
  return Math.min(pointBox(a, box), pointBox(b, box), ...corners.map((c) => pointSegment(c, a, b)));
}

/** The four edge midpoints of a box, and the one nearest `to`. */
export function nearestEdgeMidpoint(box: Box, to: Point): Point {
  const mids: Point[] = [
    { x: box.x, y: box.y + box.h / 2 },
    { x: box.x + box.w, y: box.y + box.h / 2 },
    { x: box.x + box.w / 2, y: box.y },
    { x: box.x + box.w / 2, y: box.y + box.h },
  ];
  let best = mids[0];
  let d = Infinity;
  for (const m of mids) {
    const dm = Math.hypot(m.x - to.x, m.y - to.y);
    if (dm < d - 1e-6) {
      d = dm;
      best = m;
    }
  }
  return best;
}

/** The thumbnail frame of a card placed at `box` in orientation `orient`. */
export function thumbBox(box: Box, orient: Orient, thumb: PlaceInput['thumb']): Box {
  const y = box.y + (box.h - thumb.h) / 2;
  return orient === 'left'
    ? { x: box.x + box.w - thumb.inset.left - thumb.w, y, w: thumb.w, h: thumb.h }
    : { x: box.x + thumb.inset.right, y, w: thumb.w, h: thumb.h };
}

/** The face oval from the engine's projected face bounds, plus a margin. */
export function faceEllipse(bounds: Box, margin = 8): Ellipse {
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, rx: bounds.w / 2 + margin, ry: bounds.h / 2 + margin };
}

/** A box grown by `m` on every side. */
export function grow(b: Box, m: number): Box {
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}

// ---- the talk card ---------------------------------------------------------------------------------

/** The desk talk card's width and bottom edge (spec 7.4): centred on the pedestal axis. */
export function talkCardFrame(u: number): { cx: number; width: number; bottom: number } {
  return { cx: 868 * u, width: Math.min(720, Math.max(480, 600 * u)), bottom: 836 * u };
}

// ---- placement --------------------------------------------------------------------------------------

/** Where the card goes and which way it faces, before sliding (spec 7.3 rules 1-2). */
function preferred(input: PlaceInput): { zone: TourZone; box: Box; orient: Orient } {
  const { card, figure, contact, face, u } = input;
  const home = { zone: 'home' as const, box: input.home, orient: input.homeOrient };
  if (!figure || !contact) return home;
  const mid = MIDLINE.has(input.region);
  const near = !mid && sideFor(input.region) === figure.side;
  if (mid) {
    if (figure.side === 'left') {
      return { zone: 'out', orient: 'right', box: { x: face.cx + face.rx + OUT_GAP * u, y: contact.y - card.h / 2, w: card.w, h: card.h } };
    }
    return { zone: 'out', orient: 'left', box: { x: face.cx - face.rx - OUT_GAP * u - card.w, y: contact.y - card.h / 2, w: card.w, h: card.h } };
  }
  if (!near) return home;
  if (contact.y < face.cy) {
    const bottom = figure.head.y - 10;
    return figure.side === 'right'
      ? { zone: 'up', orient: 'right', box: { x: 986 * u, y: bottom - card.h, w: card.w, h: card.h } }
      : { zone: 'up', orient: 'left', box: { x: 742 * u - card.w, y: bottom - card.h, w: card.w, h: card.h } };
  }
  return figure.side === 'right'
    ? { zone: 'down', orient: 'right', box: { x: figure.body.x - 12 - card.w, y: 440 * u, w: card.w, h: card.h } }
    : { zone: 'down', orient: 'left', box: { x: figure.body.x + figure.body.w + 12, y: 440 * u, w: card.w, h: card.h } };
}

/** Whether a card box clears everything it must (spec 7.3 rule 3). */
export function clearOf(box: Box, input: PlaceInput): boolean {
  const s = input.stage;
  const inset = STAGE_INSET;
  if (box.x < s.x + inset || box.y < s.y + inset || box.x + box.w > s.x + s.w - inset || box.y + box.h > s.y + s.h - inset) return false;
  if (boxHitsEllipse(box, input.face)) return false;
  for (const k of input.keepOut) if (intersects(box, k)) return false;
  if (input.talk && intersects(box, input.talk)) return false;
  const f = input.figure;
  if (f) {
    if (intersects(box, f.head) || intersects(box, f.body)) return false;
    if (input.contact && segmentBoxDistance(f.shoulder, input.contact, box) < f.armRadius) return false;
  }
  return true;
}

/** The vertical offsets tried for a zone, in order (spec 7.3 rule 3). */
function verticalSteps(zone: TourZone, start: Box, input: PlaceInput): number[] {
  const u = input.u;
  const out: number[] = [0];
  if (zone === 'out') {
    const lim = 120 * u;
    for (let d = 4; d <= lim; d += 4) out.push(d, -d);
  } else if (zone === 'up') {
    const top = input.stage.y + STAGE_INSET;
    for (let d = 4; start.y - d >= top; d += 4) out.push(-d);
  } else if (zone === 'down') {
    const limit = input.talk ? input.talk.y : input.stage.y + input.stage.h - STAGE_INSET;
    for (let d = 4; start.y + start.h + d <= limit; d += 4) out.push(d);
  }
  return out;
}

/** Places the tour's region card (spec 7.3). */
export function placeTourCard(input: PlaceInput): Placement {
  const pref = preferred(input);
  const portFor = (box: Box, orient: Orient): Point => {
    const t = thumbBox(box, orient, input.thumb);
    // Home keeps today's port (the thumbnail's side facing the face); the others take the nearest edge.
    if (pref.zone === 'home' || !input.contact) {
      return orient === 'left' ? { x: t.x + t.w, y: t.y + t.h / 2 } : { x: t.x, y: t.y + t.h / 2 };
    }
    return nearestEdgeMidpoint(t, input.contact);
  };
  if (pref.zone === 'home') {
    return { ...pref, port: portFor(pref.box, pref.orient), clear: true };
  }
  const away = pref.box.x + pref.box.w / 2 >= input.face.cx ? 1 : -1;
  const dys = verticalSteps(pref.zone, pref.box, input);
  const hLimit = 160 * input.u;
  for (let dx = 0; dx <= hLimit; dx += 4) {
    for (const dy of dys) {
      const box = { ...pref.box, x: pref.box.x + away * dx, y: pref.box.y + dy };
      if (clearOf(box, input)) return { zone: pref.zone, box, orient: pref.orient, port: portFor(box, pref.orient), clear: true };
    }
  }
  if (import.meta.env?.DEV) console.warn('[tour] no clear place for the card; using the preferred one', pref);
  return { zone: pref.zone, box: pref.box, orient: pref.orient, port: portFor(pref.box, pref.orient), clear: false };
}

// ---- the step's look over time ------------------------------------------------------------------

/** What the page draws of the current step at tour time `t` (spec 3.2, 7.5, 8.2, 8.3). */
export interface TourLook {
  /** The step's zones glow and its contact is the engine's active region. */
  zones: boolean;
  /** How long the zones take to fade when they go (ms). */
  zoneFadeMs: number;
  /** Without her: the light gathering on the spot before the tap (0..1), or null. */
  gather: number | null;
  /** The leader: drawn fraction, anchor dot, port dot (0..1 each). */
  line: number;
  dot: number;
  port: number;
  /** The region card, or null when it is not on screen: its opacity and its slide (px, + away from the spot). */
  card: { opacity: number; shift: number } | null;
  /** The card is laid out (it is measured and placed before it shows). */
  cardMounted: boolean;
}

export const NO_LOOK: TourLook = { zones: false, zoneFadeMs: 550, gather: null, line: 0, dot: 0, port: 0, card: null, cardMounted: false };

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x: number) => Math.pow(clamp01(x), 3);
/** Progress of a transition of `ms` that started at `from`; an instant one is done at once. */
const prog = (t: number, from: number, ms: number) => (ms <= 0 ? 1 : clamp01((t - from) / ms));

/** The page's view of the running step, from the tour's view and its clock. Pure. */
export function tourLook(v: TourView, t: number): TourLook {
  if (v.phase !== 'step') return NO_LOOK;
  const T = timingFor(v.reducedMotion);
  const m = v.marks;
  const contact = v.contactAt;
  const lineOut = m['line-out'];
  const zoneFadeMs = v.fast ? T.fastZone : T.zoneOut;
  const zones = v.face && contact !== null && lineOut === undefined;

  let gather: number | null = null;
  if (!v.figure && v.face && contact === null && m.reach !== undefined && T.gather > 0) gather = prog(t, m.reach, T.gather);

  let line = 0;
  if (v.face && contact !== null && m.line !== undefined) {
    line = lineOut !== undefined ? 1 - easeIn(prog(t, lineOut, v.fast ? T.fastLine : T.lineOut)) : easeOut(prog(t, m.line, T.lineDraw));
  }
  let dot = 0;
  if (v.face && contact !== null) {
    dot = lineOut !== undefined ? 1 - prog(t, lineOut, zoneFadeMs) : v.reducedMotion ? 1 : prog(t, contact, 180);
  }
  const port = line > 0 && lineOut === undefined && m.line !== undefined ? (v.reducedMotion ? 1 : prog(t, m.line + T.lineDraw, 180)) : 0;

  let card: TourLook['card'] = null;
  if (m.card !== undefined) {
    const out = m['card-out'];
    if (out !== undefined) {
      const q = prog(t, out, v.fast ? T.fastCard : T.cardOut);
      if (q < 1) card = { opacity: 1 - q, shift: v.reducedMotion ? 0 : -4 * easeIn(q) };
    } else {
      const p = prog(t, m.card, T.card);
      card = { opacity: v.reducedMotion ? p : easeOut(p), shift: v.reducedMotion ? 0 : -8 * (1 - easeOut(p)) };
    }
  }
  const cardMounted = card !== null || m['card-out'] === undefined;
  return { zones, zoneFadeMs, gather, line, dot, port, card, cardMounted };
}
