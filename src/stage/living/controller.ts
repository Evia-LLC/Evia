/**
 * The living plate: a small WebGL2 canvas laid over a Room's plate that
 * redraws it with its motions (shader.ts), driven by the room's masks.
 *
 * Loaded lazily by Room.svelte (a dynamic import), after the plate itself is
 * on screen, so neither the entry chunk nor the first paint pays for it.
 *
 * Lifecycle:
 *   still        reduced motion (system or the app's own setting): nothing is
 *                loaded or drawn; the plate stays exactly as rendered. Turning
 *                reduced motion off later brings the room to life.
 *   loading      the masks are fetched (a few hundred KB per room) and uploaded.
 *   live         drawn at the room's ambient rate (30 fps; the sidebar strip
 *                15), paused while the tab is hidden or the room is off
 *                screen, slowed after two minutes without input and stopped
 *                after ten (the next touch resumes it where it was). Its first
 *                frame is the plate exactly, and every effect eases in over
 *                2.5 s, so the canvas fades in over the picture without a seam.
 *   unsupported  no WebGL2, a lost context or a failed load: Room shows its
 *                CSS fallback (breathing glow layer, lamp halos) instead. A
 *                lost context that the browser restores comes back to life.
 */
import type { Fit, Point, RoomAnchors, RoomId } from '../room-anchors.ts';
import {
  LAMP_SLEW,
  NOISE_PERIOD,
  aircraft,
  beacon,
  breath,
  gust,
  hash01,
  lampGain,
  slew,
  stripWaves,
} from './envelope.ts';
import { viewer, useViewer } from './input.ts';
import {
  depthAt,
  parallaxFactor,
  planLiving,
  sameRegion,
  skyLane,
  visibleRegion,
  type Box,
  type LivingPlan,
  type Region,
  type TextureKey,
  type TexturePlan,
} from './scene.ts';
import {
  LivingClock,
  ambientFps,
  backingSize,
  frameBudget,
  isDue,
  isLowPower,
  livingMode,
  motionReduced,
  type FrameBudget,
  type LivingMode,
} from './schedule.ts';
import { VERTEX, fragmentSource } from './shader.ts';
import { tuningFor } from './tuning.ts';

export type LivingState = 'still' | 'loading' | 'live' | 'unsupported';

export interface LivingGeometry {
  /** Where the plate lands in the room's box (Room's fit). */
  fit: Fit;
  /** The room's box, CSS px. */
  boxW: number;
  boxH: number;
}

export interface LivingOptions {
  /** The room element (its box is what `fit` is relative to). */
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The room's overlay layer: it gets --living-dx/--living-dy (px) for depth parallax. */
  overlay?: HTMLElement | null;
  room: RoomId;
  anchors: RoomAnchors;
  /** The plate the page shows (the <img>'s currentSrc). */
  plateUrl: string;
  resolve: (src: string) => string;
  blurred?: boolean;
  geometry: LivingGeometry;
  onstate: (state: LivingState) => void;
  /** Told how far a point of the plate moves with the parallax (share of --living-dx/dy), once known. */
  onparallax?: (factorAt: ((point: Point) => number) | null) => void;
}

export interface LivingHandle {
  setGeometry(geometry: LivingGeometry): void;
  destroy(): void;
}

/* ---- one animation loop for every living room on the page ---------------- */

type Frame = (now: number) => void;
const frames = new Set<Frame>();
let raf = 0;
function loop(now: number) {
  raf = 0;
  for (const f of [...frames]) f(now);
  if (frames.size && !document.hidden) raf = requestAnimationFrame(loop);
}
function wake() {
  if (!raf && frames.size && !document.hidden) raf = requestAnimationFrame(loop);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);

/* ---- input: nobody touching the page slows the rooms, then stops them ------ */

