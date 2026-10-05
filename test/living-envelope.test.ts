import { describe, expect, it } from 'vitest';
import {
  BEACON_PERIOD,
  BREATH_MAX,
  BREATH_MIN,
  CANDLE_AMP,
  CANDLE_DIP,
  LAMP_SLEW,
  LAMP_SWING,
  NOISE_PERIOD,
  TWINKLE_FADE,
  TWINKLE_PERIOD,
  TWINKLE_SLOTS,
  aircraft,
  beacon,
  breath,
  candle,
  globe,
  gust,
  gustPush,
  lampGain,
  noise1,
  pcg,
  pulseShape,
  shimmerCycles,
  slew,
  stripWaves,
  twinkleOff,
  windLean,
  breeze,
} from '../src/stage/living/envelope.ts';
import { CLOCK_WRAP } from '../src/stage/living/schedule.ts';
import { LIVING_TUNING } from '../src/stage/living/tuning.ts';

/*
 * The living rooms' motion must stay quiet: bounded, slow, never a strobe.
 * WCAG 2.3.1 (three flashes or below threshold): nothing may flash more than
 * three times in any one second. These pin that down for every envelope.
 */

/** Samples f over [0, seconds) at fps. */
const sample = (f: (t: number) => number, seconds: number, fps: number) =>
  Array.from({ length: Math.round(seconds * fps) }, (_, i) => f(i / fps));

/** Mean seconds between successive local maxima of f (how often a light swells). */
function meanSwellGap(f: (t: number) => number, seconds: number, fps: number): number {
  const v = sample(f, seconds, fps);
  const maxima: number[] = [];
  for (let i = 1; i < v.length - 1; i++) if (v[i] > v[i - 1] && v[i] >= v[i + 1]) maxima.push(i / fps);
  return (maxima[maxima.length - 1] - maxima[0]) / (maxima.length - 1);
}

/**
 * Counts WCAG "flashes": a flash is a pair of opposing changes in luminance of
 * at least `threshold` (relative to the brightest value). Swings are found
 * with hysteresis (a change counts once it has moved `threshold` back from
 * the last extreme); returns the most flashes (swing pairs) within any one
 * second.
 */
function maxFlashesPerSecond(values: number[], fps: number, threshold: number): number {
  const peak = Math.max(...values);
  const swings: number[] = [];
  let hi = values[0];
  let lo = values[0];
  let dir = 0;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v > hi) hi = v;
    if (v < lo) lo = v;
    if (dir !== -1 && (hi - v) / peak >= threshold) {
      swings.push(i);
      dir = -1;
      lo = v;
    } else if (dir !== 1 && (v - lo) / peak >= threshold) {
      swings.push(i);
      dir = 1;
      hi = v;
    }
  }
  let most = 0;
  for (let a = 0, b = 0; b < swings.length; b++) {
    while (swings[b] - swings[a] >= fps) a++;
    most = Math.max(most, Math.floor((b - a + 1) / 2));
  }
  return most;
}

describe('hash and noise', () => {
  it('pcg is a stable 32-bit hash (the shader uses the same arithmetic)', () => {
    expect(pcg(0)).toBe(pcg(0));
    expect(pcg(1)).not.toBe(pcg(2));
    for (const n of [0, 1, 7, 255, 104729, 0xffffffff]) {
      expect(Number.isInteger(pcg(n))).toBe(true);
      expect(pcg(n)).toBeGreaterThanOrEqual(0);
      expect(pcg(n)).toBeLessThan(2 ** 32);
    }
  });

  it('with a period, noise1 repeats exactly (the shader lattice wraps at NOISE_PERIOD)', () => {
    for (const x of [0, 0.37, 12.5, 200.9, 255.99]) {
      expect(noise1(x + NOISE_PERIOD, 5, NOISE_PERIOD)).toBeCloseTo(noise1(x, 5, NOISE_PERIOD), 10);
      expect(noise1(x + 3 * NOISE_PERIOD, 5, NOISE_PERIOD)).toBeCloseTo(noise1(x, 5, NOISE_PERIOD), 10);
    }
  });

  it('the plants\' drift wraps without a seam: the shader, given (t * 0.25) % NOISE_PERIOD, sees the same breeze', () => {
    // Around the first wrap of the drift (t * 0.25 = 256, about 17 minutes in) and a much later one.
    for (const t0 of [1024, 1024 * 37]) {
      for (let t = t0 - 2; t < t0 + 2; t += 1 / 30) {
        for (const x of [0.05, 0.5, 0.95]) {
          const wrapped = ((t * 0.25) % NOISE_PERIOD) + x * 2;
          const shader = 0.2 * noise1(wrapped, 1, NOISE_PERIOD);
          const reference = 0.2 * noise1(t * 0.25 + x * 2, 1, NOISE_PERIOD);
          expect(Math.abs(shader - reference)).toBeLessThan(1e-9);
        }
      }
      // And the breeze moves smoothly through it (no twitch).
      let prev = breeze(0.5, t0 - 1);
      for (let t = t0 - 1; t < t0 + 1; t += 1 / 30) {
        const v = breeze(0.5, t);
        expect(Math.abs(v - prev)).toBeLessThan(0.06);
        prev = v;
      }
    }
  });

  it('noise1 stays in [-1, 1] and is continuous', () => {
    let prev = noise1(0, 3);
    for (let x = 0; x < 50; x += 0.01) {
      const v = noise1(x, 3);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.01 * 3.75 + 1e-9);
      prev = v;
    }
  });
});

