/**
 * The Scan hologram's geometry and controller, without a GPU.
 *
 * The triangulation and lattice are plain arithmetic over the sample mesh.
 * The controller runs with a stand-in renderer (Node has no WebGL), which is
 * enough to check where the callout anchors land on the canvas, that nothing
 * is drawn as a face without a mesh, and that dispose frees everything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import sampleFile from '../src/sample/fixtures/scan-face-mesh.json';
import { LATTICE_PITCH, boundaryLoops, buildCraniumShell, buildFaceSurface, sampleLattice, trianglesFromEdges } from '../src/hologram/geometry.ts';
import { FACE_SLOT, HOLOGRAM_BOX, fitBox } from '../src/hologram/layout.ts';
import { ANCHOR_BLEND, ANCHOR_LANDMARK, regionOutline } from '../src/hologram/regions.ts';
import { toScanMesh } from '../src/hologram/sample.ts';
import { FACE_FRAG } from '../src/hologram/shaders.ts';
import { createHologram, type HologramRenderer } from '../src/hologram/engine.ts';
import { FACE_REGIONS, type FaceRegionKey } from '../shared/types.ts';

const mesh = toScanMesh(sampleFile as never);

/** Where landmark i sits on the reference image (the fixture is traced from ref4's crop). */
function refPoint(i: number): [number, number] {
  const f = sampleFile as { crop: { x: number; y: number; w: number; h: number }; points: number[] };
  return [f.crop.x + f.points[i * 3] * f.crop.w, f.crop.y + f.points[i * 3 + 1] * f.crop.h];
}

/** A region's anchor in reference px: its landmark, moved by its blend (ANCHOR_BLEND). */
function anchorRef(k: FaceRegionKey): [number, number] {
  const [x, y] = refPoint(ANCHOR_LANDMARK[k]);
  const b = ANCHOR_BLEND[k];
  if (!b) return [x, y];
  const [tx, ty] = refPoint(b.toward);
  return [x + (tx - x) * b.t, y + (ty - y) * b.t];
}

/** The callout anchors ref4 draws (specs/scan.md 2.2-2.3), in reference px. */
const MOCKUP_ANCHORS = {
  forehead: [835, 151],
  periorbitalLeft: [758, 283],
  cheekLeft: [757, 353],
  periorbitalRight: [959, 295],
  chin: [882, 451],
} as const;

