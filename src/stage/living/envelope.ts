/**
 * The living room's motion, as plain functions of time (seconds) and a seed:
 * candle flicker, globe breathing, LED breathing and travelling glow, wind
 * with gusts, city windows switching off and on, an aircraft's beacon.
 *
 * Everything is deterministic (same t, same value), bounded and slow, so it
 * can be tested (test/living-envelope.test.ts) and replayed frame by frame for
 * captures. Premium means quiet: nothing here strobes. WCAG 2.3.1 asks that
 * nothing flash more than three times a second; the lamps move +-3 % over two
 * to four seconds (home.md s9), the LEDs breathe over seven or eight, and the
 * only on/off light, the aircraft's beacon, blinks under once a second and is
 * a couple of pixels across.
 *
 * The window twinkle and the breeze are also evaluated per pixel in the shader
 * (shader.ts has the same integer hash and the same arithmetic); `twinkleOff`
 * and `breeze` here are their references, which the tests exercise. Both are
 * periodic in what the shader is given (a wrapped clock, wrapped drifts), so
 * a wrap never shows: see NOISE_PERIOD and TWINKLE_SLOTS.
 */

/* ---- hashing and noise ------------------------------------------------- */

/** A 32-bit integer hash (the PCG output permutation). The shader's `pcg` is the same function. */
export function pcg(n: number): number {
  const state = (Math.imul(n >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** A hash of an integer to [0, 1). */
export const hash01 = (n: number): number => pcg(n) / 4294967296;

/** Quintic smoothstep of a fraction (C2, slope <= 1.875). */
const fade = (f: number): number => f * f * f * (f * (f * 6 - 15) + 10);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The shader's noise lattices repeat every NOISE_PERIOD cells, so a drift fed
 * to them wrapped at NOISE_PERIOD (the float time the GPU is given must stay
 * small) carries on without a seam.
 */
export const NOISE_PERIOD = 256;

const wrapCell = (i: number, period: number): number => (period > 0 ? ((i % period) + period) % period : i);

/**
 * Smooth 1D value noise in [-1, 1]: C2, and its slope never exceeds 3.75 per
 * unit of x, so `noise1(t * f)` changes at most 3.75 * f per second. With a
 * `period` its lattice repeats every `period` cells (noise1(x + period) =
 * noise1(x)), as the shader's does.
 */
export function noise1(x: number, seed: number, period = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = pcg(seed * 7919 + 13);
  const a = hash01(((wrapCell(i, period) >>> 0) + s) >>> 0);
  const b = hash01(((wrapCell(i + 1, period) >>> 0) + s) >>> 0);
  return (a + (b - a) * fade(f)) * 2 - 1;
}

/* ---- lamps ---------------------------------------------------------------- */

/**
 * home.md s9: globe lamps and the candle globe move "+-3 % brightness,
 * irregular, 2-4 s". LAMP_SWING is that bound for every lamp.
 */
export const LAMP_SWING = 0.03;
/** How much a candle's light moves: layered noise, at most this far either way. */
export const CANDLE_AMP = 0.022;
/** A draught now and then: the flame leans and the light sags this much more, slowly. */
export const CANDLE_DIP = 0.008;

/**
 * A candle-lit globe's gain (1 = as rendered): three octaves of slow noise
 * (0.3, 0.53 and 0.95 Hz, weighted 0.55 / 0.3 / 0.15: the light shifts every
 * two to four seconds, never in a regular beat) and, every half minute or so,
 * a gentle sag of a second or two as if a draught leaned the flame. Always
 * within [1 - CANDLE_AMP - CANDLE_DIP, 1 + CANDLE_AMP] = within +-LAMP_SWING.
 */
export function candle(t: number, seed: number): number {
  const n = 0.55 * noise1(t * 0.3, seed) + 0.3 * noise1(t * 0.53, seed + 101) + 0.15 * noise1(t * 0.95, seed + 211);
  return 1 + CANDLE_AMP * n - CANDLE_DIP * draught(t, seed);
}

/** 0..1: a rare, slow sag (the draught) on a ~27 s slot schedule. */
export function draught(t: number, seed: number): number {
  const P = 27;
  const shifted = t + hash01(seed * 31 + 7) * P;
  const slot = Math.floor(shifted / P);
  const u = shifted - slot * P;
  const key = pcg((seed * 977 + slot * 7919) >>> 0);
  if (hash01(key) > 0.55) return 0;
  const start = 2 + hash01(key + 1) * (P - 8);
  const len = 1.2 + hash01(key + 2) * 1.6;
  // Sags over ~0.7 s, holds a moment, recovers over ~1 s.
  return smoothstep(start, start + 0.7, u) * (1 - smoothstep(start + 0.7 + len * 0.4, start + 0.7 + len * 0.4 + 1, u));
}

/**
 * A globe lamp: smoother than the candle, +-BREATHE_LAMP around as rendered,
 * drifting irregularly every two to four seconds (two octaves of slow noise,
 * 0.4 and 0.66 Hz, the phase set by the lamp).
 */
export const BREATHE_LAMP = LAMP_SWING;
export function globe(t: number, seed: number): number {
  const shift = hash01(seed * 17 + 5) * 97;
  return 1 + BREATHE_LAMP * (0.65 * noise1((t + shift) * 0.4, seed + 7) + 0.35 * noise1((t + shift) * 0.66, seed + 19));
}

/** The gain for a lamp by its `motion` (anchors `lights[].motion`). */
export function lampGain(motion: string, t: number, seed: number): number {
  if (motion === 'flicker') return candle(t, seed);
  if (motion === 'breathe') return globe(t, seed);
  if (motion === 'blink') return 1 + 0.6 * beacon(t, seed);
  return 1;
}

/**
 * Limits how fast a value may move: at most `perSecond` per second. Every
 * lamp's gain passes through this before it reaches the shader, so a skipped
 * frame (or a device at 30 fps) never turns into a jump.
 */
export function slew(previous: number, next: number, perSecond: number, dt: number): number {
  const step = perSecond * Math.max(0, dt);
  return previous + Math.min(step, Math.max(-step, next - previous));
}
/** The fastest a lamp's gain may change, per second (0.25 = under 1 % of its light per frame at 30 fps). */
export const LAMP_SLEW = 0.25;

/* ---- LEDs --------------------------------------------------------------- */

/**
 * The LED coves breathing, as a multiple of the LEDs' own light (the glow
 * layer, plate minus dim) added to the plate: 0 = as rendered. home.md s9
 * asks for "emission opacity 0.9 <-> 1.0" over 6-8 s: by default between
 * BREATH_MIN and BREATH_MAX, so the LEDs dim a tenth and come back, never
 * brighter than rendered. A room can pass its own range (the consult room's
 * +-5 %, scan.md s9).
 */
export const BREATH_MIN = -0.1;
export const BREATH_MAX = 0;
export function breath(t: number, period = 7, phase = 0, lo = BREATH_MIN, hi = BREATH_MAX): number {
  const s = Math.sin((t / period) * Math.PI * 2 + phase);
  return (lo + hi) / 2 + ((hi - lo) / 2) * s;
}

/**
 * A slow pulse travelling along an LED strip: how many waves fit its length
 * and where they are. On a closed strip (`ring`) the count is a whole number,
 * so the wave meets itself where the strip's 0..1 distance wraps.
 */
export function stripWaves(lengthM: number, ring: boolean, waveM: number): number {
  const n = lengthM / Math.max(0.1, waveM);
  return ring ? Math.max(1, Math.round(n)) : n;
}
/** The travelling pulse's shape at phase x (period 1): a soft bright bead, 0..1. */
export function pulseShape(x: number, sharpness = 8): number {
  return Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * x), sharpness);
}

/* ---- wind --------------------------------------------------------------- */

/**
 * A gust: every ~24 s slot there may be one, whose front crosses the frame
 * from left to right (x in plate widths, -0.4 .. 1.4) in about 5 s. Returns
 * where the front is and how strong it is (0 when there is none).
 */
export const GUST_SLOT = 24;
export function gust(t: number, seed = 1): { front: number; strength: number } {
  const shifted = t + hash01(seed * 13 + 1) * GUST_SLOT;
  const slot = Math.floor(shifted / GUST_SLOT);
  const u = shifted - slot * GUST_SLOT;
  const key = pcg((seed * 6151 + slot * 3571) >>> 0);
  if (hash01(key) > 0.7) return { front: -1, strength: 0 };
  const crossing = 4.5 + hash01(key + 2) * 2;
  // Starts late enough to ease in from nothing and ends (p = 1.6) before the slot does.
  const start = 1.5 + hash01(key + 1) * (GUST_SLOT - 2 - 1.6 * 6.5);
  const p = (u - start) / crossing;
  if (p < -0.2 || p > 1.6) return { front: -1, strength: 0 };
  // Strength eases in and out over the crossing so the gust arrives and leaves softly.
  const strength = (0.6 + 0.4 * hash01(key + 3)) * smoothstep(-0.2, 0.15, p) * (1 - smoothstep(1.0, 1.6, p));
  return { front: -0.4 + 1.8 * p, strength };
}

/**
 * The gust's push at a point x (plate widths) behind or ahead of the front:
 * it rises quickly as the front arrives and eases off behind it. 0..1.
 */
export function gustPush(x: number, front: number, strength: number): number {
  if (strength <= 0) return 0;
  const q = (front - x) / 0.3;
  return strength * (q < 0 ? Math.exp(-q * q * 4) : Math.exp(-q * 1.2));
}

/**
 * The steady breeze at x (plate widths) and time t, in [-1, 1]: two slow
 * waves moving across the room at different speeds (so neighbouring plants
 * sway nearly together and far ones out of phase) plus slow noise. The noise
 * lattice repeats every NOISE_PERIOD cells, as the shader's does, so the
 * shader can be given `(t * 0.25) % NOISE_PERIOD` without a seam.
 */
export function breeze(x: number, t: number, seed = 1): number {
  return (
    0.5 * Math.sin(Math.PI * 2 * (t / 5.3 - x * 0.9)) +
    0.3 * Math.sin(Math.PI * 2 * (t / 3.1 - x * 1.7) + 1.3) +
    0.2 * noise1(t * 0.25 + x * 2, seed, NOISE_PERIOD)
  );
}

/**
 * A plant's horizontal lean at x, as a share of the sway amplitude: the
 * breeze (at most +-0.55) and a passing gust's push (at most +0.45, with the
 * wind). Always within [-0.55, 1].
 */
export function windLean(x: number, t: number, g: { front: number; strength: number }, seed = 1): number {
  return 0.55 * breeze(x, t, seed) + 0.45 * gustPush(x, g.front, g.strength);
}

/* ---- the city ------------------------------------------------------------ */

/** How the lit windows switch: slots of TWINKLE_PERIOD s, fades of TWINKLE_FADE s. */
export const TWINKLE_PERIOD = 30;
export const TWINKLE_FADE = 0.45;
/**
 * The slot schedule repeats every TWINKLE_SLOTS slots (two hours), exactly the
 * shader clock's wrap (schedule.ts CLOCK_WRAP), so the wrap carries a window
 * that is fading on through it instead of re-rolling it.
 */
export const TWINKLE_SLOTS = 240;

/**
 * Whether the lit windows sharing a window id (0..255, mask-windows G) are
 * switched off at time t: 0 (lit, as rendered) .. 1 (dark). In each 30 s slot
 * an id goes dark with probability `chance`, for 3-15 s, fading over 0.45 s
 * each way (a room light switched off, not a blink). home.md s9 asks for "a
 * few % per minute": a chance of 0.015 turns 3 % of the ids off per minute.
 * The shader computes the same thing per pixel (shader.ts `twinkleOff`).
 */
export function twinkleOff(id: number, t: number, chance: number): number {
  const P = TWINKLE_PERIOD;
  const F = TWINKLE_FADE;
  const shifted = t + hash01((id * 3 + 1) >>> 0) * P;
  const slot = Math.floor(shifted / P);
  const u = shifted - slot * P;
  const key = (Math.imul(id >>> 0, 7919) + Math.imul(wrapCell(slot, TWINKLE_SLOTS) >>> 0, 104729)) >>> 0;
  if (hash01(key) >= chance) return 0;
  const dur = 3 + 12 * hash01((key ^ 0x9e3779b9) >>> 0);
  const start = F + hash01((key + 1) >>> 0) * (P - dur - 3 * F);
  return smoothstep(start - F, start, u) * (1 - smoothstep(start + dur, start + dur + F, u));
}

/**
 * Distant lights shimmer (a slow sine of a share of their light) at 0.7-1.8
 * rad/s set by their id, rounded to a whole number of cycles per wrap of the
 * shader clock (TWINKLE_PERIOD * TWINKLE_SLOTS s), so the wrap never jumps a
 * shimmer's phase. The shader computes the same: fract(t * cycles / wrap).
 */
export function shimmerCycles(hw: number): number {
  return Math.round(((0.7 + 1.1 * hw) * TWINKLE_PERIOD * TWINKLE_SLOTS) / (2 * Math.PI));
}

/**
 * An aircraft crossing the sky: one every CROSSING_CYCLE s, taking
 * CROSSING_TIME s, then gone. `progress` 0..1 along its lane while visible.
 */
export const CROSSING_CYCLE = 220;
export const CROSSING_TIME = 120;
export function aircraft(t: number, seed = 1): { visible: boolean; progress: number; fadeIn: number; leftward: boolean } {
  const shifted = t + 20 + hash01(seed * 5 + 3) * 10;
  const slot = Math.floor(shifted / CROSSING_CYCLE);
  const u = shifted - slot * CROSSING_CYCLE;
  const leftward = hash01((seed * 131 + slot * 7) >>> 0) < 0.5;
  if (u > CROSSING_TIME) return { visible: false, progress: 0, fadeIn: 0, leftward };
  const progress = u / CROSSING_TIME;
  // Emerges from haze and recedes into it, rather than popping in at the lane's end.
  const fadeIn = smoothstep(0, 0.08, progress) * (1 - smoothstep(0.92, 1, progress));
  return { visible: true, progress, fadeIn, leftward };
}

/** The anti-collision beacon: on for 0.14 s every BEACON_PERIOD s, with soft 60 ms edges. 0..1. */
export const BEACON_PERIOD = 1.35;
export function beacon(t: number, seed = 1): number {
  const u = (t + hash01(seed * 11 + 2) * BEACON_PERIOD) % BEACON_PERIOD;
  return smoothstep(0, 0.06, u) * (1 - smoothstep(0.14, 0.2, u));
}
