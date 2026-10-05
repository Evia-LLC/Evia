import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAnchors, parseLiving, type RoomId } from '../src/stage/room-anchors.ts';
import {
  PARALLAX_MAX,
  depthAt,
  layerUrl,
  parallaxFactor,
  pickWidth,
  planLiving,
  pxAt,
  sameRegion,
  skyLane,
  visibleRegion,
} from '../src/stage/living/scene.ts';
import { fragmentSource } from '../src/stage/living/shader.ts';
import { tuningFor } from '../src/stage/living/tuning.ts';
import { twinkleOff } from '../src/stage/living/envelope.ts';

const published = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../public/env/${file}`, import.meta.url), 'utf8'));

const ROOMS: [RoomId, string][] = [
  ['lounge', 'lounge/anchors.json'],
  ['lounge', 'lounge/anchors-mobile.json'],
  ['lounge-strip-window', 'lounge-strip-window/anchors.json'],
  ['products-hero', 'products-hero/anchors.json'],
  ['consult', 'consult/anchors.json'],
  ['consult', 'consult/anchors-mobile.json'],
];

const resolve = (room: RoomId) => (src: string) => (src.startsWith('/') ? src : `/env/${room}/${src}`);

describe('parseLiving (the published anchors)', () => {
  it.each(ROOMS)('%s %s: masks, lights, strips and plants read defensively', (room, file) => {
    const raw = published(file);
    const living = parseAnchors(raw)?.living;
    expect(living, file).toBeTruthy();
    expect(living!.masks.plants?.widths.length).toBeGreaterThan(0);
    expect(living!.depthRange?.[0]).toBeCloseTo(0.5);
    expect(living!.depthRange![1]).toBeGreaterThan(10);
    for (const l of living!.lights) {
      expect(l.id).toBeGreaterThanOrEqual(1);
      expect(l.id).toBeLessThanOrEqual(255);
    }
    for (const s of living!.strips) expect(s.lengthM).toBeGreaterThan(0);
    if (room === 'consult') {
      expect(living!.boosts.neon?.widths.length).toBeGreaterThan(0);
      expect(living!.boosts.emitter?.src).toMatch(/glow-emitter-\d+\.webp$/);
    }
  });

  it('drops anything unsafe or malformed, and is null without masks', () => {
    const living = parseLiving({
      masks: {
        plants: { src: '../../etc/passwd-10.webp', widths: [10] },
        sky: { src: 'https://evil.example/x-10.webp' },
        glass: { src: 'ok-640.webp', widths: [640, 'x', -1] },
        depth: { src: 'd-320.webp', note: '0 = 0.5 m .. 1 = 30.5 m' },
      },
      lights: [{ id: 0, cx: 0.5, cy: 0.5 }, { id: 3, cx: 0.5, cy: 'x' }, { id: 4, cx: 0.1, cy: 0.2, motion: 'flicker' }],
      strips: [{ id: 2, lengthM: 0 }, { id: 5, lengthM: 3 }],
      plants: [{ id: 7, base: [0, 1], tip: [0, 0.5] }, { id: 300, base: [0, 1], tip: [0, 0] }],
    });
    expect(living).not.toBeNull();
    expect(living!.masks.plants).toBeUndefined();
    expect(living!.masks.sky).toBeUndefined();
    expect(living!.masks.glass?.widths).toEqual([640]);
    expect(living!.depthRange).toEqual([0.5, 30.5]);
    expect(living!.lights.map((l) => l.id)).toEqual([4]);
    expect(living!.strips.map((s) => s.id)).toEqual([5]);
    expect(living!.plants.map((p) => p.id)).toEqual([7]);
    expect(parseLiving({ lights: [{ id: 1, cx: 0, cy: 0 }] })).toBeNull();
  });
});

describe('planLiving', () => {
  it.each(ROOMS)('%s %s: a plan with its masks at their smallest width, all on one grid', (room, file) => {
    const anchors = parseAnchors(published(file))!;
    const plan = planLiving({ living: anchors.living!, tuning: tuningFor(room)!, plateUrl: '/env/x/plate.webp', resolve: resolve(room) })!;
    expect(plan).not.toBeNull();
    expect(plan.textures[0]).toMatchObject({ key: 'plate', url: '/env/x/plate.webp' });
    const data = plan.textures.filter((t) => t.kind === 'data' && t.key !== 'depth');
    expect(data.length).toBeGreaterThan(0);
    for (const t of data) {
      expect(t.width).toBe(plan.maskWidth);
      expect(t.url).toMatch(new RegExp(`-${plan.maskWidth}\\.webp$`));
      expect(t.url.startsWith('/env/')).toBe(true);
    }
    // Sway stays inside the feather zone, so a leaf's edge never tears.
    const feather = pxAt(anchors.living!.masks.plants?.featherPxAt, plan.maskWidth, 4);
    expect(plan.swayPx).toBeLessThan(feather);
    expect(plan.features.plants).toBe(true);
    // Every compiled shader variant is well formed (balanced #ifdefs).
    const src = fragmentSource(plan.features);
    expect((src.match(/#if/g) ?? []).length).toBe((src.match(/#endif/g) ?? []).length);
  });

  it('turns the right things on per room', () => {
    const plan = (room: RoomId, file: string) =>
      planLiving({ living: parseAnchors(published(file))!.living!, tuning: tuningFor(room)!, plateUrl: 'p', resolve: resolve(room) })!;
    const home = plan('lounge', 'lounge/anchors.json');
    expect(home.features).toMatchObject({ lamps: true, glow: true, travel: true, windows: true, sky: true, parallax: 'depth', aircraft: true });
    const consult = plan('consult', 'consult/anchors.json');
    // The Scan page places the hologram, the character and the wall text on this plate: only the view outside moves.
    expect(consult.features).toMatchObject({ boosts: true, emitter: true, haze: true, parallax: 'glass', lamps: false });
    const hero = plan('products-hero', 'products-hero/anchors.json');
    expect(hero.features).toMatchObject({ plants: true, lamps: true, windows: false, glow: false, parallax: 'depth' });
    const strip = plan('lounge-strip-window', 'lounge-strip-window/anchors.json');
    expect(strip.features.parallax).toBe('none');
    expect(strip.maskWidth).toBe(320);
  });

  it('a room with nothing to animate has no plan', () => {
    expect(
      planLiving({
        living: { masks: {}, boosts: {}, lights: [], strips: [], plants: [], depthRange: null },
        tuning: tuningFor('lounge')!,
        plateUrl: 'p',
        resolve: (s) => s,
      }),
    ).toBeNull();
  });
});

describe('small helpers', () => {
  it('pickWidth and layerUrl', () => {
    expect(pickWidth([1280, 2560], 1000)).toBe(1280);
    expect(pickWidth([1280, 2560], 2000)).toBe(2560);
    expect(pickWidth([1280, 2560], 4000)).toBe(2560);
    expect(layerUrl({ src: 'home-mask-sky-2560.webp', widths: [1280, 2560] }, 1280, (s) => `/env/lounge/${s}`)).toBe(
      '/env/lounge/home-mask-sky-1280.webp',
    );
    expect(pxAt({ 2560: 10, 1280: 5 }, 1280, 0)).toBe(5);
    expect(pxAt({ 2560: 10 }, 1280, 0)).toBe(5);
  });

  it('skyLane finds a lane in the upper sky, inside it', () => {
    const w = 40;
    const h = 20;
    const rgba = new Uint8Array(w * h * 4);
    // Sky from row 4 to row 12, columns 5..34.
    for (let y = 4; y <= 12; y++) for (let x = 5; x <= 34; x++) rgba[(y * w + x) * 4] = 255;
    const lane = skyLane(rgba, w, h)!;
    expect(lane.y).toBeGreaterThan(4 / h);
    expect(lane.y).toBeLessThan(10 / h);
    expect(lane.x0).toBeCloseTo(5 / w);
    expect(lane.x1).toBeCloseTo(35 / w);
    expect(skyLane(new Uint8Array(w * h * 4), w, h)).toBeNull();
  });

  it('parallax: still at the focus, full at the near depth, a little the other way far off', () => {
    expect(parallaxFactor(8, 8, 2.5)).toBeCloseTo(0);
    expect(parallaxFactor(2.5, 8, 2.5)).toBeCloseTo(1);
    expect(parallaxFactor(30, 8, 2.5)).toBeLessThan(0);
    expect(parallaxFactor(30, 8, 2.5)).toBeGreaterThan(-0.5);
    expect(parallaxFactor(0.1, 8, 2.5)).toBe(1);
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(depthAt(rgba, 2, 1, [0.9, 0.5], [0.5, 30.5])).toBeCloseTo(30.5);
    expect(depthAt(rgba, 2, 1, [0.1, 0.5], [0.5, 30.5])).toBeCloseTo(0.5);
  });

  it('the shader twinkle is the reference twinkle (same constants in both)', () => {
    const src = fragmentSource({
      plants: false,
      lamps: false,
      glow: false,
      travel: false,
      windows: true,
      sky: false,
      haze: false,
      boosts: false,
      emitter: false,
      parallax: 'none',
      aircraft: false,
    });
    expect(src).toContain('const float P = 30.0;');
    expect(src).toContain('const float F = 0.45;');
    // The slot key repeats every TWINKLE_SLOTS slots, the clock's wrap (envelope.ts twinkleOff).
    expect(src).toContain('uint key = id * 7919u + uint(mod(slot, 240.0)) * 104729u;');
    expect(src).toContain('key ^ 0x9e3779b9u');
    expect(twinkleOff(5, 12, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe('motion specs per room', () => {
  it.each(ROOMS)('%s %s: depth layers part by 4 px at most (home.md s9: 2-4 px)', (room, file) => {
    const anchors = parseAnchors(published(file))!;
    const t = tuningFor(room)!;
    if (t.parallax !== 'depth' || !anchors.living?.depthRange) return;
    const [, far] = anchors.living.depthRange;
    const spread = t.parallaxPx * (PARALLAX_MAX - parallaxFactor(far, t.focusM, t.nearM));
    expect(spread).toBeLessThanOrEqual(4.01);
    expect(t.parallaxPx * PARALLAX_MAX).toBeGreaterThanOrEqual(2);
  });

  it('every compiled shader keeps its noise periodic, its dither fixed and its parallax within the clamp', () => {
    const src = fragmentSource({
      plants: true,
      lamps: true,
      glow: true,
      travel: true,
      windows: true,
      sky: true,
      haze: true,
      boosts: true,
      emitter: true,
      parallax: 'depth',
      aircraft: true,
    });
    expect(src).toContain('const float NP = 256.0;');
    expect(src).toContain('mod(i, NP)');
    expect(src).toContain('p = p * 2.0 + vec2(17.1, 9.3);');
    expect(src).not.toMatch(/uint\(uT \* 30\.0\)/);
    expect(src).toContain('-1.0, 1.0);');
    // No ripple travelling out over the pedestal: the rings turn.
    expect(src).not.toContain('ripple');
  });
});

describe('where the canvas goes', () => {
  const fit = { x: -40, y: -20, w: 1360, h: 840, scale: 1 };
  const win = { left: 0, top: 0, right: 1280, bottom: 800 };

  it('a room that fits its clips keeps its whole canvas, and a scroll changes nothing', () => {
    const box = { left: 100, top: 300, right: 700, bottom: 500 };
    const a = visibleRegion({ x: 0, y: 0, w: 600, h: 200, scale: 1 }, 600, 200, box, [win]);
    expect(a.clipped).toBe(false);
    expect(a.region).toEqual({ x: 0, y: 0, w: 600, h: 200 });
    // Scrolled 250 px (half of it off screen): the same region, so no reallocation and no extra frame.
    const b = visibleRegion({ x: 0, y: 0, w: 600, h: 200, scale: 1 }, 600, 200, { ...box, top: 50, bottom: 250 }, [win]);
    expect(sameRegion(a.region, b.region)).toBe(true);
  });

  it('a room larger than the window is cut to it (Home), and says so', () => {
    const box = { left: -40, top: -20, right: 1320, bottom: 820 };
    const out = visibleRegion(fit, 1360, 840, box, [win]);
    expect(out.clipped).toBe(true);
    expect(out.region).toEqual({ x: 40, y: 20, w: 1280, h: 800 });
    // Beside a panel that clips it (Routine), only the panel's side is drawn.
    const panel = { left: 0, top: 0, right: 700, bottom: 800 };
    expect(visibleRegion(fit, 1360, 840, box, [win, panel]).region).toEqual({ x: 40, y: 20, w: 700, h: 800 });
  });
});
