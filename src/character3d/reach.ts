/**
 * Where the pointing arm goes so that she visibly reaches for the region.
 *
 * On the Scan page the left callouts (FOREHEAD, PORES, CHEEKS) are HTML over
 * the canvas, standing between her and the head, and the card tray sits
 * below them. A hand under a card nobody sees, and a finger flicked beside her
 * hip is not a reach. So the whole arm is planned against the page's boxes
 * (`boxes`, canvas px), not only the hand:
 *
 *   hard  the callout being read (the region she is pointing at) and the
 *         tray: no part of the arm - upper arm, elbow, forearm, hand or
 *         fingertip, at its thickness - may pass under them;
 *   soft  a callout that is not being read: the arm may cross it, and the
 *         page fades that card back while it does (`yields`), the way a
 *         presenter steps in front of a slide she is not talking about.
 *
 * Among the reaches that keep every hard box clear, the one whose fingertip
 * ends nearest the region on screen wins, with a cost for every card it makes
 * fade and a little for bending away from the straight line. Candidates run
 * from the straight point (arm out along shoulder -> target), through raised
 * and lowered ones (the direction turned up or down, the elbow bent more,
 * hanging down or held out level): the presenter's point from below, index
 * turned up at the region, or from above, over a card she is reading from.
 * `mode` says which family won: 'straight' (within a few degrees of the line,
 * or raised), 'under' (lowered), or
 * 'blocked' (no reach kept the hard boxes clear; the one that showed the most
 * of the arm).
 *
 * Three.js math only; the tests drive it with a plain projection.
 */
import * as THREE from 'three';
import { pointingWrist, solveTwoBone } from './ik.ts';

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box on the page, over the canvas. */
export interface ReachBox extends ScreenRect {
  /** The page's name for it (a callout's slot), so the page knows which card to fade. */
  id?: string;
  /** A card not being read: the arm may pass in front of it (the page fades it). */
  soft?: boolean;
}

export type ReachMode = 'straight' | 'under' | 'blocked';
export type ElbowKind = 'down' | 'out' | 'up';

export interface ReachPlan {
  wrist: THREE.Vector3;
  mode: ReachMode;
  /**
   * Where the elbow goes: 'down' (out and down, the relaxed arm), 'out' (out to the side, level)
   * or 'up' (raised, the forearm coming down to the spot over a card below it).
   */
  elbow: ElbowKind;
  /** Soft boxes the planned arm crosses (their ids). */
  yields: string[];
  /** Fingertip to target on screen, px. */
  gap: number;
}

export interface ReachOptions {
  shoulder: THREE.Vector3;
  target: THREE.Vector3;
  /** Shoulder to elbow and elbow to wrist, world units. */
  upper: number;
  fore: number;
  /** Wrist to index fingertip, world units. */
  hand: number;
  /** World point to canvas px. */
  project: (p: THREE.Vector3) => { x: number; y: number };
  boxes: readonly ReachBox[];
  /** Where the elbow points (the figure's pole) for the point from below (`lowered`) or not, and the elbow kind. */
  pole: (lowered: boolean, elbow: ElbowKind) => THREE.Vector3;
  /** Half-thickness of upper arm, forearm and hand, world units. */
  radius?: readonly [number, number, number];
  /** Clearance around every box, px. */
  margin?: number;
  /** Cost of one card faded, in px of fingertip distance. */
  yieldCost?: number;
  /** Turns of the reach about the vertical to try as well, degrees (default only the straight line). */
  turns?: readonly number[];
  /** Development: told about every candidate (its plan, the hard boxes it touched, its score). */
  trace?: (plan: ReachPlan, hard: string[], score: number, elbowPx: { x: number; y: number }, samples?: ArmSample[]) => void;
}

/** True when none of the points falls inside any box grown by `margin`. */
export function clearOf(points: readonly { x: number; y: number }[], avoid: readonly ScreenRect[], margin = 8): boolean {
  for (const p of points) {
    for (const r of avoid) {
      if (p.x > r.x - margin && p.x < r.x + r.w + margin && p.y > r.y - margin && p.y < r.y + r.h + margin) return false;
    }
  }
  return true;
}