let lastInput = typeof performance !== 'undefined' ? performance.now() : 0;
/** Rooms stopped for idleness: woken by the next input. */
const sleepers = new Set<() => void>();
let watchingInput = false;
function onInput() {
  lastInput = performance.now();
  if (sleepers.size) for (const wakeRoom of [...sleepers]) wakeRoom();
}
function watchInput() {
  if (watchingInput || typeof window === 'undefined') return;
  watchingInput = true;
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(type, onInput, { passive: true, capture: true });
  }
}

/* ---- capture hook (development): freeze the clock and step it by hand ---- */

interface Debug {
  /** Draw every effect at zero (the plate as rendered): for checking the canvas against the picture. */
  quiet: boolean;
  frozen: boolean;
  at: number | null;
  pointer: { x: number; y: number } | null;
  rooms: Set<{ room: RoomId; redraw(): void; state(): LivingState; bench(frames: number): unknown }>;
}
const debug: Debug = { quiet: false, frozen: false, at: null, pointer: null, rooms: new Set() };
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __eviaLiving: unknown }).__eviaLiving = {
    /** Hold every room at `seconds` of live time (captures); null lets the clocks run again. */
    at(seconds: number | null) {
      debug.at = seconds;
      debug.frozen = seconds !== null;
      for (const r of debug.rooms) r.redraw();
    },
    /** Pretend the viewer is at (x, y) in [-1, 1] (null: follow the real pointer). */
    pointer(x: number | null, y = 0) {
      debug.pointer = x === null ? null : { x, y };
      for (const r of debug.rooms) r.redraw();
    },
    /** Draw the plate with every effect at zero (true) or as normal (false). */
    quiet(on: boolean) {
      debug.quiet = on;
      for (const r of debug.rooms) r.redraw();
    },
    rooms: () => [...debug.rooms].map((r) => ({ room: r.room, state: r.state() })),
    /** Milliseconds since the last input the rooms count (pointer, key, wheel, touch, scroll). */
    idle: () => Math.round(performance.now() - lastInput),
    /** Draw `frames` frames back to back (waiting for the GPU each time) and report ms per frame. */
    bench: (frames = 30) => [...debug.rooms].map((r) => ({ room: r.room, ...(r.bench(frames) as object) })),
  };
}

/* ---- the renderer ---------------------------------------------------------- */

function kelvin(k: number): [number, number, number] {
  // Tanner Helland's fit, enough for a lamp's tint.
  const t = k / 100;
  const r = t <= 66 ? 1 : Math.min(1, (329.7 * Math.pow(t - 60, -0.1332)) / 255);
  const g = t <= 66 ? Math.min(1, (99.47 * Math.log(t) - 161.12) / 255) : Math.min(1, (288.1 * Math.pow(t - 60, -0.0755)) / 255);
  const b = t >= 66 ? 1 : t <= 19 ? 0 : Math.min(1, (138.5 * Math.log(t - 10) - 305.04) / 255);
  return [r, Math.max(0, g), Math.max(0, b)];
}

async function loadBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/** A small RGBA copy of a bitmap, for reading on the CPU. */
function readSmall(bitmap: ImageBitmap, width: number): { data: Uint8ClampedArray; w: number; h: number } | null {
  const w = Math.max(1, Math.min(width, bitmap.width));
  const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

function deviceHints() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const phone = !!window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) < 820;
  return {
    phone,
    lowPower: isLowPower(nav.hardwareConcurrency, nav.deviceMemory, nav.connection?.saveData),
    dpr: window.devicePixelRatio || 1,
    saveData: !!nav.connection?.saveData,
  };
}

function reducedNow(): boolean {
  const system = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const attr = document.querySelector('.shell')?.getAttribute('data-reduced-motion');
  return motionReduced(system, attr);
}

