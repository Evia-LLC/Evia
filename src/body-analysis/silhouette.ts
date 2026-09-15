/**
 * The outline of a person, read off a segmentation mask.
 *
 * The landmark model gives 33 joints, and none of them is a waist. Every width
 * measurement built on joints alone is therefore a stand-in: the old waist
 * reading was literally `(shoulderWidth + hipWidth) / 2`, which is the average
 * of two other measurements and contains no information about an abdomen at
 * all. It could not have detected a change in one.
 *
 * A segmentation mask does have the abdomen in it, because it has the whole
 * body outline. So widths are measured here, from the mask, at heights the
 * landmarks point to — joints for *where to look*, silhouette for *how wide*.
 *
 * Two things make this harder than "leftmost and rightmost lit pixel":
 *
 *  - Arms. At waist height a hanging arm is part of the outline, and a waist
 *    measured to the outside of the forearms is not a waist. So a row is read
 *    as the single run of body *containing the torso axis*, which drops a limb
 *    that has air between it and the trunk. It cannot drop one that is touching
 *    — no measurement can, which is why the capture instructions ask for arms
 *    away from the sides and the side view asks for hands on the head.
 *
 *  - Mask noise. The lite model's edges shimmer by a pixel or two between
 *    frames, and a single row can be locally wrong. Every reading here is the
 *    median of a small band of rows rather than one of them.
 */

/** A segmentation mask: per-pixel confidence that this is the person. */
export interface Mask {
  data: Float32Array;
  width: number;
  height: number;
}

/** Confidence above which a pixel counts as body. */
const PRESENT = 0.5;

/**
 * How far either side of the axis to hunt for the body before giving up.
 *
 * The torso axis comes from landmarks and the mask comes from a different head
 * of the same model, so they disagree by a few pixels at the edges. This is
 * slack for that, not a search: a body that is not within a sixth of the frame
 * of where the joints say it is means something has gone wrong upstream.
 */
const AXIS_SLACK = 1 / 6;

/** Rows sampled either side of a target height. Median of these is the reading. */
const BAND_RADIUS = 2;

/** Runs narrower than this are mask speckle, not a person. */
const MIN_RUN = 0.01;

function at(mask: Mask, x: number, y: number): number {
  return mask.data[y * mask.width + x] ?? 0;
}

/**
 * The horizontal extent of the body in one row, as a fraction of frame width.
 *
 * `centreX` is where the torso axis crosses this row. The run returned is the
 * one that contains it — see the note on arms above.
 */
export function runAt(mask: Mask, y: number, centreX: number): number | null {
  const row = Math.max(0, Math.min(mask.height - 1, Math.round(y * (mask.height - 1))));
  const maxX = mask.width - 1;
  let cx = Math.max(0, Math.min(maxX, Math.round(centreX * maxX)));

  if (at(mask, cx, row) < PRESENT) {
    // The axis landed just off the body. Step out symmetrically for it.
    const slack = Math.round(AXIS_SLACK * mask.width);
    let found = -1;
    for (let d = 1; d <= slack; d++) {
      if (cx - d >= 0 && at(mask, cx - d, row) >= PRESENT) {
        found = cx - d;
        break;
      }
      if (cx + d <= maxX && at(mask, cx + d, row) >= PRESENT) {
        found = cx + d;
        break;
      }
    }
    if (found < 0) return null;
    cx = found;
  }

  let left = cx;
  while (left > 0 && at(mask, left - 1, row) >= PRESENT) left--;
  let right = cx;
  while (right < maxX && at(mask, right + 1, row) >= PRESENT) right++;

  const span = (right - left + 1) / mask.width;
  return span < MIN_RUN ? null : span;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A width reading at one height, smoothed across neighbouring rows. */
export function widthAt(mask: Mask, y: number, centreX: number): number | null {
  const step = 1 / Math.max(1, mask.height - 1);
  const runs: number[] = [];
  for (let d = -BAND_RADIUS; d <= BAND_RADIUS; d++) {
    const run = runAt(mask, y + d * step, centreX);
    if (run !== null) runs.push(run);
  }
  return median(runs);
}

/**
 * Every width between two heights, sampled evenly.
 *
 * `axis` maps a height to where the torso centre is at that height, because a
 * standing person is rarely vertical and a fixed centre would walk off the body
 * on anyone leaning.
 */
export function widthsBetween(
  mask: Mask,
  yTop: number,
  yBottom: number,
  axis: (y: number) => number,
  samples = 24,
): { y: number; width: number }[] {
  const out: { y: number; width: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const y = yTop + ((yBottom - yTop) * i) / Math.max(1, samples - 1);
    const width = widthAt(mask, y, axis(y));
    if (width !== null) out.push({ y, width });
  }
  return out;
}

/** The narrowest reading in a set, or null if there were none. */
export function narrowest(widths: { y: number; width: number }[]): { y: number; width: number } | null {
  return widths.reduce<{ y: number; width: number } | null>(
    (best, w) => (best === null || w.width < best.width ? w : best),
    null,
  );
}

/** The widest reading in a set, or null if there were none. */
export function widest(widths: { y: number; width: number }[]): { y: number; width: number } | null {
  return widths.reduce<{ y: number; width: number } | null>(
    (best, w) => (best === null || w.width > best.width ? w : best),
    null,
  );
}

/** The typical reading in a set — median, so one bad row cannot move it. */
export function typical(widths: { y: number; width: number }[]): number | null {
  return median(widths.map((w) => w.width));
}

/** A point in normalised image space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The torso's own coordinate system: heights as fractions of shoulder-to-hip.
 *
 * Shared by the front and side measurements on purpose. Both express "the chest
 * band" as the same fraction of the same span, so the widths they produce are
 * comparable quantities measured the same way — which is the only reason a
 * waist-to-chest ratio from one view and a depth-to-chest ratio from the other
 * can sit next to each other without a footnote.
 */
export interface TorsoFrame {
  /** Where the torso centre line crosses a given height. */
  axis(y: number): number;
  /** The image height at a fraction of the way from shoulders to hips. */
  at(fraction: number): number;
  span: number;
}

/** Null when the shoulders and hips are too close to define a torso. */
export function torsoFrame(shoulderMid: Point, hipMid: Point): TorsoFrame | null {
  const span = hipMid.y - shoulderMid.y;
  if (span <= 0.02) return null;
  return {
    span,
    axis: (y) => shoulderMid.x + ((hipMid.x - shoulderMid.x) * (y - shoulderMid.y)) / span,
    at: (fraction) => shoulderMid.y + span * fraction,
  };
}

/**
 * The widths across a band of the torso, given as fractions of the span.
 *
 * The one entry point both views use, so "the chest band" cannot come to mean
 * two different things in two files.
 */
export function bandWidths(
  mask: Mask,
  frame: TorsoFrame,
  band: readonly [number, number],
): { y: number; width: number }[] {
  return widthsBetween(mask, frame.at(band[0]), frame.at(band[1]), frame.axis);
}
