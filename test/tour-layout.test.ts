/**
 * Where the consult tour's region card goes (src/pages/scan/tour-layout.ts; specs/consult-tour.md 7.3),
 * checked at 1672 x 941, 1366 x 768 and 1920 x 1080 against the spec's reference boxes, and what the
 * page draws of a step over time (`tourLook`).
 */
import { describe, expect, it } from 'vitest';
import {
  boxHitsEllipse,
  clearOf,
  grow,
  intersects,
  nearestEdgeMidpoint,
  placeTourCard,
  segmentBoxDistance,
  talkCardFrame,
  thumbBox,
  tourLook,
  type Box,
  type FigureShape,
  type PlaceInput,
} from '../src/pages/scan/tour-layout.ts';
import { figureKeepOut, plateRectForStage, FIGURE_KEEP_OUT_REF } from '../src/character3d/room.ts';
import { OFF_VIEW, sideFor, type TourView } from '../src/stage/tour-machine.ts';
import type { FaceRegionKey } from '../shared/types.ts';
import type { CalloutSlot } from '../src/view/scan.ts';

interface Frame {
  name: string;
  u: number;
  face: { cx: number; cy: number; rx: number; ry: number };
  card: { w: number; h: number };
  contacts: Record<CalloutSlot, { region: FaceRegionKey; x: number; y: number }>;
  expected: Record<CalloutSlot, { zone: string; x: number; y: number }>;
}

const FRAMES: Frame[] = [
  {
    name: '1672 x 941',
    u: 1,
    face: { cx: 868.6, cy: 319.7, rx: 163.5, ry: 172.5 },
    card: { w: 220, h: 100 },
    contacts: {
      forehead: { region: 'forehead', x: 846, y: 188 },
      tzone: { region: 'nose', x: 868, y: 332 },
      cheeks: { region: 'cheekLeft', x: 747, y: 351 },
      underEyes: { region: 'periorbitalRight', x: 958, y: 294 },
      chin: { region: 'chin', x: 873, y: 452 },
    },
    expected: {
      forehead: { zone: 'out', x: 1060, y: 138 },
      tzone: { zone: 'out', x: 1060, y: 282 },
      cheeks: { zone: 'down', x: 528, y: 440 },
      underEyes: { zone: 'up', x: 986, y: 82 },
      chin: { zone: 'out', x: 1060, y: 402 },
    },
  },
  {
    name: '1366 x 768',
    u: 0.81615,
    face: { cx: 708.9, cy: 260.9, rx: 133.4, ry: 140.8 },
    card: { w: 212, h: 100 },
    contacts: {
      forehead: { region: 'forehead', x: 690.5, y: 153.4 },
      tzone: { region: 'nose', x: 708.4, y: 271.0 },
      cheeks: { region: 'cheekLeft', x: 609.7, y: 286.5 },
      underEyes: { region: 'periorbitalRight', x: 781.9, y: 240.0 },
      chin: { region: 'chin', x: 712.5, y: 368.9 },
    },
    expected: {
      forehead: { zone: 'out', x: 865, y: 103 },
      tzone: { zone: 'out', x: 865, y: 221 },
      cheeks: { zone: 'down', x: 433, y: 385 },
      underEyes: { zone: 'up', x: 805, y: 47 },
      chin: { zone: 'out', x: 865, y: 319 },
    },
  },
  {
    name: '1920 x 1080',
    u: 1.14772,
    face: { cx: 996.9, cy: 366.9, rx: 187.6, ry: 198.0 },
    card: { w: 236, h: 108 },
    contacts: {
      forehead: { region: 'forehead', x: 971.0, y: 215.8 },
      tzone: { region: 'nose', x: 996.2, y: 381.0 },
      cheeks: { region: 'cheekLeft', x: 857.3, y: 402.8 },
      underEyes: { region: 'periorbitalRight', x: 1099.5, y: 337.4 },
      chin: { region: 'chin', x: 1002.0, y: 518.8 },
    },
    expected: {
      forehead: { zone: 'out', x: 1217, y: 162 },
      tzone: { zone: 'out', x: 1217, y: 327 },
      cheeks: { zone: 'down', x: 604, y: 505 },
      underEyes: { zone: 'up', x: 1132, y: 102 },
      chin: { zone: 'out', x: 1217, y: 465 },
    },
  },
];

const SLOTS: CalloutSlot[] = ['forehead', 'tzone', 'cheeks', 'underEyes', 'chin'];
const THUMB = { w: 62, h: 62, inset: { left: 12, right: 0 } };