function inside(p: [number, number], poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  return {
    clientWidth: width,
    clientHeight: height,
    width,
    height,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLCanvasElement;
}

function fakeRenderer() {
  const log = { renders: 0, disposed: 0, lost: 0, scene: null as THREE.Object3D | null, sizes: [] as [number, number][] };
  const renderer: HologramRenderer = {
    setPixelRatio() {},
    setSize(w, h) {
      log.sizes.push([w, h]);
    },
    setClearColor() {},
    render(scene) {
      log.renders++;
      log.scene = scene;
    },
    dispose() {
      log.disposed++;
    },
    forceContextLoss() {
      log.lost++;
    },
  };
  return { renderer, log };
}

describe('hologram triangulation', () => {
  const tri = trianglesFromEdges(mesh.tessellation, mesh.count);

  it('reads the 852 MediaPipe triangles off the chained edge list', () => {
    expect(tri.length / 3).toBe(852);
    const edges = new Set<string>();
    for (let i = 0; i < mesh.tessellation.length; i += 2) {
      const a = mesh.tessellation[i], b = mesh.tessellation[i + 1];
      edges.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
    for (let t = 0; t < tri.length; t += 3) {
      const v = [tri[t], tri[t + 1], tri[t + 2]];
      expect(new Set(v).size).toBe(3);
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3];
        expect(edges.has(a < b ? `${a},${b}` : `${b},${a}`)).toBe(true);
      }
    }
  });

  it('falls back to connected triples when the edge list is not in triangle order', () => {
    // Reverse the pair order: no longer chained a-b, b-c, c-a.
    const pairs: number[][] = [];
    for (let i = 0; i < mesh.tessellation.length; i += 2) pairs.push([mesh.tessellation[i + 1], mesh.tessellation[i]]);
    pairs.reverse();
    const shuffled = Uint16Array.from(pairs.flat());
    const fallback = trianglesFromEdges(shuffled, mesh.count);
    const key = (t: ArrayLike<number>, i: number) => [t[i], t[i + 1], t[i + 2]].sort((x, y) => x - y).join(',');
    const found = new Set<string>();
    for (let i = 0; i < fallback.length; i += 3) found.add(key(fallback, i));
    for (let i = 0; i < tri.length; i += 3) expect(found.has(key(tri, i))).toBe(true);
    expect(fallback.length / 3).toBeLessThan(852 * 1.05);
  });

  it('finds the silhouette and the eye and mouth openings as boundary loops', () => {
    const loops = boundaryLoops(tri);
    expect(loops.map((l) => l.length)).toEqual([36, 20, 16, 16]);
    expect(new Set(loops[0])).toEqual(new Set(Array.from(mesh.oval)));
  });

  it('closes the openings and faces every triangle toward the viewer', () => {
    const s = buildFaceSurface(mesh, FACE_SLOT);
    expect(s.vertexCount).toBe(mesh.count + 3);
    expect(s.indices.length / 3).toBe(852 + 16 + 16 + 20);
    let facing = 0;
    for (let t = 0; t < s.indices.length; t += 3) {
      const [a, b, c] = [s.indices[t], s.indices[t + 1], s.indices[t + 2]].map((i) => i * 3);
      const ux = s.positions[b] - s.positions[a], uy = s.positions[b + 1] - s.positions[a + 1];
      const vx = s.positions[c] - s.positions[a], vy = s.positions[c + 1] - s.positions[a + 1];
      if (ux * vy - uy * vx >= 0) facing++;
    }
    expect(facing / (s.indices.length / 3)).toBeGreaterThan(0.97);
    for (const i of s.oval) expect(s.edge[i]).toBe(0);
    expect(s.mouth.reduce((a, b) => a + b, 0)).toBe(1);
    expect(s.eye.reduce((a, b) => a + b, 0)).toBe(2);
    // Placed where the mockup draws the face: landmarks span about y 155-484 of ref4.
    expect(-s.bounds.maxY).toBeCloseTo(155, -1);
    expect(-s.bounds.minY).toBeCloseTo(484, -1);
  });

  it('lays a dense lattice (3,000-4,000 dots) on the surface and none in the openings', () => {
    const s = buildFaceSurface(mesh, FACE_SLOT);
    expect(sampleLattice(s, LATTICE_PITCH.low).count).toBeGreaterThan(2800);
    const lat = sampleLattice(s, LATTICE_PITCH.high);
    expect(lat.count).toBeGreaterThan(3000);
    expect(lat.count).toBeLessThan(4000);
    for (let i = 0; i < lat.count; i++) {
      const x = lat.positions[i * 3], y = lat.positions[i * 3 + 1];
      expect(x).toBeGreaterThan(s.bounds.minX - 3);
      expect(x).toBeLessThan(s.bounds.maxX + 3);
      expect(y).toBeGreaterThan(s.bounds.minY - 3);
      expect(y).toBeLessThan(s.bounds.maxY + 3);
    }
  });
});

