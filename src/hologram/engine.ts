/**
 * The Scan page's hologram: the user's own face mesh, drawn as light.
 *
 * `createHologram(canvas)` owns one WebGL context on that canvas and draws the
 * consult-room hologram of ref4 over a transparent background, so the room
 * plate shows through: a cool translucent face surface built from the
 * capture's landmark triangles with a cyan Fresnel rim, a dense dot lattice
 * following its contours, soft zone glows where the reading has something to
 * say, and the emitter rings and glass orb at the base.
 *
 * It only ever draws what it is handed. With no mesh it draws the base rings
 * and nothing else (the page says "scan to see your map"); it never falls back
 * to a stock head, and it keeps nothing: the mesh lives in this object's GPU
 * buffers until `setMesh(null)` or `dispose()`, and is never written anywhere
 * (SRS RET-01..03). The head shell above the face, the particles and smooth
 * wire arcs on it, and the neck column are decoration placed around whatever
 * face it has: plain geometric volumes, never a claim about the person's hair,
 * head or neck.
 *
 * three.js is imported here and only here (plus the barrel), and the Scan
 * page reaches this file through a dynamic `import()`, so nothing on the first
 * page load pays for it.
 */
import * as THREE from 'three';
import type { FaceRegionKey } from '@shared/types.ts';
import { FACE_REGIONS } from '@shared/types.ts';
import type { ScanMesh } from '@/scan/mesh.ts';
import { LATTICE_PITCH, buildCraniumShell, buildFaceSurface, sampleLattice, shellPoint, smoothLoop, type FaceSurface } from './geometry.ts';
import { BASE, CAMERA_DISTANCE, FACE_SLOT, HOLOGRAM_BOX, fitBox, fovFor, type Fit, type RefBox } from './layout.ts';
import { ANCHOR_LANDMARK, REGION_NODES, paintFeatures, paintZones, type RegionHighlight } from './regions.ts';
import * as S from './shaders.ts';

export type HologramQuality = 'low' | 'medium' | 'high';

export interface HologramAnchor {
  /** CSS px from the canvas's top-left corner. */
  x: number;
  y: number;
  /** False without a face, while it builds in, or when the point faces away or leaves the canvas. */
  visible: boolean;
}

export type HologramAnchors = Record<FaceRegionKey, HologramAnchor>;

/** The slice of `THREE.WebGLRenderer` the engine uses; tests pass a stand-in. */
export interface HologramRenderer {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  dispose(): void;
  forceContextLoss?(): void;
}

export interface HologramOptions {
  /** Which part of the reference frame the canvas shows. Default `HOLOGRAM_BOX` (x 560-1110, y 0-620 of ref4). */
  box?: RefBox;
  /** How that box fits the canvas. Default 'contain'. */
  fit?: Fit;
  /** Where the box sits in spare room, 0..1 per axis (like object-position). Default centred. */
  align?: { x: number; y: number };
  /** 'auto' (default) picks from the device and steps down if frames run long. */
  quality?: HologramQuality | 'auto';
  /** Hold everything still (no sway, pulse, drift or sweep). Default: the `prefers-reduced-motion` query. */
  reducedMotion?: boolean;
  /** Frame cap. Default 60 (30 on touch devices and at 'low'). */
  maxFps?: number;
  /** Called after a frame whenever an anchor moved or changed visibility. */
  onAnchors?: (anchors: HologramAnchors) => void;
  /** Tests only: draw with this instead of a WebGL renderer. */
  renderer?: HologramRenderer;
}

export interface HologramController {
  /** False when WebGL could not start; every method is then a no-op and the page should show its own fallback. */
  readonly supported: boolean;
  /** The live session mesh, or null to clear the face (rings only). */
  setMesh(mesh: ScanMesh | null): void;
  /** Which regions glow, in which tone, how strongly. Replaces the previous set. */
  setRegions(highlights: RegionHighlight[]): void;
  /** The region being talked about right now: brighter, with its dots lifted. */
  setActiveRegion(region: FaceRegionKey | null): void;
  /** Where each region's anchor is on the canvas right now (CSS px). */
  anchors(): HologramAnchors;
  /** Re-reads the canvas's CSS size. Called automatically on resize where ResizeObserver exists. */
  resize(): void;
  setQuality(quality: HologramQuality): void;
  setReducedMotion(on: boolean): void;
  /** Stops drawing until `resume()` (the engine also pauses itself when hidden or off-screen). */
  pause(): void;
  resume(): void;
  /** Frees every GPU resource and the context itself. The canvas cannot host another hologram afterwards. */
  dispose(): void;
}

const QUALITY: Record<HologramQuality, { dpr: number; tex: number; envelope: number; pitch: number; fps: number }> = {
  high: { dpr: 2, tex: 1024, envelope: 900, pitch: LATTICE_PITCH.high, fps: 60 },
  medium: { dpr: 1.5, tex: 768, envelope: 600, pitch: LATTICE_PITCH.medium, fps: 60 },
  low: { dpr: 1, tex: 512, envelope: 340, pitch: LATTICE_PITCH.low, fps: 30 },
};
const ORDER: HologramQuality[] = ['low', 'medium', 'high'];
/** Largest drawing buffer side, whatever the CSS size and DPR (phones refuse or lose the context well before 8192). */
const MAX_BUFFER = 4096;