/** The page's fixed keep-outs at stage scale u (spec 7.2), margins included. */
function keepOuts(u: number): { header: Box; badge: Box; back: Box; floor: Box; talk: Box } {
  const s = (x0: number, y0: number, x1: number, y1: number, m: number): Box => grow({ x: x0 * u, y: y0 * u, w: (x1 - x0) * u, h: (y1 - y0) * u }, m);
  const f = talkCardFrame(u);
  const talkH = 136 * u;
  return {
    header: s(343, 48, 740, 95, 8),
    badge: s(765, 5, 907, 35, 8),
    back: s(16, 16, 100, 60, 8),
    floor: s(16, 780, 475, 925, 8),
    talk: grow({ x: f.cx - f.width / 2, y: f.bottom - talkH, w: f.width, h: talkH }, 12),
  };
}

function inputFor(frame: Frame, slot: CalloutSlot, figure: boolean): PlaceInput {
  const u = frame.u;
  const stage = { x: 0, y: 0, w: 1672 * u, h: 941 * u };
  const c = frame.contacts[slot];
  const k = keepOuts(u);
  let shape: FigureShape | null = null;
  if (figure) {
    const side = sideFor(c.region);
    shape = { side, ...figureKeepOut(side, plateRectForStage(stage), stage) };
  }
  return {
    region: c.region,
    contact: { x: c.x, y: c.y },
    card: frame.card,
    thumb: THUMB,
    home: { x: 480 * u, y: 127 * u, w: frame.card.w, h: frame.card.h },
    homeOrient: ['forehead', 'tzone', 'cheeks'].includes(slot) ? 'left' : 'right',
    face: frame.face,
    figure: shape,
    keepOut: [k.header, k.badge, k.back, k.floor],
    talk: k.talk,
    stage,
    u,
  };
}

describe('placeTourCard with her (the card goes where she and her arm are not)', () => {
  for (const frame of FRAMES) {
    for (const slot of SLOTS) {
      it(`${frame.name}: ${slot}`, () => {
        const input = inputFor(frame, slot, true);
        const p = placeTourCard(input);
        const e = frame.expected[slot];
        expect(p.clear).toBe(true);
        expect(p.zone).toBe(e.zone);
        expect(Math.abs(p.box.x - e.x)).toBeLessThanOrEqual(8);
        expect(Math.abs(p.box.y - e.y)).toBeLessThanOrEqual(8);
        // Orientation: the thumbnail faces the face.
        expect(p.orient).toBe(p.box.x > frame.face.cx ? 'right' : 'left');
        // Clear of everything (spec 13: every placement clears the keep-outs).
        const s = input.stage;
        expect(p.box.x).toBeGreaterThanOrEqual(8);
        expect(p.box.y).toBeGreaterThanOrEqual(8);
        expect(p.box.x + p.box.w).toBeLessThanOrEqual(s.w - 8);
        expect(p.box.y + p.box.h).toBeLessThanOrEqual(s.h - 8);
        expect(boxHitsEllipse(p.box, frame.face)).toBe(false);
        for (const k of [...input.keepOut, input.talk!]) expect(intersects(p.box, k)).toBe(false);
        expect(intersects(p.box, input.figure!.head)).toBe(false);
        expect(intersects(p.box, input.figure!.body)).toBe(false);
        expect(segmentBoxDistance(input.figure!.shoulder, input.contact!, p.box)).toBeGreaterThanOrEqual(input.figure!.armRadius);
        expect(clearOf(p.box, input)).toBe(true);
        // The port is the thumbnail edge midpoint nearest the spot.
        expect(p.port).toEqual(nearestEdgeMidpoint(thumbBox(p.box, p.orient, THUMB), input.contact!));
      });
    }
  }
});

describe('placeTourCard without her', () => {
  it('puts every card in its own summary slot, with today\'s port', () => {
    for (const frame of FRAMES) {
      for (const slot of SLOTS) {
        const input = inputFor(frame, slot, false);
        const p = placeTourCard(input);
        expect(p.zone).toBe('home');
        expect(p.box).toEqual(input.home);
        expect(p.orient).toBe(input.homeOrient);
        const t = thumbBox(p.box, p.orient, THUMB);
        expect(p.port).toEqual(p.orient === 'left' ? { x: t.x + t.w, y: t.y + t.h / 2 } : { x: t.x, y: t.y + t.h / 2 });
      }
    }
  });

  it('keeps a far-side spot at home while she cannot teleport', () => {
    const frame = FRAMES[0];
    const input = inputFor(frame, 'underEyes', true);
    const stage = input.stage;
    input.figure = { side: 'left', ...figureKeepOut('left', plateRectForStage(stage), stage) };
    expect(placeTourCard(input).zone).toBe('home');
  });
});