describe('hologram head shell', () => {
  it('rises from the face edge to a crown above it and stays about head-wide', () => {
    const s = buildFaceSurface(mesh, FACE_SLOT);
    const shell = buildCraniumShell(s);
    const faceH = s.bounds.maxY - s.bounds.minY, faceW = s.bounds.maxX - s.bounds.minX;
    expect(shell.indices.length / 3).toBe((shell.cols - 1) * shell.rows * 2);
    // The first ring is the face's own upper edge: every point sits on (a smoothing of) the silhouette.
    const ovalPts = s.oval.map((i) => [s.positions[i * 3], s.positions[i * 3 + 1]]);
    const toSegment = (x: number, y: number, [ax, ay]: number[], [bx, by]: number[]): number => {
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
      return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
    };
    for (let c = 0; c < shell.cols; c++) {
      const v = c * (shell.rows + 1);
      const x = shell.positions[v * 3], y = shell.positions[v * 3 + 1];
      const d = Math.min(...ovalPts.map((p, k) => toSegment(x, y, p, ovalPts[(k + 1) % ovalPts.length])));
      expect(d).toBeLessThan(faceH * 0.03);
      expect(shell.s[v]).toBe(0);
    }
    let top = -Infinity, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < shell.positions.length; i += 3) {
      top = Math.max(top, shell.positions[i + 1]);
      minX = Math.min(minX, shell.positions[i]);
      maxX = Math.max(maxX, shell.positions[i]);
    }
    expect((top - s.bounds.maxY) / faceH).toBeGreaterThan(0.25);
    expect((top - s.bounds.maxY) / faceH).toBeLessThan(0.35);
    expect((maxX - minX) / faceW).toBeGreaterThan(0.95);
    expect((maxX - minX) / faceW).toBeLessThan(1.15);
    // Normals point outward, away from the ellipsoid's centre.
    let outward = 0;
    const [ex, ey, ez] = shell.centre;
    const count = shell.positions.length / 3;
    for (let i = 0; i < count; i++) {
      const dx = shell.positions[i * 3] - ex, dy = shell.positions[i * 3 + 1] - ey, dz = shell.positions[i * 3 + 2] - ez;
      if (dx * shell.normals[i * 3] + dy * shell.normals[i * 3 + 1] + dz * shell.normals[i * 3 + 2] > 0) outward++;
    }
    expect(outward / count).toBeGreaterThan(0.95);
  });
});

