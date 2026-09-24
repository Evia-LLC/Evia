/**
 * Where Home's room plate goes, as plain maths (tested in test/home.test.ts).
 *
 * The lounge render is wider and taller than ref1's Home panel on purpose: it
 * carries a margin on every side so any window shape can be covered. Plain
 * `object-fit: cover` would show all of that margin at once and the room would
 * read smaller than in the mockup, so Home places the plate itself:
 *
 * wide (sidebar or rail, >= 820px)
 *   The plate is scaled so ref1's Home panel (`ref`, from anchors.json) is as
 *   tall as the window, which is the mockup's own scale, and slid so the
 *   panel's right edge (the niche and the acrylic sign) meets the right edge
 *   of what Home can show. A wider window reveals more of the room to the
 *   left (the window wall), a narrower one less. Under the Routine panel
 *   (`right` < the window width) that reproduces ref1's composition: Home's
 *   visible part is ref1's left panel.
 *
 * compact (phone, < 820px)
 *   Cover the window with the seating group (`group`: the armchair, the side
 *   table and the acrylic sign on it) centred across it - the plate cropped
 *   to the seating area, with the sign's text whole rather than cut by the
 *   screen's edge.
 *
 * Either way the plate always covers the whole area Home can show (0..right,
 * 0..height), so no edge of the render is ever seen.
 */
import type { Point, RoomAnchors } from '@/stage/room-anchors.ts';

export interface PlateFrame {
  /** The render's own size in px. */
  w: number;
  h: number;
  /** ref1's Home panel inside the render, normalised: x0, y0, x1, y1. */
  ref: readonly [number, number, number, number];
  /** The (empty) armchair's seat, normalised. */
  seat: Point;
  /** The seating group's left and right edges, normalised: what a phone keeps in view. */
  group: readonly [number, number];
}

/**
 * The CSS stand-in's frame (Room's FALLBACK_ANCHORS.lounge is the whole of
 * ref1, 1536 x 1024, with Home's panel as its left 994px and the chair in it).
 */
export const LOUNGE_FALLBACK_FRAME: PlateFrame = {
  w: 1536,
  h: 1024,
  ref: [0, 0, 994 / 1536, 1],
  seat: [611 / 1536, 0.72],
  group: [466 / 1536, 1008 / 1536],
};

/*
 * The armchair reaches this far either side of its seat anchor, as a share
 * of the render's width (measured on the published lounge render: the chair
 * spans 0.721-0.891 around a seat at 0.815). The group's right edge is the
 * sign's text plus a hair, so the text is never the thing cut off.
 */
const CHAIR_HALF_WIDTH = 0.095;
const SIGN_MARGIN = 0.012;

/** The frame of a published render, from its anchors (points home_ref_tl/br and character). */
export function frameFromAnchors(anchors: RoomAnchors | null): PlateFrame {
  if (!anchors) return LOUNGE_FALLBACK_FRAME;
  const tl = anchors.points?.home_ref_tl;
  const br = anchors.points?.home_ref_br;
  const seat = anchors.points?.character ?? [0.5, 0.6];
  const sign = anchors.surfaces?.sign_text?.quad;
  const signRight = sign ? Math.max(...sign.map(([x]) => x)) + SIGN_MARGIN : seat[0] + CHAIR_HALF_WIDTH;
  return {
    w: anchors.frame.w,
    h: anchors.frame.h,
    ref: tl && br ? [tl[0], tl[1], br[0], br[1]] : [0, 0, 1, 1],
    seat,
    group: [seat[0] - CHAIR_HALF_WIDTH, Math.max(signRight, seat[0] + CHAIR_HALF_WIDTH)],
  };
}

export interface StageBox {
  /** The window's height. */
  height: number;
  /** The right edge of what Home can show: the window width, or the Routine panel's left edge. */
  right: number;
  /** The phone composition. */
  compact: boolean;
}

export interface PlateRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the seat lands in the phone's height (between the greeting and the tip card). */
const COMPACT_SEAT_Y = 0.62;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function plateRect(frame: PlateFrame, box: StageBox): PlateRect {
  const right = Math.max(1, box.right);
  const height = Math.max(1, box.height);
  const cover = Math.max(right / frame.w, height / frame.h);
  const [, y0, x1, y1] = frame.ref;

  let scale: number;
  let left: number;
  let top: number;
  if (box.compact) {
    scale = cover;
    left = right / 2 - ((frame.group[0] + frame.group[1]) / 2) * frame.w * scale;
    top = height * COMPACT_SEAT_Y - frame.seat[1] * frame.h * scale;
  } else {
    const refHeight = Math.max(1e-6, y1 - y0) * frame.h;
    scale = Math.max(cover, height / refHeight);
    left = right - x1 * frame.w * scale;
    top = -y0 * frame.h * scale;
  }

  const width = frame.w * scale;
  const tall = frame.h * scale;
  return {
    left: clamp(left, right - width, 0),
    top: clamp(top, height - tall, 0),
    width,
    height: tall,
  };
}