/** sRGB hex to a raw 0..1 vector (no colour-space conversion: the shaders output sRGB as-is). */
function rgb(hex: number): THREE.Vector3 {
  return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/** Additive light: colour and its alpha both added, so the sum stays a valid premultiplied pixel (see shaders.ts). */
function additive(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}

/** Premultiplied cover: the part hides what is behind it by its alpha, and may add light on top. */
function covering(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  m.transparent = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return m;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function makeCanvas(size: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  return null;
}

function emptyAnchors(): HologramAnchors {
  const out = {} as HologramAnchors;
  for (const k of FACE_REGIONS) out[k] = { x: 0, y: 0, visible: false };
  return out;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function autoQuality(): HologramQuality {
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
    if (nav && ((nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2))) return 'low';
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'medium';
  } catch {
    // fall through
  }
  return 'high';
}

function isTouch(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** A quad lying in the reference plane, centred on (cx, cy) reference px. */
function planeAt(cx: number, cy: number, hw: number, hh: number, z = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(hw * 2, hh * 2);
  g.translate(cx, -cy, z);
  return g;
}

const NOOP: HologramController = {
  supported: false,
  setMesh() {},
  setRegions() {},
  setActiveRegion() {},
  anchors: emptyAnchors,
  resize() {},
  setQuality() {},
  setReducedMotion() {},
  pause() {},
  resume() {},
  dispose() {},
};

export function createHologram(canvas: HTMLCanvasElement, options: HologramOptions = {}): HologramController {
  const box = options.box ?? HOLOGRAM_BOX;
  const fit = options.fit ?? 'contain';
  const align = options.align ?? { x: 0.5, y: 0.5 };
  const autoQ = (options.quality ?? 'auto') === 'auto';
  let quality: HologramQuality = autoQ ? autoQuality() : (options.quality as HologramQuality);
  let reduced = options.reducedMotion ?? prefersReducedMotion();
  const touch = isTouch();

  let renderer: HologramRenderer;
  try {
    renderer =
      options.renderer ??
      new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        premultipliedAlpha: true,
        antialias: quality !== 'low',
        powerPreference: 'high-performance',
      });
  } catch {
    return NOOP;
  }
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(10, 1, CAMERA_DISTANCE * 0.25, CAMERA_DISTANCE * 2);
  let cssW = 1, cssH = 1;

  // Shared uniforms: one object per value, handed to every material that reads it.
  const U = {
    uTime: { value: 0 },
    uPxScale: { value: 1 },
    uPresence: { value: 0 },
    uMotion: { value: reduced ? 0 : 1 },
  };
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  const faceU = {
    ...U,
    uZones: { value: blank as THREE.Texture },
    uFeatures: { value: blank as THREE.Texture },
    uZoneMix: { value: 0 },
    uActiveMix: { value: 0 },
    uBreath: { value: 1 },
    uScanY: { value: 0 },
    uScanOn: { value: 0 },
    uTopY: { value: 0 },
    uFaceH: { value: FACE_SLOT.height },
  };

  // ---- Static base: rings, orb, specks, glows. Always present. ----------------
  const base = new THREE.Group();
  scene.add(base);
  const disposables: { dispose(): void }[] = [blank];
  const own = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  function ring(r: { cx: number; cy: number; rx: number; ry: number }, core: number, glowW: number, gain: number, ticks: boolean, spin: number, order: number): void {
    const pad = glowW * 4 + 10;
    const mat = own(
      additive(
        new THREE.ShaderMaterial({
          vertexShader: S.QUAD_VERT,
          fragmentShader: S.RING_FRAG,
          uniforms: {
            ...U,
            uHalf: { value: new THREE.Vector2(r.rx + pad, r.ry + pad) },
            uR: { value: new THREE.Vector2(r.rx, r.ry) },
            uCore: { value: core },
            uGlowW: { value: glowW },
            uGain: { value: gain },
            uTicks: { value: ticks ? 1 : 0 },
            uSpin: { value: spin },
          },
        }),
      ),
    );
    mat.depthTest = false;
    const m = new THREE.Mesh(own(planeAt(r.cx, r.cy, r.rx + pad, r.ry + pad)), mat);
    m.renderOrder = order;
    base.add(m);
  }

  type Reg = <T extends { dispose(): void }>(x: T) => T;

  /** Soft light pooled on the base, under ring A. */
  function glow(cx: number, cy: number, hw: number, hh: number, colour: number, gain: number, order: number): void {
    const mat = own(
      additive(
        new THREE.ShaderMaterial({
          vertexShader: S.QUAD_VERT,
          fragmentShader: S.GLOW_FRAG,
          uniforms: { ...U, uHalf: { value: new THREE.Vector2(hw, hh) }, uColor: { value: rgb(colour) }, uGain: { value: gain }, uFade: { value: 1 } },
        }),
      ),
    );
    mat.depthTest = false;
    const m = new THREE.Mesh(own(planeAt(cx, cy, hw, hh)), mat);
    m.renderOrder = order;
    base.add(m);
  }

  glow(BASE.ringA.cx, BASE.ringA.cy + 8, BASE.ringA.rx * 1.25, 46, 0x3a5aa8, 0.35, 1);
  ring(BASE.wash, 1.2, 5, 0.2, false, 0, 2);
  ring(BASE.ringA, 0.85, 4.5, 0.85, true, 0.05, 3);
  ring(BASE.ringBOuter, 0.9, 3, 0.8, false, -0.08, 3);
  ring(BASE.ringBInner, 0.8, 2.5, 0.7, false, 0.1, 3);

  {
    const r = BASE.orb;
    const half = r.r * 1.6;
    const mat = own(
      covering(
        new THREE.ShaderMaterial({
          vertexShader: S.QUAD_VERT,
          fragmentShader: S.ORB_FRAG,
          uniforms: { ...U, uHalf: { value: new THREE.Vector2(half, half) }, uR: { value: r.r } },
        }),
      ),
    );
    mat.depthTest = false;
    mat.depthWrite = false;
    const m = new THREE.Mesh(own(planeAt(r.cx, r.cy, half, half)), mat);
    m.renderOrder = 20;
    base.add(m);
  }

  const sparkMat = (fade: { value: number }, drift: number, reg: Reg): THREE.ShaderMaterial => {
    const m = reg(
      additive(
        new THREE.ShaderMaterial({
          vertexShader: S.SPARK_VERT,
          fragmentShader: S.POINT_FRAG,
          uniforms: { ...U, uFade: fade, uDrift: { value: drift } },
        }),
      ),
    );
    m.depthTest = false;
    return m;
  };

  function sparks(positions: number[], size: number[], alpha: number[], colours: number[], seeds: number[], mat: THREE.ShaderMaterial): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alpha, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(colours, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    return p;
  }

  {
    // Data specks and short dashes scattered around ring A.
    const rnd = seeded(71);
    const P: number[] = [], Sz: number[] = [], A: number[] = [], C: number[] = [], Sd: number[] = [];
    const r = BASE.ringA;
    for (let i = 0; i < 70; i++) {
      const t = rnd() * Math.PI * 2;
      const k = 1 + (rnd() - 0.5) * 0.16;
      P.push(r.cx + Math.cos(t) * r.rx * k, -(r.cy + Math.sin(t) * r.ry * k + (rnd() - 0.5) * 10), 0);
      Sz.push(0.6 + rnd() * 0.9);
      A.push(0.25 + rnd() * 0.5);
      C.push(0.78, 0.93, 1);
      Sd.push(rnd());
    }
    const specks = sparks(P, Sz, A, C, Sd, sparkMat({ value: 1 }, 0, own));
    own(specks.geometry);
    specks.renderOrder = 4;
    base.add(specks);
  }

  // ---- The face and everything that hangs off it. --------------------------------
  // Materials are made once and shared by every face this engine is given: a new
  // mesh, or a quality step, only swaps geometry and never recompiles a shader.
  const pivot = new THREE.Group();
  const head = new THREE.Group();
  const faceParts = new THREE.Group();
  head.add(faceParts);
  pivot.add(head);
  scene.add(pivot);

  const faceMat = own(covering(new THREE.ShaderMaterial({ vertexShader: S.FACE_VERT, fragmentShader: S.FACE_FRAG, uniforms: faceU })));
  faceMat.depthWrite = true;
  faceMat.side = THREE.DoubleSide;
  const dotMat = own(additive(new THREE.ShaderMaterial({ vertexShader: S.DOTS_VERT, fragmentShader: S.POINT_FRAG, uniforms: faceU })));
  dotMat.depthTest = true;
  const rimMat = own(additive(new THREE.ShaderMaterial({ vertexShader: S.RIM_VERT, fragmentShader: S.RIM_FRAG, uniforms: { ...U, uGlow: { value: 1 } } })));
  rimMat.depthTest = false;
  rimMat.side = THREE.DoubleSide;
  const shellMat = own(additive(new THREE.ShaderMaterial({ vertexShader: S.SHELL_VERT, fragmentShader: S.SHELL_FRAG, uniforms: U })));
  shellMat.side = THREE.DoubleSide;
  const envMat = sparkMat(U.uPresence, 10, own);
  const nodeMat = sparkMat(U.uPresence, 0, own);
  const wireMat = own(
    additive(
      new THREE.ShaderMaterial({
        vertexShader: S.LINE_VERT,
        fragmentShader: S.LINE_FRAG,
        uniforms: { ...U, uColor: { value: rgb(0xa7cbf9) }, uFade: U.uPresence },
      }),
    ),
  );
  wireMat.depthTest = false;

  // Halo behind the head (a cheap bloom) and the neck column: one quad each, placed per face.
  const unitQuad = own(new THREE.PlaneGeometry(2, 2));
  const haloU = { ...U, uHalf: { value: new THREE.Vector2(1, 1) }, uColor: { value: rgb(0x2f4a9a) }, uGain: { value: 0.55 }, uFade: U.uPresence };
  const haloMat = own(additive(new THREE.ShaderMaterial({ vertexShader: S.QUAD_VERT, fragmentShader: S.GLOW_FRAG, uniforms: haloU })));
  haloMat.depthTest = false;
  const halo = new THREE.Mesh(unitQuad, haloMat);
  halo.renderOrder = 5;
  halo.visible = false;
  head.add(halo);
  const neckU = { ...U, uHalf: { value: new THREE.Vector2(1, 1) }, uTopHalfW: { value: 1 }, uColumns: { value: new THREE.Vector2() } };
  const neckMat = own(additive(new THREE.ShaderMaterial({ vertexShader: S.QUAD_VERT, fragmentShader: S.NECK_FRAG, uniforms: neckU })));
  neckMat.depthTest = false;
  const neck = new THREE.Mesh(unitQuad, neckMat);
  neck.renderOrder = 8;
  neck.visible = false;
  scene.add(neck);

  let mesh: ScanMesh | null = null;
  let surface: FaceSurface | null = null;
  let faceDisposables: { dispose(): void }[] = [];
  const faceOwn = <T extends { dispose(): void }>(x: T): T => {
    faceDisposables.push(x);
    return x;
  };
  let zoneCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  let featCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  let zoneTex: THREE.CanvasTexture | null = null;
  let featTex: THREE.CanvasTexture | null = null;
  let nodes: THREE.Points | null = null;
  let highlights: RegionHighlight[] = [];
  let active: FaceRegionKey | null = null;
  const presenceTarget = { face: 0, zones: 0, active: 0 };

  function clearFace(): void {
    for (const d of faceDisposables) d.dispose();
    faceDisposables = [];
    nodes?.geometry.dispose();
    nodes = null;
    faceParts.clear();
    halo.visible = neck.visible = false;
    zoneTex = featTex = null;
    zoneCanvas = featCanvas = null;
    faceU.uZones.value = blank;
    faceU.uFeatures.value = blank;
    surface = null;
  }

  function uvPx(size: number): (i: number) => [number, number] {
    const uvs = surface!.uvs;
    return (i) => [uvs[i * 2] * size, (1 - uvs[i * 2 + 1]) * size];
  }

  function paintZoneTexture(): void {
    if (!surface || !zoneCanvas || !zoneTex) return;
    const size = zoneCanvas.width;
    const ctx = zoneCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;
    paintZones(ctx, size, uvPx(size), highlights);
    zoneTex.needsUpdate = true;
  }

  function paintFeatureTexture(): void {
    if (!surface || !featCanvas || !featTex) return;
    const size = featCanvas.width;
    const ctx = featCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;
    paintFeatures(ctx, size, uvPx(size), active);
    featTex.needsUpdate = true;
  }

  function points(positions: number[], size: number[], alpha: number[], colours: number[], seeds: number[], mat: THREE.ShaderMaterial, order: number): THREE.Points {
    const p = sparks(positions, size, alpha, colours, seeds, mat);
    faceOwn(p.geometry);
    p.renderOrder = order;
    faceParts.add(p);
    return p;
  }

  function buildNodes(): void {
    if (nodes) {
      faceParts.remove(nodes);
      nodes.geometry.dispose();
      nodes = null;
    }
    if (!surface) return;
    const P: number[] = [], Sz: number[] = [], A: number[] = [], C: number[] = [], Sd: number[] = [];
    const pos = surface.positions, nrm = surface.normals;
    for (const h of highlights) {
      for (const i of REGION_NODES[h.region]) {
        if (i >= surface.landmarkCount) continue;
        P.push(pos[i * 3] + nrm[i * 3] * 2, pos[i * 3 + 1] + nrm[i * 3 + 1] * 2, pos[i * 3 + 2] + nrm[i * 3 + 2] * 2);
        Sz.push(2.4);
        A.push(0.9 * Math.max(0, Math.min(1, h.strength)));
        C.push(1, 0.98, 1);
        Sd.push(i / 478);
      }
    }
    if (!P.length) return;
    nodes = sparks(P, Sz, A, C, Sd, nodeMat);
    nodes.renderOrder = 14;
    faceParts.add(nodes);
  }

  function buildFace(): void {
    clearFace();
    if (!mesh) return;
    const q = QUALITY[quality];
    const surf = buildFaceSurface(mesh, FACE_SLOT);
    surface = surf;
    const { minX, maxX, minY, maxY, minZ, maxZ } = surf.bounds;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const faceW = maxX - minX, faceH = maxY - minY;
    pivot.position.set(cx, cy, cz);
    head.position.set(-cx, -cy, -cz);
    faceU.uTopY.value = maxY;
    faceU.uFaceH.value = faceH;

    // Textures in the face's frontal UV space.
    zoneCanvas = makeCanvas(q.tex);
    featCanvas = makeCanvas(q.tex);
    if (zoneCanvas && featCanvas) {
      zoneTex = faceOwn(new THREE.CanvasTexture(zoneCanvas as HTMLCanvasElement));
      featTex = faceOwn(new THREE.CanvasTexture(featCanvas as HTMLCanvasElement));
      for (const t of [zoneTex, featTex]) {
        t.colorSpace = THREE.NoColorSpace;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
      }
      faceU.uZones.value = zoneTex;
      faceU.uFeatures.value = featTex;
      paintZoneTexture();
      paintFeatureTexture();
    }

    // The surface.
    const g = faceOwn(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(surf.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(surf.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(surf.uvs, 2));
    g.setAttribute('aEdge', new THREE.BufferAttribute(surf.edge, 1));
    g.setAttribute('aEye', new THREE.BufferAttribute(surf.eye, 1));
    g.setAttribute('aMouth', new THREE.BufferAttribute(surf.mouth, 1));
    g.setAttribute('aCavity', new THREE.BufferAttribute(surf.cavity, 1));
    g.setIndex(new THREE.BufferAttribute(surf.indices, 1));
    const face = new THREE.Mesh(g, faceMat);
    face.renderOrder = 10;
    face.frustumCulled = false;
    faceParts.add(face);

    // The dot lattice.
    const lat = sampleLattice(surf, q.pitch);
    const dg = faceOwn(new THREE.BufferGeometry());
    dg.setAttribute('position', new THREE.BufferAttribute(lat.positions, 3));
    dg.setAttribute('aNormal', new THREE.BufferAttribute(lat.normals, 3));
    dg.setAttribute('aUv', new THREE.BufferAttribute(lat.uvs, 2));
    dg.setAttribute('aEdge', new THREE.BufferAttribute(lat.edge, 1));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(lat.seeds, 1));
    const dots = new THREE.Points(dg, dotMat);
    dots.renderOrder = 12;
    dots.frustumCulled = false;
    faceParts.add(dots);

    // The silhouette rim: a ribbon along the smoothed outline, strongest on the jaw and
    // cheeks, fading over the top (the head shell's own rim carries on from there) and
    // easing off under the chin, where the neck takes over.
    {
      const loop = surf.oval.map((i) => [surf.positions[i * 3], surf.positions[i * 3 + 1]] as [number, number]);
      const zOf = new Map<number, number>();
      surf.oval.forEach((i, k) => zOf.set(k, surf.positions[i * 3 + 2]));
      const steps = 5;
      const pts = smoothLoop(loop, steps);
      const n = pts.length;
      const P: number[] = [], side: number[] = [], weight: number[] = [], idx: number[] = [];
      const inner = 2, outer = 30;
      for (let k = 0; k < n; k++) {
        const [x, y] = pts[k];
        const [x0, y0] = pts[(k - 1 + n) % n];
        const [x1, y1] = pts[(k + 1) % n];
        let nx = y1 - y0, ny = -(x1 - x0);
        const l = Math.hypot(nx, ny) || 1;
        nx /= l;
        ny /= l;
        if (nx * (x - cx) + ny * (y - cy) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const z = zOf.get(Math.floor(k / steps)) ?? minZ;
        const up = (y - cy) / (faceH / 2); // -1 chin .. 1 top
        const under = Math.max(0, -ny - 0.6) / 0.4; // 1 straight under the chin
        const w = (1 - 0.92 * Math.max(0, Math.min(1, (up - 0.2) / 0.55))) * (0.8 + 0.2 * Math.max(0, -nx)) * (1 - 0.4 * under);
        P.push(x - nx * inner, y - ny * inner, z, x + nx * outer, y + ny * outer, z);
        side.push(-inner, outer);
        weight.push(w, w);
        const a = k * 2, b = ((k + 1) % n) * 2;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const rg = faceOwn(new THREE.BufferGeometry());
      rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      rg.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
      rg.setAttribute('aWeight', new THREE.Float32BufferAttribute(weight, 1));
      rg.setIndex(idx);
      const rim = new THREE.Mesh(rg, rimMat);
      rim.renderOrder = 13;
      rim.frustumCulled = false;
      faceParts.add(rim);
    }

    // The head shell, and the decoration that hangs on it: drifting particles over and
    // just outside it, and a sparse constellation of smooth arcs with nodes where they
    // cross. All of it is geometric and abstract; it is not hair and not measured.
    const shell = buildCraniumShell(surf);
    {
      const sg = faceOwn(new THREE.BufferGeometry());
      sg.setAttribute('position', new THREE.BufferAttribute(shell.positions, 3));
      sg.setAttribute('normal', new THREE.BufferAttribute(shell.normals, 3));
      sg.setAttribute('aS', new THREE.BufferAttribute(shell.s, 1));
      sg.setAttribute('aSide', new THREE.BufferAttribute(shell.side, 1));
      sg.setIndex(new THREE.BufferAttribute(shell.indices, 1));
      const sm = new THREE.Mesh(sg, shellMat);
      sm.renderOrder = 9;
      sm.frustumCulled = false;
      faceParts.add(sm);
    }
    const pt = [0, 0, 0, 0, 0, 0];
    {
      const rnd = seeded(1234);
      const P: number[] = [], Sz: number[] = [], A: number[] = [], C: number[] = [], Sd: number[] = [];
      const blue = [0.655, 0.796, 0.976], white = [0.875, 0.949, 1];
      for (let i = 0; i < q.envelope; i++) {
        // Spread evenly over the shell's area (its rings shorten toward the crown).
        shellPoint(shell, rnd(), 0.03 + 0.97 * (1 - Math.sqrt(1 - rnd())), pt);
        const out = rnd() < 0.7 ? rnd() * 6 : 6 + rnd() * 30;
        const grazing = 1 - Math.abs(pt[5]);
        const node = rnd() < 0.06;
        P.push(pt[0] + pt[3] * out, pt[1] + pt[4] * out, pt[2] + pt[5] * out);
        Sz.push(node ? 1.5 + rnd() : 0.7 + rnd() * 0.7);
        A.push((node ? 0.55 + rnd() * 0.3 : 0.14 + rnd() * 0.3) * (0.35 + 0.65 * grazing));
        C.push(...(node ? white : blue));
        Sd.push(rnd());
      }
      points(P, Sz, A, C, Sd, envMat, 6);
    }
    {
      const rnd = seeded(77);
      const LP: number[] = [], LA: number[] = [], LS: number[] = [];
      const NP: number[] = [], NS: number[] = [], NA: number[] = [], NC: number[] = [], ND: number[] = [];
      const arc = (u0: number, u1: number, w0: number, w1: number, lift: number, alpha: number): void => {
        const seg = 36, seed = rnd();
        let prev: number[] | null = null;
        for (let k = 0; k <= seg; k++) {
          const t = k / seg;
          shellPoint(shell, u0 + (u1 - u0) * t, w0 + (w1 - w0) * t, pt);
          const cur = [pt[0] + pt[3] * lift, pt[1] + pt[4] * lift, pt[2] + pt[5] * lift];
          if (prev) {
            const al = alpha * Math.pow(Math.sin(Math.PI * t), 0.5);
            LP.push(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2]);
            LA.push(al, al);
            LS.push(seed, seed);
          }
          prev = cur;
        }
      };
      const node = (u: number, w: number): void => {
        shellPoint(shell, u, w, pt);
        NP.push(pt[0] + pt[3] * 1.5, pt[1] + pt[4] * 1.5, pt[2] + pt[5] * 1.5);
        NS.push(1.4 + rnd() * 1.1);
        NA.push(0.6 + rnd() * 0.3);
        NC.push(0.875, 0.949, 1);
        ND.push(rnd());
      };
      // Rings across the shell and meridians up to the crown, each drawn over part of its length.
      const rings = [0.2, 0.38, 0.56, 0.74].map((w) => ({ w, u0: rnd() * 0.3, u1: 0.7 + rnd() * 0.3 }));
      const meridians = Array.from({ length: 9 }, (_, m) => ({ u: (m + 0.5) / 9 + (rnd() - 0.5) * 0.04, w0: 0.06 + rnd() * 0.2, w1: 0.82 + rnd() * 0.18 }));
      for (const r of rings) arc(r.u0, r.u1, r.w, r.w, 1.5, 0.3);
      for (const m of meridians) arc(m.u, m.u, m.w0, m.w1, 1.5, 0.24);
      for (const r of rings) for (const m of meridians) if (m.u > r.u0 && m.u < r.u1 && r.w > m.w0 && r.w < m.w1 && rnd() < 0.45) node(m.u, r.w);
      // A few arcs floating 10-35 px out from the shell, around its outline.
      for (let a = 0; a < 8; a++) {
        const w = 0.15 + rnd() * 0.7, u0 = rnd() * 0.75;
        arc(u0, Math.min(1, u0 + 0.12 + rnd() * 0.25), w, w + (rnd() - 0.5) * 0.2, 10 + rnd() * 25, 0.45);
      }
      const lg = faceOwn(new THREE.BufferGeometry());
      lg.setAttribute('position', new THREE.Float32BufferAttribute(LP, 3));
      lg.setAttribute('aAlpha', new THREE.Float32BufferAttribute(LA, 1));
      lg.setAttribute('aSeed', new THREE.Float32BufferAttribute(LS, 1));
      const lines = new THREE.LineSegments(lg, wireMat);
      lines.renderOrder = 7;
      lines.frustumCulled = false;
      faceParts.add(lines);
      if (NP.length) points(NP, NS, NA, NC, ND, nodeMat, 7);
    }

    // Halo: centred a little above the face so it takes in the shell.
    halo.position.set(cx, cy + faceH * 0.15, minZ - 40);
    halo.scale.set(faceW * 0.8, faceH * 1.05, 1);
    haloU.uHalf.value.set(faceW * 0.8, faceH * 1.05);
    halo.visible = true;

    // Neck: from well under the chin line (the face covers its top) down into ring A.
    {
      const topY = cy - faceH * 0.3;
      const baseY = -(BASE.ringA.cy + 10);
      const hh = (topY - baseY) / 2, hw = faceW * 0.56;
      neck.position.set(cx, (topY + baseY) / 2, 0);
      neck.scale.set(hw, hh, 1);
      neckU.uHalf.value.set(hw, hh);
      neckU.uTopHalfW.value = faceW * 0.38;
      neckU.uColumns.value.set(-faceH * 0.126, faceH * 0.089);
      neck.visible = true;
    }

    buildNodes();
  }

  // ---- Layout -----------------------------------------------------------------
  // A canvas that is not laid out (display: none, a collapsed panel) reports a
  // zero size: keep the last one instead of guessing, and draw nothing until the
  // canvas has had a real size once.
  let sized = false;
  let bufferDpr = 0;
  function layout(): void {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, QUALITY[quality].dpr, MAX_BUFFER / Math.max(w, h));
    // Resizing the drawing buffer clears and reallocates it: only when something changed.
    if (!sized || w !== cssW || h !== cssH || dpr !== bufferDpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
    }
    sized = true;
    cssW = w;
    cssH = h;
    bufferDpr = dpr;
    const f = fitBox(box, cssW, cssH, fit, align);
    U.uPxScale.value = f.scale * dpr;
    camera.fov = fovFor(f, cssH);
    camera.aspect = cssW / cssH;
    camera.position.set(f.centreX, -f.centreY, CAMERA_DISTANCE);
    camera.lookAt(f.centreX, -f.centreY, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // ---- Motion -------------------------------------------------------------------
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let lastNow = t0;
  let clock = 0;

  function step(now: number): boolean {
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    clock += dt;
    const t = clock;
    U.uTime.value = t;
    const motion = reduced ? 0 : 1;
    U.uMotion.value = motion;

    // Build-in and highlight transitions (instant under reduced motion).
    let settling = false;
    const approach = (cur: number, target: number, rate: number): number => {
      if (reduced) return target;
      const next = cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), rate * dt);
      if (next !== target) settling = true;
      return next;
    };
    U.uPresence.value = approach(U.uPresence.value, presenceTarget.face, 1.4);
    faceU.uZoneMix.value = approach(faceU.uZoneMix.value, presenceTarget.zones, 1.8);
    faceU.uActiveMix.value = approach(faceU.uActiveMix.value, presenceTarget.active, 3.5);

    // Idle: yaw of +-4 degrees over 10 s, float of +-3 px over 6 s, zones breathe over 2.4 s.
    pivot.rotation.y = motion * Math.sin((t * Math.PI * 2) / 10) * THREE.MathUtils.degToRad(4);
    pivot.position.y = (surface ? (surface.bounds.minY + surface.bounds.maxY) / 2 : 0) + motion * Math.sin((t * Math.PI * 2) / 6) * 3;
    faceU.uBreath.value = motion ? 0.8 + 0.2 * Math.sin((t * Math.PI * 2) / 2.4) : 1;

    // Scan band: sweeps top to bottom in 3 s of every 4 s.
    if (surface && motion) {
      const ph = (t % 4) / 3;
      faceU.uScanOn.value = ph < 1 ? Math.sin(Math.PI * ph) : 0;
      faceU.uScanY.value = surface.bounds.maxY + 12 - ph * (surface.bounds.maxY - surface.bounds.minY + 24);
    } else {
      faceU.uScanOn.value = 0;
    }
    return settling;
  }

  // ---- Anchors ------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();
  function computeAnchors(): HologramAnchors {
    const out = emptyAnchors();
    if (!surface || !sized) return out;
    scene.updateMatrixWorld();
    normalMat.getNormalMatrix(head.matrixWorld);
    for (const k of FACE_REGIONS) {
      const i = ANCHOR_LANDMARK[k];
      if (i >= surface.landmarkCount) continue;
      tmp.fromArray(surface.positions, i * 3).applyMatrix4(head.matrixWorld);
      tmpN.fromArray(surface.normals, i * 3).applyMatrix3(normalMat).normalize();
      const facing = tmpN.dot(tmpV.copy(camera.position).sub(tmp).normalize());
      tmp.project(camera);
      const x = ((tmp.x + 1) / 2) * cssW;
      const y = ((1 - tmp.y) / 2) * cssH;
      const inside = x >= 0 && x <= cssW && y >= 0 && y <= cssH;
      out[k] = { x, y, visible: U.uPresence.value > 0.5 && facing > -0.2 && inside };
    }
    return out;
  }

  let lastAnchors: HologramAnchors = emptyAnchors();
  function publishAnchors(): void {
    if (!options.onAnchors) return;
    const next = computeAnchors();
    let changed = false;
    for (const k of FACE_REGIONS) {
      const a = next[k], b = lastAnchors[k];
      if (a.visible !== b.visible || Math.abs(a.x - b.x) > 0.25 || Math.abs(a.y - b.y) > 0.25) {
        changed = true;
        break;
      }
    }
    if (changed) {
      lastAnchors = next;
      options.onAnchors(next);
    }
  }

  // ---- Loop ---------------------------------------------------------------------
  const hasRaf = typeof requestAnimationFrame === 'function';
  let raf = 0;
  let paused = false;
  let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  let inView = true;
  let lost = false;
  let disposed = false;
  let lastFrame = 0;
  // Auto quality: frames are timed over two-second windows.
  let winStart = 0;
  let winFrames = 0;

  const canRun = (): boolean => !disposed && !paused && !hidden && inView && !lost && sized;
  const fpsCap = (): number => Math.min(options.maxFps ?? (touch ? 30 : 60), QUALITY[quality].fps);

  function renderNow(now: number): boolean {
    const settling = step(now);
    renderer.render(scene, camera);
    publishAnchors();
    return settling;
  }

  function frame(now: number): void {
    raf = 0;
    if (!canRun()) return;
    const interval = 1000 / fpsCap();
    if (lastFrame && now - lastFrame < interval - 3) {
      raf = requestAnimationFrame(frame);
      return;
    }
    lastFrame = now;
    const settling = renderNow(now);

    // Auto quality: a two-second window whose frames averaged slower than 1.5x the
    // frame budget (under 2/3 of the cap) steps down one level.
    if (autoQ && quality !== 'low' && !reduced) {
      if (!winStart) {
        winStart = now;
        winFrames = 0;
      } else if (++winFrames && now - winStart >= 2000) {
        const slow = (now - winStart) / winFrames > interval * 1.5;
        winStart = 0;
        if (slow) applyQuality(ORDER[ORDER.indexOf(quality) - 1]);
      }
    }

    if (!reduced || settling) raf = requestAnimationFrame(frame);
  }

  /** Asks for a frame; under reduced motion frames are only drawn when something changed. */
  function invalidate(): void {
    if (!canRun()) return;
    if (!hasRaf) {
      renderNow(typeof performance !== 'undefined' ? performance.now() : 0);
      return;
    }
    if (!raf) {
      lastFrame = 0;
      winStart = 0;
      lastNow = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function stop(): void {
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
  }

  function applyQuality(next: HologramQuality): void {
    if (next === quality) return;
    quality = next;
    winStart = 0;
    layout();
    if (mesh) buildFace();
    invalidate();
  }

  // ---- Environment hooks ----------------------------------------------------------
  const onVisibility = (): void => {
    hidden = document.visibilityState === 'hidden';
    if (hidden) stop();
    else invalidate();
  };
  const onLost = (e: Event): void => {
    e.preventDefault();
    lost = true;
    stop();
  };
  const onRestored = (): void => {
    lost = false;
    if (mesh) buildFace();
    invalidate();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener?.('webglcontextlost', onLost);
  canvas.addEventListener?.('webglcontextrestored', onRestored);
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          inView = entries.some((e) => e.isIntersecting);
          if (inView) invalidate();
          else stop();
        })
      : null;
  io?.observe(canvas);
  const ro =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          layout();
          invalidate();
        })
      : null;
  ro?.observe(canvas);

  layout();
  invalidate();

  return {
    supported: true,
    setMesh(next) {
      if (disposed) return;
      mesh = next;
      if (mesh) {
        buildFace();
        presenceTarget.face = 1;
        presenceTarget.zones = highlights.length ? 1 : 0;
      } else {
        clearFace();
        U.uPresence.value = 0;
        presenceTarget.face = 0;
        lastAnchors = emptyAnchors();
        options.onAnchors?.(emptyAnchors());
      }
      invalidate();
    },
    setRegions(next) {
      if (disposed) return;
      highlights = next.filter((h) => FACE_REGIONS.includes(h.region)).map((h) => ({ ...h }));
      presenceTarget.zones = highlights.length ? 1 : 0;
      paintZoneTexture();
      buildNodes();
      invalidate();
    },
    setActiveRegion(region) {
      if (disposed || region === active) return;
      active = region;
      paintFeatureTexture();
      faceU.uActiveMix.value = 0;
      presenceTarget.active = region ? 1 : 0;
      invalidate();
    },
    anchors() {
      if (disposed) return emptyAnchors();
      return computeAnchors();
    },
    resize() {
      if (disposed) return;
      layout();
      invalidate();
    },
    setQuality(next) {
      if (disposed) return;
      applyQuality(next);
    },
    setReducedMotion(on) {
      if (disposed) return;
      reduced = on;
      invalidate();
    },
    pause() {
      paused = true;
      stop();
    },
    resume() {
      paused = false;
      invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      io?.disconnect();
      ro?.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener?.('webglcontextlost', onLost);
      canvas.removeEventListener?.('webglcontextrestored', onRestored);
      clearFace();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      scene.clear();
      mesh = null;
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}

export type { RegionHighlight, ZoneTone } from './regions.ts';