describe('hologram anchors', () => {
  it('projects each region anchor from its landmark onto the canvas', () => {
    const { renderer } = fakeRenderer();
    const holo = createHologram(fakeCanvas(HOLOGRAM_BOX.w, HOLOGRAM_BOX.h), { renderer, reducedMotion: true });
    holo.setMesh(mesh);
    const a = holo.anchors();
    for (const k of FACE_REGIONS) {
      const [rx, ry] = anchorRef(k);
      expect(a[k].visible).toBe(true);
      // Canvas px = reference px minus the box origin, at scale 1; perspective moves points by well under 2 px.
      expect(Math.abs(a[k].x - (rx - HOLOGRAM_BOX.x))).toBeLessThan(2);
      expect(Math.abs(a[k].y - (ry - HOLOGRAM_BOX.y))).toBeLessThan(2);
    }
    holo.dispose();
  });

  it('puts the callout anchors near the mockup anchors and on their own zones', () => {
    const { renderer } = fakeRenderer();
    const holo = createHologram(fakeCanvas(HOLOGRAM_BOX.w, HOLOGRAM_BOX.h), { renderer, reducedMotion: true });
    holo.setMesh(mesh);
    const a = holo.anchors();
    const dist = (k: keyof typeof MOCKUP_ANCHORS): number =>
      Math.hypot(a[k].x + HOLOGRAM_BOX.x - MOCKUP_ANCHORS[k][0], a[k].y + HOLOGRAM_BOX.y - MOCKUP_ANCHORS[k][1]);
    expect(dist('periorbitalRight')).toBeLessThan(6);
    expect(dist('cheekLeft')).toBeLessThan(10);
    expect(dist('periorbitalLeft')).toBeLessThan(15);
    expect(dist('chin')).toBeLessThan(15);
    // The mockup draws its forehead zone above the mesh's top edge (y 155); ours stays on
    // lit forehead, under the band where the forehead dissolves: about 38 px lower.
    expect(dist('forehead')).toBeLessThan(40);
    // Callouts on the same side must not crowd each other.
    expect(Math.hypot(a.cheekLeft.x - a.periorbitalLeft.x, a.cheekLeft.y - a.periorbitalLeft.y)).toBeGreaterThan(45);
    holo.dispose();

    // Each anchor lies inside the zone it points at (face texture space).
    const s = buildFaceSurface(mesh, FACE_SLOT);
    const uv = (i: number): [number, number] => [s.uvs[i * 2] * 1000, (1 - s.uvs[i * 2 + 1]) * 1000];
    const uvAnchor = (k: FaceRegionKey): [number, number] => {
      const [x, y] = uv(ANCHOR_LANDMARK[k]);
      const b = ANCHOR_BLEND[k];
      if (!b) return [x, y];
      const [tx, ty] = uv(b.toward);
      return [x + (tx - x) * b.t, y + (ty - y) * b.t];
    };
    for (const k of FACE_REGIONS) expect(inside(uvAnchor(k), regionOutline(k, uv))).toBe(true);
  });

  it('scales with the canvas and letterboxes like object-fit: contain', () => {
    const { renderer } = fakeRenderer();
    const holo = createHologram(fakeCanvas(1100, 620), { renderer, reducedMotion: true });
    holo.setMesh(mesh);
    const [rx, ry] = anchorRef('forehead');
    const f = fitBox(HOLOGRAM_BOX, 1100, 620, 'contain');
    expect(f.scale).toBe(1);
    const a = holo.anchors().forehead;
    expect(Math.abs(a.x - (rx - HOLOGRAM_BOX.x + 275))).toBeLessThan(2);
    expect(Math.abs(a.y - ry)).toBeLessThan(2);
    holo.dispose();

    const big = createHologram(fakeCanvas(1100, 1240), { renderer, reducedMotion: true });
    big.setMesh(mesh);
    const b = big.anchors().chin;
    const [cx, cy] = refPoint(ANCHOR_LANDMARK.chin);
    expect(Math.abs(b.x - (cx - HOLOGRAM_BOX.x) * 2)).toBeLessThan(4);
    expect(Math.abs(b.y - cy * 2)).toBeLessThan(4);
    big.dispose();
  });

  it('reports no anchors, and draws no face, without a mesh', () => {
    const { renderer, log } = fakeRenderer();
    const seen: unknown[] = [];
    const faces = (): number => {
      let n = 0;
      log.scene?.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (m && m.fragmentShader === FACE_FRAG) n++;
      });
      return n;
    };
    const holo = createHologram(fakeCanvas(550, 620), { renderer, reducedMotion: true, onAnchors: (a) => seen.push(a) });
    expect(log.renders).toBeGreaterThan(0);
    expect(faces()).toBe(0);
    expect(Object.values(holo.anchors()).every((a) => !a.visible)).toBe(true);
    holo.setMesh(mesh);
    expect(faces()).toBe(1);
    holo.setMesh(null);
    expect(faces()).toBe(0);
    expect(Object.values(holo.anchors()).every((a) => !a.visible)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    holo.dispose();
  });
});

