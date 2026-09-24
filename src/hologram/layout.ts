/**
 * Where the hologram's parts sit, in the Scan mockup's own pixels.
 *
 * The consult-room reference (ref4, 1672 x 941) is the unit: one world unit
 * is one reference pixel, x to the right, y up (so a reference y of 547 is a
 * world y of -547), z toward the viewer. Every placement below is measured off
 * that image (specs/scan.md 2.6 and 5.3), which is what lets the Scan page lay
 * its canvas over the Blender pedestal plate and have the rings land on the
 * glass. The canvas shows a box of that frame (`HOLOGRAM_BOX` unless the page
 * asks for another) scaled to fit, the way `object-fit` would.
 *
 * No three.js here: the fit arithmetic is shared with the tests.
 */
import type { FaceSlot } from './geometry.ts';

export interface RefBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the reference frame the hologram occupies, rings and envelope included. */
export const HOLOGRAM_BOX: RefBox = { x: 560, y: 0, w: 550, h: 620 };

/**
 * Where a face goes: centred and sized like the mockup's sample face, whose
 * landmarks span x 713-1024, y 155-484 of the reference. A user's own mesh is
 * scaled to the same height and centred on the same point.
 */
export const FACE_SLOT: FaceSlot = { cx: 868.6, cy: 319.7, height: 328.9 };

/** Emitter rings and the glass orb at the base (reference px, centres and radii). */
export const BASE = {
  ringA: { cx: 865, cy: 547.5, rx: 190, ry: 19.5 },
  ringBOuter: { cx: 857, cy: 572.5, rx: 50, ry: 7.5 },
  ringBInner: { cx: 857, cy: 572.5, rx: 40, ry: 6 },
  /** The fainter wide ellipse under ring A (y 573-587, x 676-1055). */
  wash: { cx: 865.5, cy: 580, rx: 190, ry: 7 },
  orb: { cx: 930.5, cy: 571, r: 21 },
} as const;

export type Fit = 'contain' | 'cover';

export interface FitResult {
  /** CSS px per reference px. */
  scale: number;
  /** The reference point that lands on the canvas centre. */
  centreX: number;
  centreY: number;
}

/**
 * How a reference box maps onto a canvas of the given CSS size. `align` places
 * the box inside the spare room (0 = left/top, 1 = right/bottom), like
 * `object-position`; with `cover` it picks which part is cropped.
 */
export function fitBox(
  box: RefBox,
  cssWidth: number,
  cssHeight: number,
  fit: Fit = 'contain',
  align: { x: number; y: number } = { x: 0.5, y: 0.5 },
): FitResult {
  const w = Math.max(1, cssWidth), h = Math.max(1, cssHeight);
  const sx = w / box.w, sy = h / box.h;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const offX = (w - box.w * scale) * align.x;
  const offY = (h - box.h * scale) * align.y;
  return {
    scale,
    centreX: box.x + (w / 2 - offX) / scale,
    centreY: box.y + (h / 2 - offY) / scale,
  };
}

/** Distance from the camera to the face plane. Far enough that depth barely changes size, near enough to read as 3D when the head turns. */
export const CAMERA_DISTANCE = 8000;

/** Vertical field of view (degrees) that shows `cssHeight / scale` reference px at the face plane. */
export function fovFor(fitResult: FitResult, cssHeight: number): number {
  const visible = Math.max(1, cssHeight) / fitResult.scale;
  return (2 * Math.atan(visible / 2 / CAMERA_DISTANCE) * 180) / Math.PI;
}