/** Distance, px, from a point to a rectangle (0 inside it). */
export function rectDistance(p: { x: number; y: number }, r: ScreenRect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** A disc on screen: a sample along the arm, its half-thickness there and its clearance (px, added to the box margin). */
export interface ArmSample {
  x: number;
  y: number;
  r: number;
  slack: number;
}

/**
 * Screen samples along an arm (shoulder -> elbow -> wrist -> fingertip) with the arm's
 * thickness at each, from world points. The shoulder itself is left out (it is her body), and
 * the upper arm may touch a box's edge by a few px (in ref4 too her shoulder is at the CHEEKS
 * card's corner): what matters is the forearm, the hand and the fingertip.
 */
export function armSamples(
  points: { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3; tip: THREE.Vector3 },
  radius: readonly [number, number, number],
  project: (p: THREE.Vector3) => { x: number; y: number },
): ArmSample[] {
  const out: ArmSample[] = [];
  const side = new THREE.Vector3(1, 0, 0);
  const seg = (a: THREE.Vector3, b: THREE.Vector3, rad: number, from: number, n: number, slack: (k: number) => number) => {
    for (let i = 0; i <= n; i++) {
      const k = from + ((1 - from) * i) / n;
      const p = a.clone().lerp(b, k);
      const s = project(p);
      const e = project(p.clone().addScaledVector(side, rad));
      const r = Math.hypot(e.x - s.x, e.y - s.y);
      out.push({ x: s.x, y: s.y, r, slack: slack(k) * r });
    }
  };
  // The upper arm: up to 60% of its thickness may overlap near the shoulder, none by the elbow.
  seg(points.shoulder, points.elbow, radius[0], 0.35, 4, (k) => -0.6 * (1 - k) / 0.65);
  seg(points.elbow, points.wrist, radius[1], 0.15, 5, () => 0);
  seg(points.wrist, points.tip, radius[2], 0.2, 4, () => 0);
  return out;
}

/** Which boxes the samples touch (disc within `margin` of the box). */
export function touched(samples: readonly ArmSample[], boxes: readonly ReachBox[], margin: number): Set<ReachBox> {
  const hit = new Set<ReachBox>();
  for (const b of boxes) {
    for (const s of samples) {
      if (rectDistance(s, b) < s.r + margin + s.slack) {
        hit.add(b);
        break;
      }
    }
  }
  return hit;
}

const DEFAULT_RADIUS: [number, number, number] = [0.05, 0.04, 0.042];
/** The most the planned hand turns off the forearm's line, radians. */
const MAX_BEND = (58 * Math.PI) / 180;

export function planReach(o: ReachOptions): ReachPlan {
  const margin = o.margin ?? 6;
  const radius = o.radius ?? DEFAULT_RADIUS;
  const yieldCost = o.yieldCost ?? 70;
  const armLength = o.upper + o.fore;
  const toTarget = o.target.clone().sub(o.shoulder);
  const dist = toTarget.length();
  const dn = dist > 1e-9 ? toTarget.clone().multiplyScalar(1 / dist) : new THREE.Vector3(0, 0, 1);
  // "Down" square to the line to the target: turning the direction toward it lowers the arm.
  const down = new THREE.Vector3(0, -1, 0).addScaledVector(dn, dn.y);
  if (down.lengthSq() < 1e-9) down.set(1, 0, 0);
  down.normalize();
  const targetPx = o.project(o.target);

  let best: { plan: ReachPlan; score: number } | null = null;
  let fallback: { plan: ReachPlan; bad: number } | null = null;
  const up = new THREE.Vector3(0, 1, 0);
  for (let deg = -24; deg <= 60; deg += 4) {
    const a = (deg * Math.PI) / 180;
    const pitched = dn.clone().multiplyScalar(Math.cos(a)).addScaledVector(down, Math.sin(a)).normalize();
    // Turned about the vertical too (toward or away from the viewer), for a hand kept off a box
    // that stands right beside her: the hand then presents from in front of her.
    for (const yaw of o.turns ?? [0]) {
    const dir = yaw ? pitched.clone().applyAxisAngle(up, (yaw * Math.PI) / 180) : pitched;
    for (const r of [0.985, 0.94, 0.88, 0.8, 0.72, 0.64]) {
      // Out along `dir`, but never so far that the hand would pass the target.
      let out = armLength * r;
      const along = dir.dot(toTarget);
      if (deg === 0) out = pointingWrist(o.shoulder, o.target, armLength, o.hand, r).distanceTo(o.shoulder);
      const w = o.shoulder.clone().addScaledVector(dir, out);
      if (w.distanceTo(o.target) < o.hand * 1.05 || along < 0) continue;
      const lowered = deg > 5;
      for (const elbow of ['down', 'out', 'up'] as const) {
        const sol = solveTwoBone(o.shoulder, w, o.upper, o.fore, o.pole(lowered, elbow));
        // The wrist bends at most about 60 degrees off the forearm (its limit is 70).
        const bend = w.clone().sub(sol.elbow).angleTo(o.target.clone().sub(w));
        if (bend > MAX_BEND) continue;
        const tip = w.clone().addScaledVector(o.target.clone().sub(w).normalize(), o.hand);
        const samples = armSamples({ shoulder: o.shoulder, elbow: sol.elbow, wrist: w, tip }, radius, o.project);
        const hit = touched(samples, o.boxes, margin);
        const hard = [...hit].filter((b) => !b.soft);
        const yields = [...hit].filter((b) => b.soft).map((b) => b.id ?? '');
        const tipPx = o.project(tip);
        const gap = Math.hypot(tipPx.x - targetPx.x, tipPx.y - targetPx.y);
        const plan: ReachPlan = { wrist: w, mode: lowered ? 'under' : 'straight', elbow, yields, gap };
        o.trace?.(plan, hard.map((b) => b.id ?? '?'), gap + yieldCost * yields.length, o.project(sol.elbow), samples);
        if (hard.length) {
          // No clear reach at all: keep the one with the fewest samples under a hard box.
          let bad = 0;
          for (const s of samples) if (hard.some((b) => rectDistance(s, b) < s.r + margin + s.slack)) bad++;
          if (!fallback || bad < fallback.bad) fallback = { plan: { ...plan, mode: 'blocked' }, bad };
          continue;
        }
        // Nearest fingertip wins; a card faded, a turn away from the line, a bent elbow and a
        // raised elbow (less natural than one hanging down) each cost a little.
        const score = gap + yieldCost * yields.length + Math.abs(deg) * 0.6 + Math.abs(yaw) * 0.4 + (0.985 - r) * 40 + (elbow === 'out' ? 12 : elbow === 'up' ? 30 : 0);
        if (!best || score < best.score) best = { plan, score };
      }
    }
    }
  }
  if (best) return best.plan;
  if (fallback) return fallback.plan;
  return { wrist: pointingWrist(o.shoulder, o.target, armLength, o.hand, 0.985), mode: 'blocked', elbow: 'down', yields: [], gap: Infinity };
}

/**
 * A resting hand (the palm-up present) moved down, if it has to be, until the hand and the
 * forearm are clear of the boxes. `along` is the direction the hand runs; `elbow` (optional)
 * where the elbow is, so the forearm is checked too.
 */
export function clearWrist(
  wrist: THREE.Vector3,
  along: THREE.Vector3,
  handLength: number,
  scale: number,
  project: (p: THREE.Vector3) => { x: number; y: number },
  avoid: readonly ScreenRect[],
  margin = 8,
  elbow?: THREE.Vector3,
): THREE.Vector3 {
  if (!avoid.length) return wrist;
  const pts = (w: THREE.Vector3) => {
    const out = [0, 0.5, 1].map((k) => project(w.clone().addScaledVector(along, handLength * k)));
    if (elbow) for (const k of [0.35, 0.7]) out.push(project(elbow.clone().lerp(w, k)));
    return out;
  };
  for (let drop = 0; drop <= 0.3; drop += 0.015) {
    const w = wrist.clone();
    w.y -= drop * scale;
    if (clearOf(pts(w), avoid, margin)) return w;
  }
  return wrist;
}
