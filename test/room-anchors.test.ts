import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_ANCHORS,
  applyQuad,
  coverFit,
  loadAnchors,
  parseAnchors,
  quadMatrix,
  toPx,
  type Quad,
} from '../src/stage/room-anchors.ts';

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
    expect(await loadAnchors('consult', [])).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches and parses the anchors of a published room', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ frame: { w: 1600, h: 900 } }),
    }));
    vi.stubGlobal('fetch', fetch);
    const anchors = await loadAnchors('products-hero', ['products-hero']);
    expect(fetch).toHaveBeenCalledWith('/env/products-hero/anchors.json', expect.anything());
    expect(anchors?.frame).toEqual({ w: 1600, h: 900, focus: undefined });
  });
});
