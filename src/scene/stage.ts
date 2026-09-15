/**
 * The renderer, the camera and the frame loop (ARCHITECTURE §9).
 *
 * Written against an Intel HD 620: no post-processing, no shadow maps, no
 * tone-mapping pass. Quality is probed from real measured frame times in the
 * first second rather than guessed from a device string, and the loop throttles
 * itself when nothing needs a new frame.
 */
import * as THREE from 'three';
import { clamp } from '@/lib/math.ts';

/**
 * Critically damped approach with carried velocity — the smoothDamp of every
 * game camera since the term existed.
 *
 * The raw exponential damp this replaces starts each move at its maximum
 * speed: the largest step is the first one, so every cut *snapped* away from
 * the old framing and then crawled into the new one. Carrying velocity means
 * a move accelerates from rest, eases out as it arrives, and — because the
 * spring is critically damped — never overshoots. It also keeps tracking a
 * target that shifts every frame, which the hand-held sway does.
 *
 * `vel[i]` is this component's velocity, mutated in place. The exponential is
 * the usual cubic approximation, well-behaved at any frame step we see.
 */
function smoothDamp(
  current: number,
  target: number,
  vel: Float64Array,
  i: number,
  smoothTime: number,
  dt: number,
): number {
  const omega = 2 / Math.max(0.05, smoothTime);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel[i] + omega * change) * dt;
  vel[i] = (vel[i] - omega * temp) * decay;
  return target + (change + temp) * decay;
}

export type QualityTier = 'low' | 'medium' | 'high';

export interface TierSettings {
  dprCap: number;
  targetFps: number;
  particles: boolean;
  /** Optional depth layers — the holographic room's expensive additive passes. */
  richEffects: boolean;
}

/**
 * Desktop caps. Mobile gets its own, lower set — see `mobileDprCap`.
 *
 * The scene is dominated by additive-blended geometry, which is fill-rate bound
 * rather than triangle bound: every extra holographic layer costs another pass
 * over the same pixels. That makes *pixel count*, not polygon count, the number
 * that decides whether this runs on a phone.
 */
const TIER_SETTINGS: Record<QualityTier, TierSettings> = {
  low: { dprCap: 1, targetFps: 30, particles: false, richEffects: false },
  medium: { dprCap: 1.5, targetFps: 60, particles: true, richEffects: false },
  high: { dprCap: 2, targetFps: 60, particles: true, richEffects: true },
};

/** Phones lie about capability far more than laptops do, so cap harder. */
const MOBILE_DPR_CAP: Record<QualityTier, number> = { low: 1, medium: 1.25, high: 1.5 };

/**
 * Hard ceiling on rendered pixels, whatever the DPR maths says. A 3x phone at
 * 414 CSS px would otherwise ask for ~3.1M pixels of overdraw-heavy scene.
 */
const MAX_PIXELS: Record<QualityTier, number> = {
  low: 900_000,
  medium: 1_600_000,
  high: 2_600_000,
};

/**
 * Coarse pointer or a narrow viewport. Deliberately not user-agent sniffing —
 * what matters is the input method and the panel size, and a touch laptop
 * getting the conservative path is a harmless outcome.
 */
function isMobileLike(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || Math.min(window.innerWidth, window.innerHeight) < 500;
}

export interface CameraShot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/** Chest-up portrait — the framing the whole product is composed for. */
export const SHOT_CONVERSATION: CameraShot = {
  position: new THREE.Vector3(0.05, 1.525, 1.02),
  target: new THREE.Vector3(0, 1.475, 0),
  fov: 34,
};

/**
 * Wide enough to hold her *and* the display panel she presents from.
 *
 * She is no longer the centre of the composition — she stands to the left of a
 * screen and talks about what is on it, which is what stopped readouts landing
 * on her face. The camera therefore frames a two-shot, not a portrait.
 */
export const SHOT_CLINICAL: CameraShot = {
  position: new THREE.Vector3(-0.02, 1.52, 1.46),
  target: new THREE.Vector3(0.04, 1.44, 0),
  fov: 34,
};

/**
 * Portrait: the panel takes the upper frame and she stands below it.
 *
 * Framed high on purpose. The panel covers roughly the top 45% of a phone, so a
 * shot centred on her chest puts her head behind it — which is exactly what it
 * did. The look-at point is lifted until her head clears the panel's lower edge
 * and her shoulders sit above the chat sheet, leaving her the band between.
 */