describe('hologram layout and rebuilds', () => {
  it('keeps its drawing buffer when the canvas has no size (display: none)', () => {
    const { renderer, log } = fakeRenderer();
    const canvas = fakeCanvas(550, 620) as unknown as { clientWidth: number; clientHeight: number; width: number; height: number };
    const holo = createHologram(canvas as unknown as HTMLCanvasElement, { renderer, reducedMotion: true, quality: 'high' });
    holo.setMesh(mesh);
    expect(log.sizes.at(-1)).toEqual([550, 620]);
    // Hidden: the element reports 0 while its buffer is 2x (1100 x 1240).
    canvas.clientWidth = canvas.clientHeight = 0;
    canvas.width = 1100;
    canvas.height = 1240;
    holo.resize();
    holo.resize();
    for (const [w, h] of log.sizes) {
      expect(w).toBe(550);
      expect(h).toBe(620);
    }
    expect(holo.anchors().forehead.visible).toBe(true);
    canvas.clientWidth = 275;
    canvas.clientHeight = 310;
    holo.resize();
    expect(log.sizes.at(-1)).toEqual([275, 310]);
    holo.dispose();
  });

  it('draws nothing until the canvas first has a size', () => {
    const { renderer, log } = fakeRenderer();
    const canvas = fakeCanvas(0, 0) as unknown as { clientWidth: number; clientHeight: number };
    const holo = createHologram(canvas as unknown as HTMLCanvasElement, { renderer, reducedMotion: true });
    holo.setMesh(mesh);
    expect(log.renders).toBe(0);
    expect(Object.values(holo.anchors()).every((x) => !x.visible)).toBe(true);
    canvas.clientWidth = 550;
    canvas.clientHeight = 620;
    holo.resize();
    expect(log.renders).toBeGreaterThan(0);
    expect(holo.anchors().chin.visible).toBe(true);
    holo.dispose();
  });

  it('reuses its materials across new meshes and quality steps (no shader recompiles)', () => {
    const { renderer, log } = fakeRenderer();
    const holo = createHologram(fakeCanvas(550, 620), { renderer, reducedMotion: true, quality: 'high' });
    const materials = (): Set<THREE.Material> => {
      const out = new Set<THREE.Material>();
      log.scene!.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const x of ([] as THREE.Material[]).concat(m)) out.add(x);
      });
      return out;
    };
    holo.setMesh(mesh);
    holo.setRegions([{ region: 'chin', tone: 'lavender', strength: 0.8 }]);
    const before = materials();
    const disposed: THREE.Material[] = [];
    for (const m of before) m.addEventListener('dispose', () => disposed.push(m));
    holo.setMesh(toScanMesh(sampleFile as never));
    holo.setQuality('low');
    holo.setQuality('medium');
    expect(disposed).toEqual([]);
    for (const m of materials()) expect(before.has(m)).toBe(true);
    holo.dispose();
  });
});

describe('hologram dispose', () => {
  it('disposes every geometry, material and texture it drew, and the renderer', () => {
    const { renderer, log } = fakeRenderer();
    const holo = createHologram(fakeCanvas(550, 620), { renderer, reducedMotion: true });
    holo.setMesh(mesh);
    holo.setRegions([{ region: 'chin', tone: 'lavender', strength: 0.8 }]);
    expect(log.renders).toBeGreaterThan(0);
    const disposed = new Set<object>();
    const owned: object[] = [];
    log.scene!.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      for (const res of [m.geometry, ...([] as THREE.Material[]).concat(m.material)]) {
        owned.push(res);
        res.addEventListener('dispose', () => disposed.add(res));
      }
    });
    expect(owned.length).toBeGreaterThan(10);
    const rendersBefore = log.renders;
    holo.dispose();
    expect(owned.every((r) => disposed.has(r))).toBe(true);
    expect(log.disposed).toBe(1);
    expect(log.lost).toBe(1);
    // Everything after dispose is a no-op.
    holo.setMesh(mesh);
    holo.resize();
    holo.dispose();
    expect(log.renders).toBe(rendersBefore);
    expect(log.disposed).toBe(1);
    expect(Object.values(holo.anchors()).every((a) => !a.visible)).toBe(true);
  });
});