describe('geometry', () => {
  it('tests boxes against the face oval exactly', () => {
    const e = { cx: 0, cy: 0, rx: 10, ry: 5 };
    expect(boxHitsEllipse({ x: 9, y: -1, w: 4, h: 2 }, e)).toBe(true);
    expect(boxHitsEllipse({ x: 10.5, y: -1, w: 4, h: 2 }, e)).toBe(false);
    expect(boxHitsEllipse({ x: 7.2, y: 3.6, w: 5, h: 5 }, e)).toBe(false);
  });

  it('measures a segment against a box', () => {
    const b = { x: 0, y: 0, w: 10, h: 10 };
    expect(segmentBoxDistance({ x: -5, y: 5 }, { x: 15, y: 5 }, b)).toBe(0);
    expect(segmentBoxDistance({ x: -5, y: 20 }, { x: 15, y: 20 }, b)).toBe(10);
  });

  it('draws her silhouette at the default framing as the spec measured it, mirrored for the right', () => {
    const stage = { x: 0, y: 0, w: 1672, h: 941 };
    const plate = plateRectForStage(stage);
    const L = figureKeepOut('left', plate, stage);
    const R = figureKeepOut('right', plate, stage);
    const K = FIGURE_KEEP_OUT_REF;
    expect(L.head.x).toBeCloseTo(K.head.x, 0);
    expect(L.head.w).toBeCloseTo(K.head.w, 0);
    expect(L.body.y).toBeCloseTo(K.body.y, 0);
    expect(R.head.x).toBeCloseTo(1213, 0);
    expect(R.body.x + R.body.w).toBeCloseTo(1444, 0);
    expect(R.shoulder.x).toBeCloseTo(1239, 0);
    expect(L.armRadius).toBeCloseTo(34, 5);
  });

  it('centres the talk card on the pedestal axis, 480-720 px wide', () => {
    expect(talkCardFrame(1)).toEqual({ cx: 868, width: 600, bottom: 836 });
    expect(talkCardFrame(0.5).width).toBe(480);
    expect(talkCardFrame(2).width).toBe(720);
  });
});

describe('tourLook: what the page draws of a step over time', () => {
  function stepView(over: Partial<TourView>): TourView {
    return { ...OFF_VIEW, phase: 'step', index: 0, face: true, ...over } as TourView;
  }

  it('draws nothing outside a step', () => {
    expect(tourLook(OFF_VIEW, 0).card).toBeNull();
    expect(tourLook({ ...OFF_VIEW, phase: 'clean' } as TourView, 0).zones).toBe(false);
  });

  it('gathers light on the spot before the tap without her; the line draws out after the tap; the card slides in', () => {
    const reach = stepView({ beat: 'reach', marks: { reach: 1000 } });
    expect(tourLook(reach, 1150).gather).toBeCloseTo(0.5, 5);
    expect(tourLook({ ...reach, figure: true }, 1150).gather).toBeNull();
    const line = stepView({ beat: 'line', contactAt: 1300, marks: { reach: 1000, hold: 1300, line: 1420 } });
    const mid = tourLook(line, 1420 + 225);
    expect(mid.zones).toBe(true);
    expect(mid.line).toBeGreaterThan(0.5);
    expect(mid.line).toBeLessThan(1);
    expect(mid.dot).toBe(1);
    expect(mid.card).toBeNull();
    expect(mid.cardMounted).toBe(true);
    const card = stepView({ beat: 'card', contactAt: 1300, marks: { reach: 1000, hold: 1300, line: 1420, card: 1750 } });
    const c = tourLook(card, 1750 + 150)!.card!;
    expect(c.opacity).toBeGreaterThan(0.5);
    expect(c.shift).toBeLessThan(0);
    expect(tourLook(card, 2100).card).toEqual({ opacity: 1, shift: -0 });
  });

  it('takes the card out and the line back in, then fades the zones; fast when skipping', () => {
    const base = { contactAt: 1300, marks: { line: 1420, card: 1750, 'card-out': 9000, 'line-out': 9260 } };
    const out = tourLook(stepView({ beat: 'line-out', ...base }), 9260 + 190);
    expect(out.card).toBeNull();
    expect(out.zones).toBe(false);
    expect(out.line).toBeGreaterThan(0);
    expect(out.line).toBeLessThan(1);
    expect(tourLook(stepView({ beat: 'line-out', ...base }), 9260 + 380).line).toBe(0);
    const fast = tourLook(stepView({ beat: 'line-out', fast: true, contactAt: 1300, marks: { line: 1420, card: 1750, 'card-out': 5000, 'line-out': 5000 } }), 5000 + 200);
    expect(fast.line).toBe(0);
    expect(fast.card).toBeNull();
    expect(fast.zoneFadeMs).toBe(300);
  });

  it('under reduced motion: no gather, the line whole, opacity-only card', () => {
    const v = stepView({ beat: 'card', reducedMotion: true, contactAt: 1000, marks: { reach: 1000, hold: 1000, line: 1250, card: 1250 } });
    const look = tourLook(v, 1250 + 60);
    expect(look.gather).toBeNull();
    expect(look.line).toBe(1);
    expect(look.card!.shift).toBe(0);
    expect(look.card!.opacity).toBeCloseTo(0.5, 5);
  });
});
