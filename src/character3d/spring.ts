/**
 * Critically damped springs: every smooth move the figure makes.
 *
 * A critically damped spring reaches its target as fast as it can without
 * overshooting, and it is continuous in position and velocity whatever the
 * target does - a target that jumps (a new region, a new pose) turns into a
 * smooth reach, never a pop. The step is the exact closed-form solution, so it
 * is stable at any frame time. `omega` is the natural frequency (rad/s): the
 * move is about 90% done after 4 / omega seconds.
 *
 * Reduced motion snaps: `snap` puts the value on its target with no velocity,
 * so a reach is instant rather than animated.
 */

export interface Spring {
  x: number;
  v: number;
}

export function spring(x = 0): Spring {
  return { x, v: 0 };
}

/** Advances one scalar spring toward `target` by `dt` seconds. */
export function stepSpring(s: Spring, target: number, omega: number, dt: number): number {
  if (dt <= 0) return s.x;
  const e = Math.exp(-omega * dt);
  const delta = s.x - target;
  const temp = (s.v + omega * delta) * dt;
  s.x = target + (delta + temp) * e;
  s.v = (s.v - omega * temp) * e;
  return s.x;
}

export function snapSpring(s: Spring, target: number): number {
  s.x = target;
  s.v = 0;
  return s.x;
}

/** Three springs moving a point together. */
export interface Spring3 {
  x: [number, number, number];
  v: [number, number, number];
  /** False until it has been given a first target (it starts there rather than flying in from 0). */
  primed: boolean;
}

export function spring3(): Spring3 {
  return { x: [0, 0, 0], v: [0, 0, 0], primed: false };
}

export function stepSpring3(s: Spring3, target: readonly number[], omega: number, dt: number, snap = false): [number, number, number] {
  if (!s.primed || snap) {
    s.x = [target[0], target[1], target[2]];
    s.v = [0, 0, 0];
    s.primed = true;
    return s.x;
  }
  if (dt <= 0) return s.x;
  const e = Math.exp(-omega * dt);
  for (let i = 0; i < 3; i++) {
    const delta = s.x[i] - target[i];
    const temp = (s.v[i] + omega * delta) * dt;
    s.x[i] = target[i] + (delta + temp) * e;
    s.v[i] = (s.v[i] - omega * temp) * e;
  }
  return s.x;
}

/** How far a spring still is from resting on `target` (distance plus a little of its speed). */
export function springRestless(s: Spring3, target: readonly number[]): number {
  let d = 0;
  for (let i = 0; i < 3; i++) d += Math.abs(s.x[i] - target[i]) + Math.abs(s.v[i]) * 0.1;
  return d;
}
