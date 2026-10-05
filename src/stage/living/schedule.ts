/**
 * When and how hard the living rooms render: plain decisions, kept free of
 * the DOM so they can be tested (test/living-schedule.test.ts).
 *
 *   motionReduced   the system setting or the app's own reduced-motion
 *                   preference (the shell's data-reduced-motion) -> the room
 *                   stays the still plate, exactly as rendered.
 *   livingMode      still (reduced motion), paused (tab hidden, room off
 *                   screen), or live.
 *   frameBudget     frames per second and resolution: 30 fps and a smaller
 *                   pixel budget on phones and low-power devices, 60 fps
 *                   elsewhere; the device pixel ratio is capped either way
 *                   (the effects are slow and soft, so the canvas never needs
 *                   the display's full density to look right).
 *   backingSize     the canvas's drawing-buffer size for a CSS box.
 *   isDue           whether a frame is due at the device's frame rate.
 *   ambientFps      the rate for the ambient motion, slowed and then stopped
 *                   when nobody has touched the page for a while (the room
 *                   is a backdrop; it need not burn power for an empty chair).
 */

import { TWINKLE_PERIOD, TWINKLE_SLOTS } from './envelope.ts';

export interface DeviceHints {
  /** A phone-sized (coarse pointer, narrow) screen. */
  phone: boolean;
  /** Few cores, little memory, or data saver on. */
  lowPower: boolean;
  /** window.devicePixelRatio. */
  dpr: number;
}

export interface FrameBudget {
  fps: number;
  /** The highest device pixel ratio the canvas renders at. */
  dprCap: number;
  /** The most drawing-buffer pixels one canvas may have. */
  maxPixels: number;
}

export function frameBudget(d: DeviceHints): FrameBudget {
  if (d.phone) return { fps: 30, dprCap: d.lowPower ? 1.25 : 2, maxPixels: d.lowPower ? 900_000 : 1_600_000 };
  // Low power: one canvas pixel per CSS pixel (the room is soft, its motion slow; this is a third less
  // work than 1.25 and half of 1.5, on the machines that feel it).
  if (d.lowPower) return { fps: 30, dprCap: 1, maxPixels: 1_400_000 };
  return { fps: 60, dprCap: 1.5, maxPixels: 2_600_000 };
}

/** Whether a device should be treated as low power (hardwareConcurrency, deviceMemory, saveData). */
export function isLowPower(cores: number | undefined, memoryGb: number | undefined, saveData: boolean | undefined): boolean {
  return !!saveData || (cores !== undefined && cores > 0 && cores <= 4) || (memoryGb !== undefined && memoryGb > 0 && memoryGb <= 4);
}

/**
 * The drawing-buffer size for a CSS box, within the budget (never below 1 px).
 * `sourceDensity` is how many of the plate's own pixels fall on one CSS px:
 * drawing at a higher density than the picture has would only cost time.
 */
export function backingSize(
  cssW: number,
  cssH: number,
  dpr: number,
  budget: FrameBudget,
  sourceDensity = Infinity,
): { w: number; h: number; scale: number } {
  if (!(cssW > 0) || !(cssH > 0)) return { w: 1, h: 1, scale: 1 };
  let scale = Math.max(0.5, Math.min(budget.dprCap, dpr || 1, sourceDensity > 0 ? sourceDensity : Infinity));
  const pixels = cssW * cssH * scale * scale;
  if (pixels > budget.maxPixels) scale *= Math.sqrt(budget.maxPixels / pixels);
  return { w: Math.max(1, Math.round(cssW * scale)), h: Math.max(1, Math.round(cssH * scale)), scale };
}

/**
 * Whether a frame is due at `fps`, given the time of the last one drawn (ms).
 * A little early is fine (display refreshes jitter), so a 60 Hz display
 * drawing at 30 fps draws every other refresh rather than skipping two.
 */
export function isDue(now: number, last: number, fps: number): boolean {
  if (!(last > 0)) return true;
  return now - last >= 1000 / fps - 3;
}

/** Nobody has touched the page for this long: the ambient motion slows to IDLE_FPS. */
export const IDLE_SLOW_MS = 2 * 60_000;
/** ...and after this long it stops (the clock stands still; the next touch resumes it where it was). */
export const IDLE_STOP_MS = 10 * 60_000;
export const IDLE_FPS = 12;

/** The ambient frame rate for a room (`fps`, already within the device budget) after `idleMs` without input; 0 = stop. */
export function ambientFps(fps: number, idleMs: number): number {
  if (idleMs >= IDLE_STOP_MS) return 0;
  if (idleMs >= IDLE_SLOW_MS) return Math.min(fps, IDLE_FPS);
  return fps;
}

export function motionReduced(systemPrefersReduced: boolean, appAttribute: string | null | undefined): boolean {
  return systemPrefersReduced || appAttribute === 'true';
}

export type LivingMode = 'still' | 'paused' | 'live';

export function livingMode(s: { reducedMotion: boolean; hidden: boolean; onScreen: boolean }): LivingMode {
  if (s.reducedMotion) return 'still';
  if (s.hidden || !s.onScreen) return 'paused';
  return 'live';
}

/**
 * The room's own clock: seconds of *live* time, which stands still while the
 * room is paused or still, so it resumes where it left off rather than
 * jumping (a jump would snap every lamp and leaf at once). JavaScript uses
 * `total`; the shader gets `t`, wrapped where everything it drives from `t`
 * repeats (the twinkle's slot schedule, the shimmer's whole cycles), so its
 * float time keeps its precision without a visible seam.
 */
export const CLOCK_WRAP = TWINKLE_PERIOD * TWINKLE_SLOTS; // 7200 s: the twinkle schedule and every shimmer repeat on it
export class LivingClock {
  private seconds = 0;
  private last = 0;
  /** Seconds since the room went live (the effects ease in over the first few). */
  private since = 0;

  constructor(start = 0) {
    this.seconds = start;
  }

  /** Advance by the real time since the last tick (ms), capped so a long gap is not replayed. */
  tick(nowMs: number, running: boolean): number {
    const dt = this.last > 0 ? Math.min(0.1, Math.max(0, (nowMs - this.last) / 1000)) : 0;
    this.last = nowMs;
    if (running) {
      this.seconds += dt;
      this.since += dt;
    }
    return running ? dt : 0;
  }

  /** Forget the last tick (after a pause), so the next one does not count the gap. */
  rest(): void {
    this.last = 0;
  }

  /** Jump to a moment (captures): the effects count as fully eased in. */
  set(seconds: number): void {
    this.seconds = Math.max(0, seconds);
    this.since = Math.max(this.since, 10);
  }

  /** Live seconds, unwrapped (for the JavaScript envelopes). */
  get total(): number {
    return this.seconds;
  }

  /** Live seconds wrapped for the shader. */
  get t(): number {
    return this.seconds % CLOCK_WRAP;
  }

  /** 0 -> 1 over the first 2.5 s live: every effect starts from the plate as rendered. */
  get ramp(): number {
    const x = Math.min(1, this.since / 2.5);
    return x * x * (3 - 2 * x);
  }
}