export function mountLiving(opts: LivingOptions): LivingHandle {
  const { host, canvas, overlay, room, anchors } = opts;
  const tuning = tuningFor(room);
  const living = anchors.living;
  const plan: LivingPlan | null =
    tuning && living ? planLiving({ living, tuning, plateUrl: opts.plateUrl, resolve: opts.resolve, blurred: opts.blurred }) : null;

  let state: LivingState = 'still';
  const setState = (next: LivingState) => {
    if (next === state) return;
    state = next;
    opts.onstate(next);
  };

  const hints = typeof window !== 'undefined' ? deviceHints() : { phone: false, lowPower: false, dpr: 1, saveData: false };
  if (!plan || hints.saveData || typeof WebGL2RenderingContext === 'undefined') {
    // Nothing to animate (or data saver): the still plate, or Room's CSS fallback.
    queueMicrotask(() => setState(plan && !hints.saveData ? 'unsupported' : 'still'));
    return { setGeometry() {}, destroy() {} };
  }
  const budget: FrameBudget = frameBudget(hints);

  let geometry = opts.geometry;
  let destroyed = false;
  let reduced = reducedNow();
  let onScreen = true;
  let mode: LivingMode = 'still';
  const clock = new LivingClock(hash01(room.length * 97) * 40);
  let lastDrawn = 0;
  let needsDraw = true;
  /** No WebGL2, a shader that will not build, masks that will not load: the CSS fallback for good. */
  let failed = false;
  /** The context is lost: the CSS fallback until the browser restores it. */
  let lost = false;
  /** Stopped for idleness (no input for IDLE_STOP_MS). */
  let sleeping = false;
  const aborter = new AbortController();
  watchInput();

  /* GL resources */
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  const textures = new Map<TextureKey | 'strips' | 'lampData', WebGLTexture>();
  const sizes = new Map<TextureKey, { w: number; h: number }>();
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  let ready = false;
  let starting = false;
  let lane: { y: number; x0: number; x1: number } | null = null;
  let depthCopy: { data: Uint8ClampedArray; w: number; h: number } | null = null;

  /* per-frame state */
  const lampGains = new Map<number, number>();
  const view = { x: 0, y: 0 };
  let region: Region = { x: 0, y: 0, w: 0, h: 0 };
  let backing = { w: 1, h: 1, scale: 1 };
  let lastShift = { x: NaN, y: NaN };
  const stripData = new Float32Array(256 * 4);
  const lampData = new Float32Array(256 * 4);

  /* The pointer/tilt is followed only while the room is live (a still or paused room lets go of it, so
     a granted tilt does not stream readings to a room that cannot move). */
  let releaseViewer: (() => void) | null = null;
  function follow(on: boolean) {
    if (plan!.features.parallax === 'none') return;
    if (on && !releaseViewer) releaseViewer = useViewer();
    else if (!on && releaseViewer) {
      releaseViewer();
      releaseViewer = null;
    }
  }

  /* ---- geometry: the canvas covers the plate's visible part of the box ---- */

  /* The plate's placement in the box, in the box's own fractional px (see layout). */
  let mapFit: Fit = geometry.fit;
  /** Ancestors that clip the room (overflow hidden or clip; scrollers are left out), found once per resize. */
  let clipEls: HTMLElement[] = [];
  let clipsStale = true;
  /** Whether any clip can cut the room's box (sizes only): if not, scrolling cannot change its region. */
  let clipped = true;
  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (ready) queueLayout();
        })
      : null;

  function findClips() {
    clipsStale = false;
    clipEls = [];
    for (let el = host.parentElement, n = 0; el && el !== document.body && n < 8; el = el.parentElement, n++) {
      const cs = getComputedStyle(el);
      if (/hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflowY)) clipEls.push(el);
    }
    // A clip that changes size without a window resize (a panel opening) moves the room's edge.
    ro?.disconnect();
    for (const el of clipEls) ro?.observe(el);
  }

  /**
   * Measures where the canvas goes. Returns whether anything changed (region, drawing-buffer size, or
   * the plate's placement); only then must the room be drawn again, at once (a new buffer size clears
   * the canvas). A scroll that moves nothing costs a few rectangles and no frame.
   */
  function layout(): boolean {
    if (clipsStale) findClips();
    const { fit, boxW, boxH } = geometry;
    const r = host.getBoundingClientRect();
    const clips: Box[] = [{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }];
    for (const el of clipEls) clips.push(el.getBoundingClientRect());
    const out = visibleRegion(fit, boxW, boxH, r, clips);
    clipped = out.clipped;
    const next = out.region;
    const plateW = sizes.get('plate')?.w ?? 0;
    const nextBacking = backingSize(next.w, next.h, window.devicePixelRatio || 1, budget, plateW > 0 && fit.w > 0 ? (plateW / fit.w) * 1.05 : Infinity);
    const fitMoved = fit.x !== mapFit.x || fit.y !== mapFit.y || fit.w !== mapFit.w || fit.h !== mapFit.h;
    const first = canvas.style.width === '';
    if (!first && !fitMoved && sameRegion(next, region) && nextBacking.w === backing.w && nextBacking.h === backing.h) return false;
    mapFit = fit;
    region = next;
    backing = nextBacking;
    canvas.style.left = `${next.x}px`;
    canvas.style.top = `${next.y}px`;
    canvas.style.width = `${next.w}px`;
    canvas.style.height = `${next.h}px`;
    if (canvas.width !== backing.w) canvas.width = backing.w;
    if (canvas.height !== backing.h) canvas.height = backing.h;
    return true;
  }

  /** Lays out, and when that changed anything, draws right away (so a resized canvas is never blank). */
  function relayout() {
    if (!ready || destroyed) return;
    if (layout() && mode !== 'still') draw(performance.now(), false);
  }

  let layoutQueued = false;
  const queueLayout = () => {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      relayout();
    });
  };
  const onResize = () => {
    clipsStale = true;
    queueLayout();
  };
  /* Scrolling moves the room within its clips only when a clip can cut it (Home beside Routine's panel). */
  const onScroll = () => {
    if (clipped) queueLayout();
  };
  /* A clip that slides or scales into place (a transition) changes no size: measure when it settles. */
  const onSettle = (event: Event) => {
    const target = event.target;
    if (target instanceof Node && target.contains(host)) queueLayout();
  };
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  document.addEventListener('transitionend', onSettle, { passive: true });
  document.addEventListener('animationend', onSettle, { passive: true });
  /** Re-measured now and then while live, whatever the events said (cheap: a few rectangles). */
  let lastMeasured = 0;

  /* ---- visibility, reduced motion ---- */

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          update();
        })
      : null;
  io?.observe(host);

  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotion = () => {
    const next = reducedNow();
    if (next !== reduced) {
      reduced = next;
      update();
    }
  };
  mq?.addEventListener?.('change', onMotion);
  const mo = new MutationObserver(onMotion);
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-reduced-motion'] });
  const onVisibility = () => update();
  document.addEventListener('visibilitychange', onVisibility);

  function update() {
    if (destroyed) return;
    mode = livingMode({ reducedMotion: reduced, hidden: document.hidden, onScreen });
    if (mode === 'still') {
      stop();
      writeShift(0, 0);
      setState('still');
      return;
    }
    if (!ready) {
      follow(false);
      if (!starting && !failed && !lost) void start();
      return;
    }
    setState('live');
    if (mode === 'live') {
      sleeping = false;
      sleepers.delete(wakeUp);
      follow(true);
      frames.add(frame);
      wake();
      queueLayout();
    } else {
      stop();
    }
  }

  function stop() {
    frames.delete(frame);
    clock.rest();
    follow(false);
  }

  /** Nobody has touched the page for a long while: stop until someone does. */
  function sleep() {
    stop();
    sleeping = true;
    sleepers.add(wakeUp);
  }
  const wakeUp = () => {
    sleepers.delete(wakeUp);
    if (!sleeping) return;
    sleeping = false;
    update();
  };

  /* ---- loading ---- */

  function fail() {
    failed = true;
    stop();
    setState('unsupported');
  }

  async function start() {
    starting = true;
    setState('loading');
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      });
      if (!gl) return fail();
      if (gl.isContextLost()) {
        // Wait for the browser to restore it (webglcontextrestored).
        lost = true;
        setState('unsupported');
        return;
      }
      textures.clear();
      sizes.clear();
      uniforms.clear();
      program = buildProgram(gl, plan!);
      if (!program) return fail();

      const bitmaps = await Promise.all(plan!.textures.map((t) => loadBitmap(t.url, aborter.signal).then((b) => [t, b] as const)));
      if (destroyed || !gl || lost || gl.isContextLost()) return bitmaps.forEach(([, b]) => b.close());
      for (const [t, bitmap] of bitmaps) {
        upload(gl, t, bitmap);
        if (t.key === 'sky' && plan!.features.aircraft) {
          const small = readSmall(bitmap, 160);
          lane = small ? skyLane(small.data, small.w, small.h) : null;
        }
        if (t.key === 'depth') depthCopy = readSmall(bitmap, 256);
        bitmap.close();
      }
      textures.set('strips', dataTexture(gl));
      textures.set('lampData', dataTexture(gl));
      fillStrips();
      ready = true;
      if (plan!.features.parallax === 'depth' && depthCopy) {
        const copy = depthCopy;
        const t = plan!.tuning;
        opts.onparallax?.((p: Point) => parallaxFactor(depthAt(copy.data, copy.w, copy.h, p, plan!.depthRange), t.focusM, t.nearM));
      }
      layout();
      // First frame = the plate as rendered (ramp 0); then show the canvas.
      draw(performance.now(), true);
      update();
    } catch (error) {
      if (!destroyed && !lost && (error as Error)?.name !== 'AbortError') fail();
    } finally {
      starting = false;
    }
  }

  /* A lost context (iOS drops them when a tab goes to the background) shows the CSS fallback until the
     browser restores it; then the room loads again (the masks come from the HTTP cache). */
  function onLost(event: Event) {
    event.preventDefault();
    ready = false;
    lost = true;
    program = null;
    textures.clear();
    sizes.clear();
    uniforms.clear();
    stop();
    setState('unsupported');
  }
  function onRestored() {
    if (destroyed) return;
    lost = false;
    update();
  }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  function upload(g: WebGL2RenderingContext, t: TexturePlan, bitmap: ImageBitmap) {
    const tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, tex);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, bitmap);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    if (t.mips) {
      g.generateMipmap(g.TEXTURE_2D);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    } else {
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    }
    textures.set(t.key, tex);
    sizes.set(t.key, { w: bitmap.width, h: bitmap.height });
  }

  function dataTexture(g: WebGL2RenderingContext): WebGLTexture {
    const tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA32F, 256, 1, 0, g.RGBA, g.FLOAT, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return tex;
  }

  /** Strip constants: waves per strip (a whole number on rings); the phase moves per frame. */
  const stripWave = new Map<number, { waves: number; perSecond: number; offset: number }>();
  function fillStrips() {
    const t = plan!.tuning;
    for (const s of plan!.strips) {
      const ring = s.shape === 'ring';
      const waves = stripWaves(s.lengthM, ring, t.travelWaveM);
      // Beads move at travelSpeed m/s: along-distance per second = speed / length, in wave units * waves.
      const dir = hash01(s.id * 7 + 1) < 0.5 ? -1 : 1;
      stripWave.set(s.id, { waves, perSecond: (dir * t.travelSpeed * waves) / s.lengthM, offset: hash01(s.id * 7 + 2) });
    }
  }

  /* ---- drawing ---- */

  function uniform(name: string): WebGLUniformLocation | null {
    if (!uniforms.has(name)) uniforms.set(name, gl!.getUniformLocation(program!, name));
    return uniforms.get(name)!;
  }

  function writeShift(dx: number, dy: number) {
    if (!overlay) return;
    if (Math.abs(dx - lastShift.x) < 0.02 && Math.abs(dy - lastShift.y) < 0.02) return;
    lastShift = { x: dx, y: dy };
    overlay.style.setProperty('--living-dx', `${dx.toFixed(2)}px`);
    overlay.style.setProperty('--living-dy', `${dy.toFixed(2)}px`);
  }

  /**
   * The ambient motion is slow: 30 fps shows it fully and halves the cost (including the frosted
   * glass the page lays over the room, which the browser re-blurs every frame the room changes); the
   * sidebar strip, under dark glass, needs 15. Only while the parallax is catching up with the pointer
   * does a capable device draw at its full rate. Without input for a while it slows, then stops.
   */
  function frame(now: number) {
    if (destroyed || !ready || mode !== 'live') return;
    if (now - lastMeasured > 1000) {
      lastMeasured = now;
      relayout();
    }
    const target = plan!.features.parallax === 'none' ? view : viewer();
    // Catching up while the picture still has more than a twentieth of a pixel to go.
    const chasing = (Math.abs(target.x - view.x) + Math.abs(target.y - view.y)) * plan!.tuning.parallaxPx > 0.05;
    const fps = chasing ? budget.fps : ambientFps(Math.min(plan!.tuning.fps, budget.fps), now - lastInput);
    if (fps <= 0 && !debug.frozen) return sleep();
    if (!needsDraw && !isDue(now, lastDrawn, fps)) return;
    draw(now, false);
  }

  function draw(now: number, first: boolean) {
    const g = gl;
    if (!g || !program || !ready || region.w <= 0 || region.h <= 0) return;
    lastDrawn = now;
    needsDraw = false;
    const dt = debug.frozen ? 0 : clock.tick(now, true);
    if (debug.at !== null) clock.set(debug.at);
    const T = clock.total;
    const ramp = first || debug.quiet ? 0 : clock.ramp;
    const p = plan!;
    const t = p.tuning;
    const fit = mapFit;

    g.viewport(0, 0, backing.w, backing.h);
    g.useProgram(program);

    // Canvas pixel -> plate uv.
    const s = backing.w / Math.max(1, region.w);
    const sy = backing.h / Math.max(1, region.h);
    g.uniform4f(
      uniform('uMap'),
      (region.x - fit.x) / fit.w,
      (region.y - fit.y) / fit.h + backing.h / (sy * fit.h),
      1 / (s * fit.w),
      1 / (sy * fit.h),
    );
    g.uniform1f(uniform('uT'), clock.t);
    g.uniform1f(uniform('uRamp'), ramp);
    const dataKey = p.textures.find((x) => x.kind === 'data' && x.key !== 'depth')?.key;
    const mask = (dataKey && sizes.get(dataKey)) || sizes.get('plate')!;
    g.uniform2f(uniform('uMaskSize'), mask.w, mask.h);
    g.uniform1f(uniform('uAspect'), fit.w / Math.max(1, fit.h));

    // Parallax: ease toward the viewer (pointer or tilt).
    const target = debug.pointer ?? (p.features.parallax === 'none' ? { x: 0, y: 0 } : viewer());
    const ease = debug.frozen ? 1 : 1 - Math.exp(-dt / 0.35);
    view.x += (target.x - view.x) * ease;
    view.y += (target.y - view.y) * ease;
    const amp = t.parallaxPx * ramp;
    if (p.features.parallax === 'depth') {
      // Near things move against the pointer, far ones (less) with it; the sampling point moves the other way.
      g.uniform2f(uniform('uParallax'), (view.x * amp) / fit.w, (view.y * amp) / fit.h);
      g.uniform2f(uniform('uDepthRange'), p.depthRange[0], p.depthRange[1]);
      g.uniform2f(uniform('uFocusNear'), t.focusM, t.nearM);
      writeShift(-view.x * amp, -view.y * amp);
    } else if (p.features.parallax === 'glass') {
      // The view outside moves a little with the pointer, behind the still room.
      g.uniform2f(uniform('uParallax'), (-view.x * amp) / fit.w, (-view.y * amp) / fit.h);
    }

    if (p.features.plants) {
      const gs = gust(T, 1);
      // Drifts wrap at NOISE_PERIOD, where the shader's noise repeats (no seam, small floats).
      const n = T * 0.25;
      g.uniform4f(uniform('uBreeze'), (T / 5.3) % 1, (T / 3.1) % 1, n % NOISE_PERIOD, 0);
      g.uniform2f(uniform('uFlutter'), (n * 3.1) % NOISE_PERIOD, (n * 2.7) % NOISE_PERIOD);
      g.uniform2f(uniform('uGust'), gs.front, gs.strength);
      g.uniform2f(uniform('uSway'), p.swayPx * ramp, p.flutterPx * ramp);
    }

    const [lo, hi] = t.breathRange;
    const k = t.breathe * breath(T, t.breathePeriod, 0, lo, hi) * ramp;
    g.uniform1f(uniform('uBreath'), k);
    if (p.features.glow) g.uniform1f(uniform('uGlowLod'), opts.blurred ? 1.6 : 0);
    if (p.features.travel) {
      // The bead is a share of the LEDs' light: on a boost layer (consult) that is divided by its strength.
      const bead = (p.features.glow ? t.travel : t.travel / t.boostStrength.neon) * ramp;
      for (const [id, w] of stripWave) {
        const phase = (((T * w.perSecond + w.offset) % 1) + 1) % 1;
        stripData.set([w.waves, phase, bead, 0], id * 4);
      }
      g.activeTexture(g.TEXTURE15);
      g.bindTexture(g.TEXTURE_2D, textures.get('strips')!);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 256, 1, g.RGBA, g.FLOAT, stripData);
    }
    if (p.features.boosts) {
      // scan.md s9: the LEDs breathe +-5 % over 8 s. Each boost layer adds its strength x its light at
      // opacity 1, so the breath (a share of the light) is divided by it. The under-glow a little behind
      // the coves; the emitter with them (one slow rhythm under the hologram's own 3 s pulse).
      const s = t.breathe * ramp;
      const b = breath(T, t.breathePeriod, 0, lo, hi);
      const bu = breath(T, t.breathePeriod, 0.6, lo, hi);
      const str = t.boostStrength;
      g.uniform3f(uniform('uBoost'), (b / str.neon) * s, (bu / str.under) * s, (b / str.emitter) * s);
    }
    // The glass rings' glints: three round the ring, one turn per emitterTurnS.
    if (p.features.emitter) g.uniform2f(uniform('uEmit'), ((T * 3) / t.emitterTurnS) % 1, t.emitter * ramp);

    if (p.features.windows) g.uniform3f(uniform('uTwinkle'), t.twinkle, t.windowGain, t.shimmer * ramp);

    if (p.features.lamps) {
      lampData.fill(0);
      for (const l of p.lights) {
        const want = lampGain(l.motion, T, l.id * 17 + room.length);
        const prev = lampGains.get(l.id) ?? 1;
        const gain = debug.frozen ? want : slew(prev, want, LAMP_SLEW, dt);
        lampGains.set(l.id, gain);
        const d = (gain - 1) * t.lamps * ramp;
        const [r, gg, b] = kelvin(l.tempK ?? 2700);
        const halo = d * 0.22;
        lampData.set([d, r * halo, gg * halo, b * halo], l.id * 4);
      }
      g.activeTexture(g.TEXTURE14);
      g.bindTexture(g.TEXTURE_2D, textures.get('lampData')!);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 256, 1, g.RGBA, g.FLOAT, lampData);
    }

    if (p.features.sky) {
      const kind = t.sky === 'dusk' ? 1 : t.sky === 'night' ? 2 : 3;
      const speed = t.sky === 'day' ? 0.02 : t.sky === 'night' ? 0.01 : 0.006;
      g.uniform4f(uniform('uSkyDrift'), (T * speed) % NOISE_PERIOD, (T * speed * 0.15) % NOISE_PERIOD, t.skyAmount * ramp, kind);
      if (p.features.aircraft) {
        const a = aircraft(T, room.length);
        if (a.visible && lane) {
          const u = a.leftward ? 1 - a.progress : a.progress;
          const x = lane.x0 + (lane.x1 - lane.x0) * u;
          g.uniform4f(uniform('uPlane'), x, lane.y - 0.012 * a.progress, a.fadeIn * ramp, beacon(T, room.length));
        } else g.uniform4f(uniform('uPlane'), 0, 0, 0, 0);
      }
    }
    if (p.features.haze) g.uniform3f(uniform('uHaze'), (T * 0.008) % NOISE_PERIOD, (T * 0.0015) % NOISE_PERIOD, t.skyAmount * 5 * ramp);

    // Textures: fixed units per sampler name.
    let unit = 0;
    const bind = (name: string, key: TextureKey | 'strips' | 'lampData') => {
      const tex = textures.get(key);
      if (!tex) return;
      const loc = uniform(name);
      if (!loc) return;
      const u = key === 'strips' ? 15 : key === 'lampData' ? 14 : unit++;
      g.activeTexture(g.TEXTURE0 + u);
      g.bindTexture(g.TEXTURE_2D, tex);
      g.uniform1i(loc, u);
    };
    bind('uPlate', 'plate');
    bind('uGlow', 'glow');
    bind('uPlants', 'plants');
    bind('uSky', 'sky');
    bind('uGlass', 'glass');
    bind('uWindows', 'windows');
    bind('uLamps', 'lamps');
    bind('uCoves', 'coves');
    bind('uEmitter', 'emitter');
    bind('uDepth', 'depth');
    bind('uNeon', 'neon');
    bind('uUnder', 'under');
    bind('uEmitBoost', 'emitBoost');
    bind('uStrips', 'strips');
    bind('uLampData', 'lampData');

    g.drawArrays(g.TRIANGLES, 0, 3);
  }

  const record = {
    room,
    redraw: () => {
      needsDraw = true;
      if (ready && !destroyed && mode !== 'still') draw(performance.now(), false);
    },
    state: () => state,
    bench: (n: number) => {
      if (!gl || !ready) return { ms: null };
      const px = new Uint8Array(4);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) draw(performance.now(), false);
      // Reading a pixel back waits for the GPU to finish every frame queued (finish() may not).
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { ms: +((performance.now() - t0) / n).toFixed(2), px: `${backing.w}x${backing.h}` };
    },
  };
  debug.rooms.add(record);

  // Reduced motion at mount: stay still (and load nothing) until it is lifted.
  mode = livingMode({ reducedMotion: reduced, hidden: document.hidden, onScreen });
  queueMicrotask(() => {
    if (destroyed) return;
    if (mode === 'still') opts.onstate('still');
    else update();
  });

  return {
    setGeometry(next) {
      geometry = next;
      relayout();
    },
    destroy() {
      destroyed = true;
      aborter.abort();
      frames.delete(frame);
      sleepers.delete(wakeUp);
      debug.rooms.delete(record);
      follow(false);
      io?.disconnect();
      ro?.disconnect();
      mo.disconnect();
      mq?.removeEventListener?.('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('transitionend', onSettle);
      document.removeEventListener('animationend', onSettle);
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      opts.onparallax?.(null);
      if (overlay) {
        overlay.style.removeProperty('--living-dx');
        overlay.style.removeProperty('--living-dy');
      }
      if (gl) {
        for (const tex of textures.values()) gl.deleteTexture(tex);
        if (program) gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      gl = null;
    },
  };
}

function buildProgram(gl: WebGL2RenderingContext, plan: LivingPlan): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      if (import.meta.env?.DEV) console.warn('[living] shader:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSource(plan.features));
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    if (import.meta.env?.DEV) console.warn('[living] link:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  // A vertex array with no attributes: the triangle comes from gl_VertexID.
  gl.bindVertexArray(gl.createVertexArray());
  return prog;
}
