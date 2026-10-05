import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_ANCHORS,
  applyQuad,
  coverFit,
  hasRender,
  loadAnchors,
  parseAnchors,
  plateSrcset,
  quadMatrix,
  refFit,
  toPx,
  type Quad,
  type RoomId,
  type RoomVariant,
} from '../src/stage/room-anchors.ts';
import { PUBLISHED_ROOMS } from '../src/stage/env-rooms.ts';

const published = (file: string): unknown => JSON.parse(readFileSync(new URL(`../public/env/${file}`, import.meta.url), 'utf8'));

/*
 * The room plates are cropped by object-fit: cover, and wall text is bent onto
 * the picture with a matrix3d. These pin the maths that keeps the two agreeing.
 */

describe('coverFit', () => {
  it('fills a wider box by width and crops top and bottom around the focus', () => {
    const fit = coverFit(1600, 900, 2000, 900);
    expect(fit.scale).toBeCloseTo(1.25);
    expect(fit.w).toBeCloseTo(2000);
    expect(fit.h).toBeCloseTo(1125);
    expect(fit.x).toBeCloseTo(0);
    expect(fit.y).toBeCloseTo(-112.5);
  });

  it('keeps the focus point where object-position would', () => {
    const fit = coverFit(1000, 1000, 400, 800, [0.25, 0.5]);
    // 800px tall => scale 0.8, frame 800 wide, 400 to crop, a quarter from the left.
    expect(fit.x).toBeCloseTo(-100);
    expect(toPx(fit, [0.5, 0.5])).toEqual([300, 400]);
  });

  it('is empty for an unmeasured box', () => {
    expect(coverFit(100, 100, 0, 0).w).toBe(0);
  });
});

describe('quadMatrix', () => {
  const box = { w: 200, h: 100 };

  it('sends the box corners to the quad corners (perspective quad)', () => {
    const quad: Quad = [
      [852, 238],
      [975, 227],
      [975, 303],
      [851, 308],
    ];
    const corners: [number, number][] = [
      [0, 0],
      [box.w, 0],
      [box.w, box.h],
      [0, box.h],
    ];
    corners.forEach((corner, i) => {
      const [x, y] = applyQuad(box.w, box.h, quad, corner);
      expect(x).toBeCloseTo(quad[i][0], 4);
      expect(y).toBeCloseTo(quad[i][1], 4);
    });
  });

  it('reduces to a plain scale and translate for a rectangle', () => {
    const quad: Quad = [
      [10, 20],
      [410, 20],
      [410, 220],
      [10, 220],
    ];
    expect(quadMatrix(box.w, box.h, quad)).toBe('matrix3d(2,0,0,0,0,2,0,0,0,0,1,0,10,20,0,1)');
  });
});

describe('parseAnchors', () => {
  it('keeps well-formed surfaces and drops the rest', () => {
    const parsed = parseAnchors({
      frame: { w: 2560, h: 1440 },
      plates: [{ src: 'room.webp', kind: 'base' }, { src: '../secret.webp' }],
      surfaces: {
        niche_text: { quad: [[0, 0], [1, 0], [1, 1], [0, 1]], blurPx: 1.1 },
        broken: { quad: [[0, 0]] },
      },
    });
    expect(parsed?.plates).toEqual([{ src: 'room.webp', kind: 'base' }]);
    expect(Object.keys(parsed?.surfaces ?? {})).toEqual(['niche_text']);
  });

  it('refuses plate paths that leave /env', () => {
    const parsed = parseAnchors({
      frame: { w: 10, h: 10 },
      plates: [{ src: '/env/lounge/a-10.webp' }, { src: '/secret.webp' }, { src: 'https://x.test/a.webp' }],
    });
    expect(parsed?.plates?.map((p) => p.src)).toEqual(['/env/lounge/a-10.webp']);
  });

  it('rejects a file without a frame (or the dev server answering with HTML)', () => {
    expect(parseAnchors({})).toBeNull();
    expect(parseAnchors('<!doctype html>')).toBeNull();
  });

  it('ships stand-in anchors for every room', () => {
    for (const anchors of Object.values(FALLBACK_ANCHORS)) {
      expect(anchors.frame.w).toBeGreaterThan(0);
      expect(parseAnchors(anchors)).not.toBeNull();
    }
  });
});