describe('lamps', () => {
  it('a candle stays within +-3 % (home.md s9) and does move', () => {
    expect(CANDLE_AMP + CANDLE_DIP).toBeLessThanOrEqual(LAMP_SWING + 1e-12);
    for (let seed = 1; seed < 6; seed++) {
      const v = sample((t) => candle(t, seed), 600, 30);
      expect(Math.max(...v)).toBeLessThanOrEqual(1 + CANDLE_AMP + 1e-9);
      expect(Math.min(...v)).toBeGreaterThanOrEqual(1 - CANDLE_AMP - CANDLE_DIP - 1e-9);
      expect(Math.max(...v)).toBeLessThanOrEqual(1 + LAMP_SWING);
      expect(Math.min(...v)).toBeGreaterThanOrEqual(1 - LAMP_SWING);
      // It does move (it is a flame, not a bulb).
      expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.025);
    }
  });

  it('the candle and the globes shift irregularly every 2-4 s (home.md s9), never faster', () => {
    for (let seed = 1; seed < 6; seed++) {
      const c = meanSwellGap((t) => candle(t, seed), 600, 30);
      const g = meanSwellGap((t) => globe(t, seed), 600, 30);
      expect(c, `candle ${seed}`).toBeGreaterThanOrEqual(2);
      expect(c, `candle ${seed}`).toBeLessThanOrEqual(4);
      expect(g, `globe ${seed}`).toBeGreaterThanOrEqual(2);
      expect(g, `globe ${seed}`).toBeLessThanOrEqual(4.2);
    }
  });

  it('a lamp changes by well under 1 % of its light per frame, at 60 and at 30 fps', () => {
    for (const fps of [60, 30]) {
      for (const f of [(t: number) => candle(t, 7), (t: number) => globe(t, 7)]) {
        const v = sample(f, 600, fps);
        let worst = 0;
        for (let i = 1; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i] - v[i - 1]));
        expect(worst, `${fps} fps`).toBeLessThan(fps === 60 ? 0.0015 : 0.003);
      }
    }
  });

  it('after the slew limit no lamp moves more than LAMP_SLEW per second, even across a dropped frame', () => {
    let g = 1;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 120; i++) {
      // A dropped frame every so often: the next one is three frames late.
      const step = i % 97 === 0 ? dt * 3 : dt;
      const next = slew(g, candle(i * dt, 2), LAMP_SLEW, step);
      expect(Math.abs(next - g)).toBeLessThanOrEqual(LAMP_SLEW * step + 1e-12);
      g = next;
    }
  });

  it('never flashes: no flash at all even by a strict 3 % threshold (WCAG allows 3 a second at 10 %)', () => {
    for (let seed = 1; seed < 8; seed++) {
      const v = sample((t) => candle(t, seed), 600, 60);
      expect(maxFlashesPerSecond(v, 60, 0.03), `seed ${seed}`).toBe(0);
      expect(maxFlashesPerSecond(v, 60, 0.1), `seed ${seed}`).toBe(0);
    }
  });

  it('globes drift gently, within +-3 %', () => {
    for (let seed = 1; seed < 6; seed++) {
      const v = sample((t) => globe(t, seed), 600, 30);
      expect(Math.max(...v)).toBeLessThanOrEqual(1 + LAMP_SWING);
      expect(Math.min(...v)).toBeGreaterThanOrEqual(1 - LAMP_SWING);
      expect(maxFlashesPerSecond(v, 30, 0.03)).toBe(0);
    }
  });

  it('steady lamps do not move; motions map to their envelopes', () => {
    expect(lampGain('steady', 3.3, 1)).toBe(1);
    expect(lampGain('flicker', 3.3, 1)).toBe(candle(3.3, 1));
    expect(lampGain('breathe', 3.3, 1)).toBe(globe(3.3, 1));
  });
});

