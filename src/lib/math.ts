/** Small maths helpers shared by the character rig and the scene director. */

export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential approach. `speed` is roughly 1/seconds. */
export const damp = (current: number, target: number, speed: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-speed * dt));

export const smoothstep = (t: number): number => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/**
 * Critically damped spring. Used for head turns and weight shifts — it settles
 * without overshoot, which is what makes idle motion read as a body rather than
 * as an animation curve.
 */
export class Spring {
  value: number;
  private velocity = 0;
  private stiffness: number;
  private damping: number;

  constructor(initial: number, stiffness = 90, damping = 2 * Math.sqrt(stiffness)) {
    this.value = initial;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  step(target: number, dt: number): number {
    // Clamped so a stalled tab does not launch the value into orbit on resume.
    const h = Math.min(dt, 1 / 30);
    const accel = this.stiffness * (target - this.value) - this.damping * this.velocity;
    this.velocity += accel * h;
    this.value += this.velocity * h;
    return this.value;
  }

  reset(v: number): void {
    this.value = v;
    this.velocity = 0;
  }
}

/**
 * Deterministic 1D value noise. Cheaper than Perlin and smooth enough for
 * micro-drift, which is all the idle layer needs.
 */
export function valueNoise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

/**
 * Blink timing. Humans blink in bursts, not on a metronome — a uniform interval
 * is one of the fastest ways to make a face read as fake.
 */
export function nextBlinkDelay(): number {
  if (Math.random() < 0.12) return 0.12 + Math.random() * 0.18; // double blink
  return 1.8 + Math.random() * 4.6;
}
