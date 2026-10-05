import { describe, expect, it } from 'vitest';
import {
  CLOCK_WRAP,
  IDLE_FPS,
  IDLE_SLOW_MS,
  IDLE_STOP_MS,
  LivingClock,
  ambientFps,
  backingSize,
  frameBudget,
  isDue,
  isLowPower,
  livingMode,
  motionReduced,
} from '../src/stage/living/schedule.ts';
import { TWINKLE_PERIOD } from '../src/stage/living/envelope.ts';

describe('reduced motion', () => {
  it('either the system setting or the app preference keeps the room still', () => {
    expect(motionReduced(false, null)).toBe(false);
    expect(motionReduced(false, 'false')).toBe(false);
    expect(motionReduced(true, null)).toBe(true);
    expect(motionReduced(false, 'true')).toBe(true);
  });

  it('still wins over everything; hidden or off screen pauses; otherwise live', () => {
    expect(livingMode({ reducedMotion: true, hidden: false, onScreen: true })).toBe('still');
    expect(livingMode({ reducedMotion: true, hidden: true, onScreen: false })).toBe('still');
    expect(livingMode({ reducedMotion: false, hidden: true, onScreen: true })).toBe('paused');
    expect(livingMode({ reducedMotion: false, hidden: false, onScreen: false })).toBe('paused');
    expect(livingMode({ reducedMotion: false, hidden: false, onScreen: true })).toBe('live');
  });
});

describe('frame budget', () => {
  it('phones and low-power devices draw at 30 fps, others at 60', () => {
    expect(frameBudget({ phone: true, lowPower: false, dpr: 3 }).fps).toBe(30);
    expect(frameBudget({ phone: false, lowPower: true, dpr: 2 }).fps).toBe(30);
    expect(frameBudget({ phone: false, lowPower: false, dpr: 2 }).fps).toBe(60);
  });

  it('low power: data saver, four cores or fewer, four GB or less', () => {
    expect(isLowPower(8, 8, false)).toBe(false);
    expect(isLowPower(undefined, undefined, undefined)).toBe(false);
    expect(isLowPower(8, 8, true)).toBe(true);
    expect(isLowPower(2, 8, false)).toBe(true);
    expect(isLowPower(8, 2, false)).toBe(true);
  });

  it('caps the device pixel ratio and the pixel count, and never exceeds the picture’s own density', () => {
    const desk = frameBudget({ phone: false, lowPower: false, dpr: 2 });
    const a = backingSize(800, 600, 2, desk);
    expect(a.scale).toBeLessThanOrEqual(desk.dprCap);
    expect(a.w).toBe(Math.round(800 * a.scale));
    const big = backingSize(2560, 1440, 2, desk);
    expect(big.w * big.h).toBeLessThanOrEqual(desk.maxPixels * 1.01);
    const phone = frameBudget({ phone: true, lowPower: false, dpr: 3 });
    const p = backingSize(390, 844, 3, phone);
    expect(p.scale).toBeLessThanOrEqual(2);
    expect(p.w * p.h).toBeLessThanOrEqual(phone.maxPixels * 1.01);
    // A 320 px strip drawn 320 CSS px wide gains nothing from a 2x canvas.
    expect(backingSize(248, 1000, 2, desk, 1.05).scale).toBeCloseTo(1.05);
    expect(backingSize(0, 100, 2, desk)).toEqual({ w: 1, h: 1, scale: 1 });
  });

  it('low-power desktops draw one canvas pixel per CSS pixel', () => {
    const low = frameBudget({ phone: false, lowPower: true, dpr: 2 });
    expect(low.dprCap).toBe(1);
    expect(backingSize(1280, 800, 2, low).scale).toBe(1);
    expect(frameBudget({ phone: true, lowPower: true, dpr: 3 }).dprCap).toBeLessThanOrEqual(1.25);
  });

  it('nobody touching the page: the ambient motion slows after two minutes and stops after ten', () => {
    expect(ambientFps(30, 0)).toBe(30);
    expect(ambientFps(15, 60_000)).toBe(15);
    expect(ambientFps(30, IDLE_SLOW_MS)).toBe(IDLE_FPS);
    expect(ambientFps(8, IDLE_SLOW_MS + 1)).toBe(8);
    expect(ambientFps(30, IDLE_STOP_MS - 1)).toBe(IDLE_FPS);
    expect(ambientFps(30, IDLE_STOP_MS)).toBe(0);
    expect(IDLE_SLOW_MS).toBeLessThan(IDLE_STOP_MS);
  });

  it('draws every other 60 Hz refresh at 30 fps, and at once after a pause', () => {
    expect(isDue(1000, 0, 30)).toBe(true);
    expect(isDue(1016.7, 1000, 30)).toBe(false);
    expect(isDue(1033.4, 1000, 30)).toBe(true);
    expect(isDue(1016.7, 1000, 60)).toBe(true);
  });
});

describe('the room clock', () => {
  it('counts live time only, resumes without a jump, and eases the effects in', () => {
    const c = new LivingClock(0);
    c.tick(1000, true);
    for (let t = 1000; t <= 2000; t += 33) c.tick(t, true);
    expect(c.total).toBeCloseTo(0.99, 1);
    expect(c.ramp).toBeGreaterThan(0);
    expect(c.ramp).toBeLessThan(1);
    // Paused for a minute (still or hidden): no time passes.
    c.tick(62_000, false);
    c.rest();
    c.tick(62_033, true);
    expect(c.total).toBeCloseTo(0.99, 1);
    c.tick(62_066, true);
    expect(c.total).toBeCloseTo(1.023, 2);
    // A long stall is not replayed: one tick moves at most 0.1 s.
    c.tick(70_000, true);
    expect(c.total).toBeLessThan(1.2);
    for (let t = 70_000; t < 74_000; t += 33) c.tick(t, true);
    expect(c.ramp).toBe(1);
  });

  it('wraps the shader time on a whole number of twinkle slots', () => {
    expect(CLOCK_WRAP % TWINKLE_PERIOD).toBe(0);
    const c = new LivingClock(0);
    c.set(CLOCK_WRAP + 12.5);
    expect(c.t).toBeCloseTo(12.5);
    expect(c.total).toBeCloseTo(CLOCK_WRAP + 12.5);
    expect(c.ramp).toBe(1);
  });
});