describe('loadAnchors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not ask the server about a room without a published render', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await loadAnchors('consult', 'desk', {})).toBeNull();
    expect(await loadAnchors('products-hero', 'mobile', { 'products-hero': ['desk'] })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches and parses the anchors of a published room', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ frame: { w: 1600, h: 900 } }),
    }));
    vi.stubGlobal('fetch', fetch);
    const anchors = await loadAnchors('products-hero', 'desk', { 'products-hero': ['desk'] });
    expect(fetch).toHaveBeenCalledWith('/env/products-hero/anchors.json', expect.anything());
    expect(anchors?.frame).toEqual({ w: 1600, h: 900, focus: undefined });
  });

  it('asks for the phone-portrait render by its own file', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ frame: { w: 1080, h: 2340 } }),
    }));
    vi.stubGlobal('fetch', fetch);
    const anchors = await loadAnchors('lounge', 'mobile', { lounge: ['desk', 'mobile'] });
    expect(fetch).toHaveBeenCalledWith('/env/lounge/anchors-mobile.json', expect.anything());
    expect(anchors?.frame.h).toBe(2340);
  });
});

describe('refFit', () => {
  // The products hero: ref3's 1062x311 frame sits at 8.4 % .. 91.6 % of a 2552x748 plate.
  const ref = { x: 0.08386, y: 0.08422, w: 0.83229, h: 0.83155 };

  it("draws the mockup's framing exactly over a box of its own shape", () => {
    const fit = refFit(2552, 748, ref, 1062, 311);
    expect(toPx(fit, [ref.x, ref.y])[0]).toBeCloseTo(0, 1);
    expect(toPx(fit, [ref.x, ref.y])[1]).toBeCloseTo(0, 1);
    expect(toPx(fit, [ref.x + ref.w, ref.y + ref.h])[0]).toBeCloseTo(1062, 1);
    expect(toPx(fit, [ref.x + ref.w, ref.y + ref.h])[1]).toBeCloseTo(311, 1);
    // Plain cover shows the whole margin, so the room reads ~17 % smaller.
    expect(coverFit(2552, 748, 1062, 311).w / fit.w).toBeCloseTo(0.83, 1);
  });

  it('crops the framing at the focus in a narrower box and always covers it', () => {
    for (const [w, h] of [
      [700, 311],
      [358, 260],
      [1400, 400],
    ]) {
      const fit = refFit(2552, 748, ref, w, h, [0.62, 0.5]);
      expect(fit.x).toBeLessThanOrEqual(0.001);
      expect(fit.y).toBeLessThanOrEqual(0.001);
      expect(fit.x + fit.w).toBeGreaterThanOrEqual(w - 0.001);
      expect(fit.y + fit.h).toBeGreaterThanOrEqual(h - 0.001);
    }
  });

  it('is plain cover without a framing', () => {
    expect(refFit(1600, 900, null, 400, 400)).toEqual(coverFit(1600, 900, 400, 400));
  });
});

