import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The viewer input for the rooms' parallax (src/stage/living/input.ts): tilt
 * never raises a permission prompt by itself, iOS asks only through
 * requestTilt() (Profile's switch), a refusal is not asked again, and a
 * granted tilt survives the rooms mounting and unmounting.
 */

type Listener = (event: unknown) => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string, event: unknown = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

let win: ReturnType<typeof fakeTarget> & Record<string, unknown>;
let doc: ReturnType<typeof fakeTarget>;
let requestPermission: ReturnType<typeof vi.fn> | undefined;

function setup(opts: { ios: boolean; answer?: 'granted' | 'denied' | 'throws' }) {
  vi.resetModules();
  win = Object.assign(fakeTarget(), {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: (q: string) => ({ matches: q.includes('coarse') }),
  });
  doc = fakeTarget();
  requestPermission = opts.ios
    ? vi.fn(async () => {
        if (opts.answer === 'throws') throw new Error('NotAllowedError');
        return opts.answer ?? 'granted';
      })
    : undefined;
  class FakeOrientationEvent {}
  if (requestPermission) (FakeOrientationEvent as unknown as { requestPermission: unknown }).requestPermission = requestPermission;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('DeviceOrientationEvent', FakeOrientationEvent);
  return import('../src/stage/living/input.ts');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tilt on iOS (a permission prompt)', () => {
  it('never prompts by itself: mounting a room and touching the screen do not ask', async () => {
    const input = await setup({ ios: true });
    const release = input.useViewer();
    win.fire('touchend');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(win.count('deviceorientation')).toBe(0);
    expect(input.tiltEnabled()).toBe(false);
    release();
  });

  it('asks from requestTilt; granted, the room follows the tilt', async () => {
    const input = await setup({ ios: true, answer: 'granted' });
    const release = input.useViewer();
    await expect(input.requestTilt()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(win.count('deviceorientation')).toBe(1);
    // The first reading is "straight on"; tilting right 9 degrees moves the viewer about half way.
    win.fire('deviceorientation', { beta: 40, gamma: 0 });
    win.fire('deviceorientation', { beta: 40, gamma: 9 });
    const v = input.viewer();
    expect(v.x).toBeGreaterThan(0.45);
    expect(v.x).toBeLessThanOrEqual(0.5);
    expect(Math.abs(v.y)).toBeLessThan(1e-9);
    // Asking again does not prompt again.
    await expect(input.requestTilt()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    release();
    expect(win.count('deviceorientation')).toBe(0);
  });

  it('a refusal (or a prompt that cannot show) is remembered and never asked again', async () => {
    for (const answer of ['denied', 'throws'] as const) {
      const input = await setup({ ios: true, answer });
      input.useViewer();
      await expect(input.requestTilt()).resolves.toBe(false);
      await expect(input.requestTilt()).resolves.toBe(false);
      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(input.tiltRefused()).toBe(true);
      expect(input.tiltEnabled()).toBe(false);
      expect(win.count('deviceorientation')).toBe(0);
    }
  });

  it('a grant outlives the rooms: listening stops with the last room and resumes with the next', async () => {
    const input = await setup({ ios: true, answer: 'granted' });
    // Granted from Profile, where no room follows the viewer: nothing listens yet.
    await expect(input.requestTilt()).resolves.toBe(true);
    expect(win.count('deviceorientation')).toBe(0);
    const a = input.useViewer();
    expect(win.count('deviceorientation')).toBe(1);
    a();
    expect(win.count('deviceorientation')).toBe(0);
    const b = input.useViewer();
    expect(win.count('deviceorientation')).toBe(1);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    b();
  });
});

describe('tilt without a prompt (Android and others)', () => {
  it('starts on the first touch, and stopTilt turns it off for the visit', async () => {
    const input = await setup({ ios: false });
    const release = input.useViewer();
    expect(win.count('deviceorientation')).toBe(0);
    win.fire('touchend');
    expect(win.count('deviceorientation')).toBe(1);
    expect(input.tiltEnabled()).toBe(true);
    win.fire('deviceorientation', { beta: 30, gamma: 2 });
    win.fire('deviceorientation', { beta: 30, gamma: -16 });
    expect(input.viewer().x).toBeLessThan(-0.8);
    input.stopTilt();
    expect(win.count('deviceorientation')).toBe(0);
    expect(input.viewer()).toEqual({ x: 0, y: 0 });
    // Turned off: a later touch (or a new room) does not start it again.
    release();
    const again = input.useViewer();
    win.fire('touchend');
    expect(win.count('deviceorientation')).toBe(0);
    // Turned back on from the switch.
    await expect(input.requestTilt()).resolves.toBe(true);
    expect(win.count('deviceorientation')).toBe(1);
    again();
  });

  it('the pointer drives the viewer on desktop; touch pointers are ignored', async () => {
    const input = await setup({ ios: false });
    const release = input.useViewer();
    win.fire('pointermove', { pointerType: 'mouse', clientX: 390, clientY: 0 });
    expect(input.viewer()).toEqual({ x: 1, y: -1 });
    win.fire('pointermove', { pointerType: 'touch', clientX: 0, clientY: 844 });
    expect(input.viewer()).toEqual({ x: 1, y: -1 });
    release();
    expect(input.viewer()).toEqual({ x: 0, y: 0 });
    expect(win.count('pointermove')).toBe(0);
  });
});

describe('tilt in screen terms', () => {
  it('maps the device tilt to the screen for each way it can be turned', async () => {
    const input = await setup({ ios: false });
    // Upright: tilting right (gamma) moves x, tipping the top back (beta) moves y.
    expect(input.tiltToScreen(10, 4, 0)).toEqual({ x: 4, y: 10 });
    // Turned a quarter left (90): the screen's right edge is the device's bottom, its bottom edge the device's left.
    expect(input.tiltToScreen(10, 4, 90)).toEqual({ x: 10, y: -4 });
    // A quarter right (270): the opposite, so the two landscapes move the room the same way on screen.
    expect(input.tiltToScreen(10, 4, 270)).toEqual({ x: -10, y: 4 });
    expect(input.tiltToScreen(10, 4, 180)).toEqual({ x: -4, y: -10 });
  });

  it('reads the screen angle from screen.orientation, else iOS window.orientation, else the window shape', async () => {
    const input = await setup({ ios: true });
    expect(input.screenAngle()).toBe(0);
    win.orientation = -90;
    expect(input.screenAngle()).toBe(270);
    vi.stubGlobal('screen', { orientation: { angle: 90 } });
    expect(input.screenAngle()).toBe(90);
    vi.stubGlobal('screen', {});
    delete win.orientation;
    win.innerWidth = 844;
    win.innerHeight = 390;
    expect(input.screenAngle()).toBe(90);
  });

  it('in landscape the room follows the screen, and turning the phone starts from the new hold', async () => {
    const input = await setup({ ios: false });
    const release = input.useViewer();
    win.fire('touchend');
    win.orientation = 90;
    // Held in landscape (turned left): dipping the screen's right edge raises the device's top (beta up).
    win.fire('deviceorientation', { beta: 5, gamma: -60 });
    win.fire('deviceorientation', { beta: 14, gamma: -60 });
    expect(input.viewer().x).toBeGreaterThan(0.45);
    // Turned the other way: the same physical dip now reads as beta down; after the turn it starts afresh.
    win.orientation = -90;
    win.fire('deviceorientation', { beta: -5, gamma: 60 });
    expect(Math.abs(input.viewer().x)).toBeLessThan(1e-9);
    win.fire('deviceorientation', { beta: -14, gamma: 60 });
    expect(input.viewer().x).toBeGreaterThan(0.45);
    release();
  });
});