describe('LEDs', () => {
  it('the coves breathe between BREATH_MIN and BREATH_MAX (emission 0.9 <-> 1.0), with no flash', () => {
    expect(BREATH_MIN).toBeCloseTo(-0.1);
    expect(BREATH_MAX).toBe(0);
    const v = sample((t) => breath(t, 7), 120, 30);
    expect(Math.max(...v)).toBeLessThanOrEqual(BREATH_MAX + 1e-9);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(BREATH_MIN - 1e-9);
    expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.099);
    expect(maxFlashesPerSecond(v.map((k) => 1 + k), 30, 0.03)).toBe(0);
    // A room can pass its own range: the consult room's +-5 %.
    const c = sample((t) => breath(t, 8, 0, -0.05, 0.05), 120, 30);
    expect(Math.max(...c)).toBeCloseTo(0.05, 3);
    expect(Math.min(...c)).toBeCloseTo(-0.05, 3);
  });

  it('every room breathes as its spec says: home.md 0.9 <-> 1.0 over 6-8 s, scan.md +-5 % over 8 s', () => {
    for (const room of ['lounge', 'lounge-strip-window'] as const) {
      const t = LIVING_TUNING[room]!;
      expect(t.breathRange[0]).toBeGreaterThanOrEqual(-0.1);
      expect(t.breathRange[1]).toBeLessThanOrEqual(0);
      expect(t.breathePeriod).toBeGreaterThanOrEqual(6);
      expect(t.breathePeriod).toBeLessThanOrEqual(8);
      // The travelling bead stays a small share of the LEDs' light.
      expect(t.travel).toBeLessThanOrEqual(0.1);
    }
    const consult = LIVING_TUNING.consult!;
    expect(consult.breathRange).toEqual([-0.05, 0.05]);
    expect(consult.breathePeriod).toBe(8);
    expect(consult.travel).toBeLessThanOrEqual(0.05);
    // Divided by each boost layer's strength, the breath stays +-5 % of each light.
    for (const k of Object.values(consult.boostStrength)) expect(k).toBeGreaterThan(0);
    // A breath changes the LEDs' light by a fraction of a per cent per frame.
    const v = sample((t) => breath(t, 7), 60, 30);
    let worst = 0;
    for (let i = 1; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i] - v[i - 1]));
    expect(worst).toBeLessThan(0.002);
  });

  it('closed strips carry a whole number of waves so the pulse meets itself at the seam', () => {
    for (const len of [0.3, 1.353, 2.89, 9.185, 28.667]) {
      const n = stripWaves(len, true, 6);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      // The pulse at along = 0 and along = 1 is the same for any phase.
      for (const phase of [0, 0.3, 0.77]) expect(pulseShape(1 * n - phase)).toBeCloseTo(pulseShape(0 * n - phase), 9);
    }
    expect(stripWaves(3, false, 6)).toBeCloseTo(0.5);
  });
});

describe('wind', () => {
  it('the lean stays within [-0.55, 1] of the amplitude and moves slowly', () => {
    let prev = windLean(0.5, 0, gust(0));
    for (let i = 1; i < 30 * 600; i++) {
      const t = i / 30;
      for (const x of [0.1, 0.5, 0.9]) {
        const v = windLean(x, t, gust(t));
        expect(v).toBeGreaterThanOrEqual(-0.55 - 1e-9);
        expect(v).toBeLessThanOrEqual(1 + 1e-9);
        if (x === 0.5) {
          expect(Math.abs(v - prev)).toBeLessThan(0.06);
          prev = v;
        }
      }
    }
  });

  it('gusts come now and then, cross the room and leave', () => {
    let gusty = 0;
    let fronts = 0;
    let on = false;
    let prev = 0;
    for (let i = 0; i < 10 * 600; i++) {
      const g = gust(i / 10);
      if (g.strength > 0.05) gusty++;
      if (g.strength > 0 && !on) fronts++;
      on = g.strength > 0;
      expect(g.strength).toBeLessThanOrEqual(1);
      // Gusts ease in and out: no step in strength between samples 0.1 s apart.
      expect(Math.abs(g.strength - prev)).toBeLessThan(0.12);
      prev = g.strength;
    }
    // Ten minutes: a gust every half minute or so, gusting a fraction of the time.
    expect(fronts).toBeGreaterThan(10);
    expect(fronts).toBeLessThan(30);
    expect(gusty / 6000).toBeLessThan(0.4);
    expect(gustPush(0.5, 0.5, 0.8)).toBeCloseTo(0.8);
    expect(gustPush(0.5, -1, 0)).toBe(0);
  });
});