describe('the consult tour on the hologram', () => {
  /** The face surface's material, whose uniforms carry the zone mix and the ripple. */
  function faceUniforms(scene: THREE.Object3D | null): Record<string, { value: unknown }> {
    let u: Record<string, { value: unknown }> | null = null;
    scene?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && m.fragmentShader === FACE_FRAG) u = m.uniforms as Record<string, { value: unknown }>;
    });
    if (!u) throw new Error('no face');
    return u;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says once per face when it has formed (at once under reduced motion)', () => {
    const { renderer } = fakeRenderer();
    let formed = 0;
    const holo = createHologram(fakeCanvas(550, 620), { renderer, reducedMotion: true, onFormed: () => formed++ });
    holo.setMesh(mesh);
    expect(formed).toBe(1);
    holo.redraw();
    expect(formed).toBe(1);
    holo.setMesh(null);
    holo.setMesh(mesh);
    expect(formed).toBe(2);
    holo.dispose();
  });

  it('forms over its build-in with motion allowed, and only then says so', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { renderer } = fakeRenderer();
    let formed = 0;
    const holo = createHologram(fakeCanvas(550, 620), { renderer, reducedMotion: false, onFormed: () => formed++ });
    holo.setMesh(mesh);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(50);
      holo.redraw();
    }
    expect(formed).toBe(0);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(50);
      holo.redraw();
    }
    expect(formed).toBe(1);
    holo.dispose();
  });

  it('taps: one ring and a bloom from the spot, gone in under a second; nothing without a face or with motion reduced', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { renderer, log } = fakeRenderer();
    let now = 0;
    const holo = createHologram(fakeCanvas(550, 620), { renderer, reducedMotion: false, clock: () => now });
    holo.pulse('forehead');
    holo.setMesh(mesh);
    holo.redraw();
    const u = faceUniforms(log.scene);
    expect(u.uRipA.value).toBe(0);
    holo.pulse('forehead');
    now = 120;
    vi.advanceTimersByTime(16);
    holo.redraw();
    expect(u.uRipA.value as number).toBeGreaterThan(0.3);
    expect(u.uBloomA.value as number).toBeCloseTo(0.9, 5);
    expect(u.uRipR.value as number).toBeGreaterThan(20);
    expect(u.uRipR.value as number).toBeLessThan(40);
    now = 900;
    vi.advanceTimersByTime(16);
    holo.redraw();
    expect(u.uRipA.value).toBe(0);
    expect(u.uBloomA.value).toBe(0);
    holo.setReducedMotion(true);
    holo.pulse('chin');
    now = 1000;
    holo.redraw();
    expect(u.uRipA.value).toBe(0);
    holo.dispose();
  });

  it('fades emptied zones out before their texture is cleared', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { renderer, log } = fakeRenderer();
    const holo = createHologram(fakeCanvas(550, 620), { renderer, reducedMotion: false });
    holo.setMesh(mesh);
    holo.setRegions([{ region: 'chin', tone: 'lavender', strength: 0.8 }]);
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(50);
      holo.redraw();
    }
    const u = faceUniforms(log.scene);
    expect(u.uZoneMix.value).toBe(1);
    const zoneTexture = u.uZones.value;
    holo.setRegions([], { fadeOutMs: 550 });
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(50);
      holo.redraw();
    }
    expect(u.uZoneMix.value as number).toBeGreaterThan(0.4);
    expect(u.uZoneMix.value as number).toBeLessThan(0.7);
    // Still the painted zone while it fades.
    expect(u.uZones.value).toBe(zoneTexture);
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(50);
      holo.redraw();
    }
    expect(u.uZoneMix.value).toBe(0);
    holo.dispose();
  });

  it('gives each anchor its place in ref4 px, and the face oval\'s box', () => {
    const { renderer } = fakeRenderer();
    const holo = createHologram(fakeCanvas(HOLOGRAM_BOX.w, HOLOGRAM_BOX.h), { renderer, reducedMotion: true });
    expect(holo.faceBounds()).toBeNull();
    holo.setMesh(mesh);
    const a = holo.anchors();
    for (const k of FACE_REGIONS) {
      const [rx, ry] = anchorRef(k);
      expect(Math.abs(a[k].ref!.x - rx)).toBeLessThan(3);
      expect(Math.abs(a[k].ref!.y - ry)).toBeLessThan(3);
    }
    const b = holo.faceBounds()!;
    // The sample face spans about x 713-1024, y 155-484 of ref4 (the canvas starts at x 560).
    expect(Math.abs(b.x + HOLOGRAM_BOX.x - 713)).toBeLessThan(12);
    expect(Math.abs(b.x + b.w + HOLOGRAM_BOX.x - 1024)).toBeLessThan(12);
    expect(Math.abs(b.y - 155)).toBeLessThan(12);
    expect(Math.abs(b.y + b.h - 484)).toBeLessThan(12);
    holo.dispose();
  });
});