describe('the published renders (public/env), read the one way every room loads', () => {
  const files: Record<RoomId, Partial<Record<RoomVariant, string>>> = {
    lounge: { desk: 'lounge/anchors.json', mobile: 'lounge/anchors-mobile.json' },
    consult: { desk: 'consult/anchors.json', mobile: 'consult/anchors-mobile.json' },
    'lounge-strip-window': { desk: 'lounge-strip-window/anchors.json' },
    'lounge-strip-interior': {},
    'products-hero': { desk: 'products-hero/anchors.json' },
  };

  it('parses every render env-rooms.ts lists, whichever format the Blender job wrote', () => {
    for (const [room, variants] of Object.entries(PUBLISHED_ROOMS) as [RoomId, RoomVariant[]][]) {
      for (const variant of variants) {
        const file = files[room][variant];
        expect(file, `${room} ${variant}`).toBeTruthy();
        const anchors = parseAnchors(published(file!));
        expect(anchors, file).not.toBeNull();
        expect(anchors!.plates?.length, file).toBeGreaterThan(0);
        expect(hasRender(room, variant)).toBe(true);
      }
    }
  });

  it('reads the Blender job format (consult): plate, refFrame, files, curves', () => {
    const desk = parseAnchors(published('consult/anchors.json'))!;
    expect(desk.frame).toEqual({ w: 2560, h: 1440 });
    expect(desk.ref?.w).toBeCloseTo(0.8333, 3);
    expect(desk.plates?.[0]).toMatchObject({ src: 'plate-2560.webp', kind: 'base', widths: [2560, 1920, 1280] });
    expect(desk.plates?.[1]).toMatchObject({ kind: 'glow', animate: 'boost' });
    expect(desk.surfaces?.wall_left_text?.lines).toContain('HIGHER SKIN STANDARDS');
    expect(desk.curves?.pedestal_band_mid?.length).toBeGreaterThan(10);
    expect(desk.points?.emitter_centre).toHaveLength(2);
    const phone = parseAnchors(published('consult/anchors-mobile.json'))!;
    expect(phone.ref).toBeNull();
    expect(phone.plates?.[0].src).toMatch(/^mobile-plate-\d+\.webp$/);
  });

  it("finds each Room-format render's mockup framing (cameras refFrame or *_ref_tl/br points)", () => {
    expect(parseAnchors(published('lounge/anchors.json'))!.ref?.x).toBeCloseTo(0.4995, 3);
    expect(parseAnchors(published('products-hero/anchors.json'))!.ref?.w).toBeCloseTo(0.8323, 3);
    expect(parseAnchors(published('lounge/anchors-mobile.json'))!.ref).toBeNull();
  });

  it('serves each plate at the width the screen needs (srcset of its published sizes)', () => {
    const lounge = parseAnchors(published('lounge/anchors.json'))!;
    expect(plateSrcset(lounge.plates![0], (src) => `/env/lounge/${src}`)).toBe(
      '/env/lounge/home-1280.webp 1280w, /env/lounge/home-1920.webp 1920w, /env/lounge/home-2560.webp 2560w',
    );
    const strip = parseAnchors(published('lounge-strip-window/anchors.json'))!;
    expect(strip.plates!.map((p) => p.kind)).toEqual(['base', 'blur']);
    expect(plateSrcset(strip.plates![1])).toBeNull();
    for (const [room, variants] of Object.entries(PUBLISHED_ROOMS) as [RoomId, RoomVariant[]][]) {
      for (const variant of variants) {
        for (const plate of parseAnchors(published(files[room][variant]!))!.plates!) {
          const resolve = (src: string) => (src.startsWith('/') ? src : `/env/${room}/${src}`);
          const names = plateSrcset(plate, resolve)?.split(', ').map((c) => c.split(' ')[0]) ?? [resolve(plate.src)];
          for (const name of names) {
            expect(() => readFileSync(new URL(`../public${name}`, import.meta.url)), name).not.toThrow();
          }
        }
      }
    }
  });

  /*
   * The living-room masks (scripts/blender/mask_passes.py + mask_post.py) are data maps for animating a plate:
   * they must sit on the plate's own pixel grid at every width they are published at, and must never be listed
   * as plates (Room.svelte would draw them).
   */
  const webpSize = (b: Buffer): [number, number] => {
    const fourcc = b.toString('ascii', 12, 16);
    if (fourcc === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (fourcc === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (fourcc === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    throw new Error(`not a WebP (${fourcc})`);
  };

  it("publishes each render's living-room masks on the plate's own pixel grid, never as plates", () => {
    for (const [room, variants] of Object.entries(PUBLISHED_ROOMS) as [RoomId, RoomVariant[]][]) {
      for (const variant of variants) {
        const file = files[room][variant]!;
        const raw = published(file) as {
          masks?: Record<string, { src: string; widths: number[] } | string>;
          lights?: { id: number; name: string; kind: string; cx: number; cy: number }[];
          strips?: { id: number }[];
          plants?: { id: number }[];
        };
        expect(raw.masks, file).toBeTruthy();
        const resolve = (src: string) => (src.startsWith('/') ? src : `/env/${room}/${src}`);
        const size = (src: string) => webpSize(readFileSync(new URL(`../public${resolve(src)}`, import.meta.url)));
        const plate = raw.masks!.plate as string;
        const entries = Object.entries(raw.masks!).filter(([, m]) => typeof m === 'object') as [
          string,
          { src: string; widths: number[] },
        ][];
        expect(entries.map(([name]) => name), file).toContain('plants');
        for (const [name, mask] of entries) {
          for (const w of mask.widths) {
            const at = (src: string) => src.replace(/-\d+\.webp$/, `-${w}.webp`);
            expect(size(at(mask.src)), `${file} ${name} ${w}`).toEqual(size(at(plate)));
          }
        }
        const anchors = parseAnchors(raw)!;
        expect(anchors.plates!.some((p) => /mask-|depth-/.test(p.src)), file).toBe(false);
        for (const list of [raw.lights ?? [], raw.strips ?? [], raw.plants ?? []]) {
          const ids = list.map((x) => x.id);
          expect(new Set(ids).size, file).toBe(ids.length);
          expect(ids.every((id) => Number.isInteger(id) && id >= 1 && id <= 255), file).toBe(true);
        }
        for (const lamp of raw.lights ?? []) {
          if (lamp.kind !== 'beacon') expect(anchors.points?.[`lamp_${lamp.name}`], lamp.name).toEqual([lamp.cx, lamp.cy]);
        }
      }
    }
  });
});
