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
import { ANCHOR_BLEND, ANCHOR_LANDMARK, REGION_NODES, anchorPoint, paintFeatures, paintZones, type RegionHighlight } from './regions.ts';
import * as S from './shaders.ts';

export type HologramQuality = 'low' | 'medium' | 'high';

export interface HologramAnchor {
  /** CSS px from the canvas's top-left corner. */
  x: number;
  y: number;
  /** False without a face, while it builds in, or when the point faces away or leaves the canvas. */
  visible: boolean;
  /**
   * How far the point stands out of the face plane toward the viewer, in reference px (world
   * units). Set on computed anchors; a figure reaching for the point uses it for depth.
   */
  z?: number;
  /** The point in ref4 px (x right, y down, z toward the viewer): the consult tour's contact point. */
  ref?: { x: number; y: number; z: number };
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

/**
 * A drawing that shares the hologram's canvas, context and frame loop, drawn
 * under it every frame (the Scan page's character prototype). It inherits the
 * engine's DPR cap and quality steps, its pauses (hidden tab, off-screen,
 * context loss) and its reduced-motion rule: under reduced motion frames are
 * only drawn while something changes, so `draw` returns true for as long as it
 * is still moving. The engine owns a pass it is given and disposes it.
 */
export interface HologramPass {
  draw(frame: HologramPassFrame): boolean;
  dispose(): void;
}

export interface HologramPassFrame {
  /** The engine's renderer: the pass renders its own scene and camera into the cleared buffer. */
  renderer: THREE.WebGLRenderer;
  /** Seconds since the last frame (0 on a first frame, at most 0.1). */
  dt: number;
  /** Canvas CSS size. */
  cssW: number;
  cssH: number;
  /** The region anchors of this frame (CSS px of the canvas, with depth). */
  anchors: HologramAnchors;
  reducedMotion: boolean;
}

export interface HologramOptions {
  /** Which part of the reference frame the canvas shows. Default `HOLOGRAM_BOX` (x 560-1110, y 0-620 of ref4). */
  box?: RefBox;
  /**
   * The reference point the camera sits straight in front of. Default: the point at the canvas
   * centre. A canvas enlarged beyond `HOLOGRAM_BOX` (to take in a figure beside the pedestal)
   * passes that box's centre here, so the head is drawn exactly as on the default canvas: same
   * eye, same parallax, only a wider window (an off-axis view).
   */
  eye?: { x: number; y: number };
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
  /**
   * Called once per mesh when the face has fully formed (its build-in reached the end; at once under
   * reduced motion, on the first frame drawn with it). The consult tour starts from here.
   */
  onFormed?: () => void;
  /** The clock the tap ripple runs on, in ms (default `performance.now`); the tour passes its own. */
  clock?: () => number;
  /** Tests only: draw with this instead of a WebGL renderer. */
  renderer?: HologramRenderer;
}

export interface HologramController {
  /** False when WebGL could not start; every method is then a no-op and the page should show its own fallback. */
  readonly supported: boolean;
  /** The live session mesh, or null to clear the face (rings only). */
  setMesh(mesh: ScanMesh | null): void;
  /**
   * Which regions glow, in which tone, how strongly. Replaces the previous set; a new set fades in
   * over about 550 ms. Emptying it fades the zones out over `fadeOutMs` (default 550; 0 under
   * reduced motion) before their texture is cleared.
   */
  setRegions(highlights: RegionHighlight[], opts?: { fadeOutMs?: number }): void;
  /** The region being talked about right now: brighter, with its dots lifted. */
  setActiveRegion(region: FaceRegionKey | null): void;
  /**
   * The tap (consult tour): one ring spreading from the region's anchor over the face surface and
   * its dots, with a bloom on the spot. No-op without a face and under reduced motion.
   */
  pulse(region: FaceRegionKey): void;
  /** The projected face oval's bounding box, CSS px of the canvas, or null without a face. */
  faceBounds(): { x: number; y: number; w: number; h: number } | null;
  /** Where each region's anchor is on the canvas right now (CSS px). */
  anchors(): HologramAnchors;
  /** Re-reads the canvas's CSS size. Called automatically on resize where ResizeObserver exists. */
  resize(): void;
  setQuality(quality: HologramQuality): void;
  setReducedMotion(on: boolean): void;
  /** Stops drawing until `resume()` (the engine also pauses itself when hidden or off-screen). */
  pause(): void;
  resume(): void;
  /** Draws `pass` under the hologram every frame (null removes it). The engine disposes a pass it is given. */
  setPass(pass: HologramPass | null): void;
  /** Asks for a frame now (under reduced motion frames are otherwise only drawn when the engine changes). */
  redraw(): void;
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
  pulse() {},
  faceBounds: () => null,
  anchors: emptyAnchors,
  resize() {},
  setQuality() {},
  setReducedMotion() {},
  pause() {},
  resume() {},
  setPass(pass) {
    pass?.dispose();
  },
  redraw() {},
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
    uFaceC: { value: new THREE.Vector2(0, 0) },
    uFaceW: { value: FACE_SLOT.height * 0.75 },
    // The tap ripple (pulse): centre in world units, ring radius and width, strength, bloom.
    uRipC: { value: new THREE.Vector3() },
    uRipR: { value: 0 },
    uRipW: { value: 10 },
    uRipA: { value: 0 },
    uBloomA: { value: 0 },
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
  // The zones' own sparkle fades with the zones.
  const zoneNodeMat = sparkMat(faceU.uZoneMix, 0, own);
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
  const haloU = { ...U, uHalf: { value: new THREE.Vector2(1, 1) }, uColor: { value: rgb(0x3a58b0) }, uGain: { value: 0.42 }, uFade: U.uPresence };
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
  /** How fast the zones fade (mix per second): in over ~550 ms, out at the caller's pace. */
  const ZONE_RATE = 1.8;
  let zoneRate = ZONE_RATE;
  /** A set waiting for the zones to finish fading out before it is painted. */
  let nextZones: RegionHighlight[] | null = null;
  /** The face formed: `onFormed` has fired for this mesh (or is due once this frame is drawn). */
  let formed = false;
  let formedDue = false;
  /** The tap in flight: where (in the head's own space, so it rides the head) and when. */
  const rippleClock = options.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
  let ripple: { local: THREE.Vector3; at: number } | null = null;
  const RIPPLE_MS = 700;

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