export const SHOT_CLINICAL_PORTRAIT: CameraShot = {
  position: new THREE.Vector3(-0.02, 1.66, 1.81),
  target: new THREE.Vector3(0, 1.63, 0),
  fov: 46,
};

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private canvas: HTMLCanvasElement;
  private running = false;
  private lastTime = 0;
  private elapsed = 0;
  private accumulator = 0;

  private shot: CameraShot = SHOT_CONVERSATION;
  /** Seconds the current move should take. See `setShot`. */
  private shotSeconds = 1.6;
  private camPos = SHOT_CONVERSATION.position.clone();
  private camTarget = SHOT_CONVERSATION.target.clone();
  /** Velocity per animated component: position xyz, target xyz, fov. */
  private camVelocity = new Float64Array(7);

  private probeFrames = 0;
  private probeTotal = 0;
  private tierResolved = false;

  tier: QualityTier = 'high';
  onFrame: ((dt: number, elapsed: number) => void) | null = null;
  onTierResolved: ((tier: QualityTier) => void) | null = null;

  /** Rolling average frame time in ms, for the dev overlay. */
  frameMs = 0;

  constructor(canvas: HTMLCanvasElement, forcedTier: QualityTier | 'auto' = 'auto') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // costs more than it returns on an iGPU at this stylisation
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0x0a0d14, 1);

    this.camera = new THREE.PerspectiveCamera(this.shot.fov, 1, 0.05, 60);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);

    if (forcedTier !== 'auto') {
      this.tier = forcedTier;
      this.tierResolved = true;
      // An explicit preference is a preference: never override it later.
      this.tierLocked = true;
    }
    // Size first — the pixel budget in applyTier needs to know the canvas size.
    this.resize();
    this.applyTier();
  }

  /**
   * Resolves the device pixel ratio from three limits at once: the tier's cap,
   * a lower cap on touch devices, and an absolute pixel budget. The budget is
   * the one that actually saves a phone — a 3x screen can ask for more pixels
   * than the GPU can shade regardless of what the DPR cap says.
   */
  private applyTier(): void {
    const settings = TIER_SETTINGS[this.tier];
    const cap = isMobileLike() ? MOBILE_DPR_CAP[this.tier] : settings.dprCap;

    const size = this.renderer.getSize(this.sizeScratch);
    const cssPixels = Math.max(1, size.x * size.y);
    const byBudget = Math.sqrt(MAX_PIXELS[this.tier] / cssPixels);

    const ratio = Math.max(0.75, Math.min(window.devicePixelRatio || 1, cap, byBudget));
    this.renderer.setPixelRatio(ratio);
  }

  private sizeScratch = new THREE.Vector2();

  get settings(): TierSettings {
    return TIER_SETTINGS[this.tier];
  }

  /** True when this device is being treated as a phone/tablet. */
  get mobile(): boolean {
    return isMobileLike();
  }

  resize(): void {
    /*
     * The canvas's own CSS box is the one truth. `setSize(..., false)` leaves
     * the element at its fixed inset-0 size, so measuring the window or the
     * parent instead let the two disagree - on a phone the keyboard shrinks
     * the reported viewport while the fixed canvas keeps covering the layout
     * viewport, and a buffer solved for one displayed in the other is her
     * face, stretched, the whole time you type. Matching buffer to box is
     * aspect-correct by construction, keyboard or not.
     *
     * A hidden or not-yet-laid-out canvas reports 0, and a zero aspect
     * silently mis-solves everything downstream that asks what the camera
     * can see. Fall back rather than propagate it.
     */
    const width = this.canvas.clientWidth || window.innerWidth || 1280;
    const height = this.canvas.clientHeight || window.innerHeight || 720;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    // Rotating a phone changes the pixel count, so the budget has to be redone.
    if (this.tierResolved) this.applyTier();
  }

  get aspect(): number {
    return this.camera.aspect;
  }

  /**
   * Aim the camera. `seconds` is roughly how long the move takes — a slow
   * pull back to establish a room and a quick move in to listen to someone
   * are different gestures, and one duration cannot express both. The
   * cinematographer carries a duration per shot and hands it through here.
   */
  setShot(shot: CameraShot, seconds = 1.6): void {
    this.shot = shot;
    this.shotSeconds = seconds;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);

    const raw = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Guard against tab-restore producing a multi-second dt that teleports
    // every spring in the rig.
    const dt = clamp(raw, 0, 0.1);

    this.frameMs = this.frameMs === 0 ? raw * 1000 : this.frameMs * 0.9 + raw * 1000 * 0.1;
    this.probeQuality(raw);

    // Frame pacing: on the low tier we deliberately render at 30fps and give the
    // GPU the other half of every 33ms back.
    const minStep = 1 / TIER_SETTINGS[this.tier].targetFps;
    this.accumulator += dt;
    if (this.accumulator < minStep - 0.002) return;
    const step = this.accumulator;
    this.accumulator = 0;

    this.elapsed += step;
    this.updateCamera(step);
    this.onFrame?.(step, this.elapsed);
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Resolves the quality tier from measured frame times over the first second
   * of real rendering — the only measurement that reflects this GPU with this
   * scene.
   */
  private probeQuality(rawDt: number): void {
    if (!this.tierResolved) {
      // Skip the first few frames: shader compilation makes them meaningless.
      this.probeFrames++;
      if (this.probeFrames <= 8) return;
      this.probeTotal += rawDt * 1000;

      if (this.probeFrames >= 60) {
        const avg = this.probeTotal / (this.probeFrames - 8);
        this.setTier(avg > 26 ? 'low' : avg > 15 ? 'medium' : 'high');
        this.tierResolved = true;
      }
      return;
    }

    // Keep watching. The opening probe happens in the lounge, but the clinical
    // room costs several times more — a device that comfortably passed the first
    // second can still fall over once the holograms boot, and a fixed tier would
    // leave it stuttering there forever.
    if (this.tierLocked) return;
    this.sustainedMs = this.sustainedMs * 0.96 + rawDt * 1000 * 0.04;
    this.sustainedFrames++;
    if (this.sustainedFrames < 90) return;
    this.sustainedFrames = 0;

    if (this.sustainedMs > 34 && this.tier !== 'low') {
      // One-way ratchet: dropping and re-raising would oscillate, and a scene
      // that keeps changing quality looks worse than one that is simply lower.
      const next: QualityTier = this.tier === 'high' ? 'medium' : 'low';
      this.setTier(next);
      if (next === 'low') this.tierLocked = true;
    }
  }

  private setTier(tier: QualityTier): void {
    if (this.tier === tier) return;
    this.tier = tier;
    this.applyTier();
    this.onTierResolved?.(tier);
  }

  private sustainedMs = 16;
  private sustainedFrames = 0;
  private tierLocked = false;

  private updateCamera(dt: number): void {
    // The critically damped response covers ninety-odd percent of a step in
    // about twice its time constant, so the constant is half the travel the
    // shot asked for.
    const smoothTime = this.shotSeconds * 0.5;
    const vel = this.camVelocity;
    const { position, target } = this.shot;
    this.camPos.x = smoothDamp(this.camPos.x, position.x, vel, 0, smoothTime, dt);
    this.camPos.y = smoothDamp(this.camPos.y, position.y, vel, 1, smoothTime, dt);
    this.camPos.z = smoothDamp(this.camPos.z, position.z, vel, 2, smoothTime, dt);
    this.camTarget.x = smoothDamp(this.camTarget.x, target.x, vel, 3, smoothTime, dt);
    this.camTarget.y = smoothDamp(this.camTarget.y, target.y, vel, 4, smoothTime, dt);
    this.camTarget.z = smoothDamp(this.camTarget.z, target.z, vel, 5, smoothTime, dt);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);

    // The spring's own fov state advances every frame — freezing it below the
    // write threshold would leave its velocity integrating against a value
    // that never moves. Only the (costly) projection rebuild is gated.
    this.camFov = smoothDamp(this.camFov, this.shot.fov, vel, 6, smoothTime, dt);
    if (Math.abs(this.camFov - this.camera.fov) > 0.01) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private camFov = SHOT_CONVERSATION.fov;

  /** Draw calls and triangles for the last frame — the budget check. */
  stats(): { calls: number; triangles: number } {
    const info = this.renderer.info.render;
    return { calls: info.calls, triangles: info.triangles };
  }

  /**
   * Advances and renders exactly one frame, bypassing the rAF loop and the
   * frame pacer.
   *
   * requestAnimationFrame does not fire in a tab that is not compositing, which
   * makes the scene impossible to exercise or measure headlessly. This is the
   * seam that lets a test harness — or a developer checking the draw-call
   * budget — step the scene deterministically.
   */
  stepManually(dt = 1 / 60): void {
    this.elapsed += dt;
    this.updateCamera(dt);
    this.onFrame?.(dt, this.elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Renders one frame at an explicit size and returns it as a PNG data URL.
   *
   * The size has to be forced rather than read from layout: a hidden or
   * zero-height container yields a 0x0 drawing buffer, which still accepts draw
   * calls and still reports triangles — so the usual counters look healthy while
   * nothing has actually been rasterised. Restores the previous size afterwards.
   */
  captureFrame(width: number, height: number): string {
    const previous = this.renderer.getSize(new THREE.Vector2());
    const previousRatio = this.renderer.getPixelRatio();
    const previousAspect = this.camera.aspect;

    // preserveDrawingBuffer is off, so the read has to happen in the same task
    // as the draw — before the compositor gets a chance to discard it.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();

    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');

    this.renderer.setPixelRatio(previousRatio);
    this.renderer.setSize(previous.x || 1, previous.y || 1, false);
    this.camera.aspect = previousAspect;
    this.camera.updateProjectionMatrix();

    return url;
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
  }
}