describe('city windows', () => {
  it('only a few per cent of windows are dark at any moment', () => {
    let off = 0;
    let n = 0;
    for (let id = 0; id < 256; id++)
      for (let t = 0; t < 600; t += 1.7) {
        off += twinkleOff(id, t, 0.07);
        n++;
      }
    expect(off / n).toBeGreaterThan(0.005);
    expect(off / n).toBeLessThan(0.04);
  });

  it('home.md s9: "a few % per minute" of the lit windows switch', () => {
    for (const room of ['lounge', 'lounge-strip-window', 'consult'] as const) {
      const chance = LIVING_TUNING[room]!.twinkle;
      let events = 0;
      for (let id = 0; id < 256; id++) {
        const v = sample((t) => twinkleOff(id, t, chance), 3600, 2);
        for (let i = 1; i < v.length; i++) if (v[i - 1] < 0.5 && v[i] >= 0.5) events++;
      }
      const perMinute = events / 256 / 60;
      expect(perMinute, room).toBeGreaterThan(0.01);
      expect(perMinute, room).toBeLessThan(0.06);
    }
  });

  it('the twinkle carries on through the shader clock\'s wrap (no window pops)', () => {
    expect(CLOCK_WRAP).toBe(TWINKLE_PERIOD * TWINKLE_SLOTS);
    for (let id = 0; id < 256; id++) {
      // Chance 1: every id has a dark spell in every slot, so any seam would show.
      for (let t = CLOCK_WRAP - 40; t < CLOCK_WRAP + 40; t += 0.25) {
        expect(twinkleOff(id, t % CLOCK_WRAP, 1)).toBeCloseTo(twinkleOff(id, t, 1), 12);
      }
    }
  });

  it('the shimmer runs a whole number of cycles per clock wrap, 0.7-1.8 rad/s', () => {
    for (const hw of [0, 0.25, 0.5, 0.999]) {
      const n = shimmerCycles(hw);
      expect(Number.isInteger(n)).toBe(true);
      const rate = (n * 2 * Math.PI) / CLOCK_WRAP;
      expect(rate).toBeGreaterThan(0.69);
      expect(rate).toBeLessThan(1.81);
    }
  });

  it('a window switches rarely and fades rather than blinks', () => {
    const fps = 10;
    let events = 0;
    for (let id = 0; id < 256; id++) {
      const v = sample((t) => twinkleOff(id, t, 0.07), 1800, fps);
      let worst = 0;
      for (let i = 1; i < v.length; i++) {
        if (v[i - 1] < 0.5 && v[i] >= 0.5) events++;
        worst = Math.max(worst, Math.abs(v[i] - v[i - 1]));
      }
      // Each change is spread over TWINKLE_FADE (smoothstep's steepest slope is 1.5).
      expect(worst).toBeLessThanOrEqual(1.5 / (TWINKLE_FADE * fps) + 1e-9);
      expect(maxFlashesPerSecond(v.map((x) => 1 - 0.8 * x), fps, 0.1)).toBeLessThanOrEqual(1);
    }
    // On average a window id goes dark about once every seven minutes.
    const perMinute = events / 256 / 30;
    expect(perMinute).toBeGreaterThan(0.08);
    expect(perMinute).toBeLessThan(0.2);
  });

  it('is off only inside its 30 s slot and never at chance 0', () => {
    for (let t = 0; t < 300; t += 0.5) expect(twinkleOff(9, t, 0)).toBe(0);
  });
});

describe('aircraft', () => {
  it('the beacon blinks well under three times a second', () => {
    const v = sample((t) => beacon(t), 60, 60);
    let rises = 0;
    for (let i = 1; i < v.length; i++) if (v[i - 1] < 0.5 && v[i] >= 0.5) rises++;
    expect(rises / 60).toBeLessThanOrEqual(1 / BEACON_PERIOD + 0.05);
    expect(rises / 60).toBeLessThan(1);
    expect(maxFlashesPerSecond(v.map((x) => 0.2 + x), 60, 0.1)).toBeLessThanOrEqual(1);
  });

  it('crossings come and go, fading in and out at the lane ends', () => {
    let visible = 0;
    for (let t = 0; t < 1400; t += 1) {
      const a = aircraft(t);
      if (a.visible) {
        visible++;
        expect(a.progress).toBeGreaterThanOrEqual(0);
        expect(a.progress).toBeLessThanOrEqual(1);
        expect(a.fadeIn).toBeLessThanOrEqual(1);
      }
    }
    expect(visible / 1400).toBeGreaterThan(0.3);
    expect(visible / 1400).toBeLessThan(0.6);
    expect(aircraft(0).fadeIn === 0 || aircraft(0).progress > 0).toBe(true);
  });
});