  function applyZones(list: RegionHighlight[]): void {
    highlights = list;
    zoneRate = ZONE_RATE;
    presenceTarget.zones = highlights.length ? 1 : 0;
    paintZoneTexture();
    buildNodes();
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
    nodes = sparks(P, Sz, A, C, Sd, zoneNodeMat);
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
    faceU.uFaceC.value.set(cx, cy);
    faceU.uFaceW.value = faceW;

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
        A.push((node ? 0.5 + rnd() * 0.3 : 0.12 + rnd() * 0.26) * (0.2 + 0.8 * grazing));
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
      // A few faint meridians up toward the crown, each over part of its length, with
      // a node or two on them. No rings across the shell: a latitude grid over the
      // head read as a swim cap, and the hologram is a face, not a helmet.
      const meridians = Array.from({ length: 5 }, (_, m) => ({ u: (m + 0.5) / 5 + (rnd() - 0.5) * 0.06, w0: 0.1 + rnd() * 0.25, w1: 0.55 + rnd() * 0.35 }));
      for (const m of meridians) arc(m.u, m.u, m.w0, m.w1, 2, 0.13);
      // A wireframe of hair (ref4): fine strands from the hairline sweeping back over
      // the crown, leaning toward the middle, so the head reads as a hologram of a
      // head rather than a bald shell. Lines of light only; nothing measured.
      const strands = 30;
      for (let h = 0; h < strands; h++) {
        const u = 0.03 + (0.94 * (h + 0.2 + rnd() * 0.6)) / strands;
        const lean = (0.5 - u) * (0.18 + rnd() * 0.14);
        arc(u, u + lean, 0.02 + rnd() * 0.1, 0.72 + rnd() * 0.28, 1 + rnd() * 3, 0.2 + rnd() * 0.16);
      }
      for (const m of meridians) if (rnd() < 0.7) node(m.u, m.w0 + (m.w1 - m.w0) * (0.3 + rnd() * 0.5));
      // A few arcs floating 10-35 px out from the shell, around its outline.
      for (let a = 0; a < 8; a++) {
        const w = 0.15 + rnd() * 0.7, u0 = rnd() * 0.75;
        arc(u0, Math.min(1, u0 + 0.12 + rnd() * 0.25), w, w + (rnd() - 0.5) * 0.2, 10 + rnd() * 25, 0.34);
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

    // Halo: a faint glow behind the face itself. It used to sit higher, to take in
    // the shell, and filled the crown with a blue wash bounded by the shell's rim,
    // which read as a hood; the crown is now left to the rim and the particles.
    halo.position.set(cx, cy + faceH * 0.02, minZ - 40);
    halo.scale.set(faceW * 0.72, faceH * 0.78, 1);
    haloU.uHalf.value.set(faceW * 0.72, faceH * 0.78);
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
    // The eye: the canvas centre, or a point the caller pins (an enlarged canvas keeps the
    // default canvas's eye). Off the canvas centre, the canvas is a window cut from a larger
    // symmetric view around the eye (a view offset), so nothing about the head changes.
    const ex = options.eye?.x ?? f.centreX;
    const ey = options.eye?.y ?? f.centreY;
    const dx = (f.centreX - ex) * f.scale;
    const dy = (f.centreY - ey) * f.scale;
    const fullW = cssW + 2 * Math.abs(dx);
    const fullH = cssH + 2 * Math.abs(dy);
    camera.fov = fovFor(f, fullH);
    camera.aspect = fullW / fullH;
    camera.position.set(ex, -ey, CAMERA_DISTANCE);
    camera.lookAt(ex, -ey, 0);
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
      camera.setViewOffset(fullW, fullH, fullW / 2 + dx - cssW / 2, fullH / 2 + dy - cssH / 2, cssW, cssH);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // ---- Motion -------------------------------------------------------------------
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let lastNow = t0;
  let clock = 0;
  let lastDt = 0;

  function step(now: number): boolean {
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
    lastDt = dt;
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
    faceU.uZoneMix.value = approach(faceU.uZoneMix.value, presenceTarget.zones, zoneRate);
    faceU.uActiveMix.value = approach(faceU.uActiveMix.value, presenceTarget.active, 3.5);
    // Zones that faded out are cleared (or replaced by the set waiting for them) only now.
    if (nextZones && faceU.uZoneMix.value <= 0) {
      applyZones(nextZones);
      nextZones = null;
    }
    if (surface && !formed && U.uPresence.value >= 1) {
      formed = true;
      formedDue = true;
    }
    if (stepRipple()) settling = true;

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

  // ---- The tap ripple -------------------------------------------------------------
  const rippleWorld = new THREE.Vector3();
  /** Advances the ripple's uniforms; true while it is still spreading or its bloom settling. */
  function stepRipple(): boolean {
    if (!ripple || !surface) {
      faceU.uRipA.value = 0;
      faceU.uBloomA.value = 0;
      return false;
    }
    const ms = rippleClock() - ripple.at;
    const t = Math.max(0, Math.min(1, ms / RIPPLE_MS));
    const e = 1 - Math.pow(1 - t, 3);
    rippleWorld.copy(ripple.local).applyMatrix4(head.matrixWorld);
    faceU.uRipC.value.copy(rippleWorld);
    faceU.uRipR.value = 72 * e;
    faceU.uRipW.value = 10 + 8 * e;
    faceU.uRipA.value = t >= 1 ? 0 : 0.55 * Math.pow(1 - t, 1.5);
    // The bloom peaks at 120 ms and settles by 500 ms.
    faceU.uBloomA.value = ms < 120 ? 0.9 * Math.max(0, ms) / 120 : ms < 500 ? 0.9 - 0.75 * ((ms - 120) / 380) : 0;
    if (ms >= Math.max(RIPPLE_MS, 500)) {
      ripple = null;
      faceU.uRipA.value = 0;
      faceU.uBloomA.value = 0;
      return false;
    }
    return true;
  }

  // ---- Anchors ------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();
  const anchorXyz: [number, number, number] = [0, 0, 0];
  function computeAnchors(): HologramAnchors {
    const out = emptyAnchors();
    if (!surface || !sized) return out;
    scene.updateMatrixWorld();
    normalMat.getNormalMatrix(head.matrixWorld);
    for (const k of FACE_REGIONS) {
      const i = ANCHOR_LANDMARK[k];
      const toward = ANCHOR_BLEND[k]?.toward ?? i;
      if (i >= surface.landmarkCount || toward >= surface.landmarkCount) continue;
      tmp.fromArray(anchorPoint(surface.positions, k, anchorXyz)).applyMatrix4(head.matrixWorld);
      tmpN.fromArray(surface.normals, i * 3).applyMatrix3(normalMat).normalize();
      const facing = tmpN.dot(tmpV.copy(camera.position).sub(tmp).normalize());
      const z = tmp.z;
      const ref = { x: tmp.x, y: -tmp.y, z };
      tmp.project(camera);
      const x = ((tmp.x + 1) / 2) * cssW;
      const y = ((1 - tmp.y) / 2) * cssH;
      const inside = x >= 0 && x <= cssW && y >= 0 && y <= cssH;
      out[k] = { x, y, visible: U.uPresence.value > 0.5 && facing > -0.2 && inside, z, ref };
    }
    return out;
  }

  let lastAnchors: HologramAnchors = emptyAnchors();
  function publishAnchors(computed?: HologramAnchors): void {
    if (!options.onAnchors) return;
    const next = computed ?? computeAnchors();
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

  /** The face oval (its silhouette landmarks) projected onto the canvas: its bounding box. */
  function computeFaceBounds(): { x: number; y: number; w: number; h: number } | null {
    if (!surface || !sized) return null;
    scene.updateMatrixWorld();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of surface.oval) {
      tmp.fromArray(surface.positions, i * 3).applyMatrix4(head.matrixWorld).project(camera);
      const x = ((tmp.x + 1) / 2) * cssW;
      const y = ((1 - tmp.y) / 2) * cssH;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
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

  let pass: HologramPass | null = null;
  function tellFormed(): void {
    if (!formedDue) return;
    formedDue = false;
    options.onFormed?.();
  }

  function renderNow(now: number): boolean {
    const settling = step(now);
    if (!pass) {
      renderer.render(scene, camera);
      publishAnchors();
      tellFormed();
      return settling;
    }
    // The pass draws first into the cleared buffer; the hologram is light over it, on a
    // fresh depth buffer (it is nearer the viewer than anything the pass draws).
    const anchors = computeAnchors();
    const gl = renderer as HologramRenderer & Partial<Pick<THREE.WebGLRenderer, 'autoClear' | 'clear' | 'clearDepth'>>;
    const layered = typeof gl.clear === 'function' && typeof gl.clearDepth === 'function';
    if (layered) {
      gl.autoClear = false;
      gl.clear!();
    }
    let busy = false;
    try {
      busy = pass.draw({ renderer: renderer as THREE.WebGLRenderer, dt: lastDt, cssW, cssH, anchors, reducedMotion: reduced });
    } catch (err) {
      // A broken pass must never take the reading down with it.
      console.warn('[hologram] pass failed and was removed', err);
      pass.dispose();
      pass = null;
    }
    if (layered) gl.clearDepth!();
    renderer.render(scene, camera);
    if (layered) gl.autoClear = true;
    publishAnchors(anchors);
    tellFormed();
    return settling || busy;
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
      if (next !== mesh) formed = false;
      mesh = next;
      ripple = null;
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
    setRegions(next, opts) {
      if (disposed) return;
      const list = next.filter((h) => FACE_REGIONS.includes(h.region)).map((h) => ({ ...h }));
      const fadeOutMs = reduced ? 0 : Math.max(0, opts?.fadeOutMs ?? 550);
      if (!list.length && highlights.length && fadeOutMs > 0 && faceU.uZoneMix.value > 0) {
        // Fade the zones out first; their texture is cleared when the mix reaches 0 (step()).
        nextZones = list;
        zoneRate = 1000 / fadeOutMs;
        presenceTarget.zones = 0;
        invalidate();
        return;
      }
      nextZones = null;
      applyZones(list);
      invalidate();
    },
    pulse(region) {
      if (disposed || reduced || !surface || !FACE_REGIONS.includes(region)) return;
      const i = ANCHOR_LANDMARK[region];
      const toward = ANCHOR_BLEND[region]?.toward ?? i;
      if (i >= surface.landmarkCount || toward >= surface.landmarkCount) return;
      ripple = { local: new THREE.Vector3().fromArray(anchorPoint(surface.positions, region, anchorXyz)), at: rippleClock() };
      invalidate();
    },
    faceBounds() {
      if (disposed) return null;
      return computeFaceBounds();
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
    setPass(next) {
      if (disposed) {
        next?.dispose();
        return;
      }
      if (pass && pass !== next) pass.dispose();
      pass = next;
      invalidate();
    },
    redraw() {
      if (disposed) return;
      invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      // The pass draws with this context: its resources go before the context does.
      pass?.dispose();
      pass = null;
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
