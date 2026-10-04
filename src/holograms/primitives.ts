/**
 * The holographic primitives (ARCHITECTURE §8).
 *
 * All procedural, no textures, all additive, all vertex-coloured. The organising
 * rule is that **one primitive family is one draw call**: six metric rings live
 * in a single mesh, every rail and every floor pulse ring lives in a single
 * LineSegments, both scan bands live in one plane bundle. Draw calls are the
 * scarce resource on an Intel HD 620 (§9), so nothing here ever allocates a mesh
 * per instance.
 *
 * Animation is therefore done by rewriting **vertex colours** (and, where a
 * shape genuinely has to move, a small contiguous slice of the position buffer).
 * That keeps everything on one material with no per-object uniforms and no
 * post-processing.
 *
 * Depth convention:
 * - *Readouts* (rings, face model, connectors, scan bands) use `depthTest:false`
 *   on purpose. Their text lives in the DOM and can never be occluded, so the
 *   geometry must not be either — see the note on `additive()` below.
 * - *Room architecture* (floor rails, flanking posts, floor pulse rings) uses
 *   `depthTest:true`. It has no DOM label, it is scenery, and a floor ring
 *   sweeping out behind her must pass *behind* her legs rather than paint over
 *   her hips. That distinction is deliberate, not an oversight.
 */
import * as THREE from 'three';
import { PALETTE } from '@/character/palette.ts';
import { clamp, easeOutBack } from '@/lib/math.ts';
import type { SkinMetricKey } from '@shared/types.ts';
import type { HoloSlot } from './layout.ts';

/**
 * `depthTest: false` is deliberate on the readouts.
 *
 * Their text lives in the DOM, which can never be occluded by 3D geometry. If
 * the ring behind a label could be hidden by her arm while the number stayed
 * visible, the two would visually separate — the same class of inconsistency as
 * naming a metric that has no ring on screen. A projected holographic interface
 * composites over the room; it does not hide behind the subject.
 */
function additive(extra: THREE.MaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    ...extra,
  });
}

function additiveLines(extra: THREE.LineBasicMaterialParameters = {}) {
  return new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    ...extra,
  });
}

/** A gaussian bump — the workhorse for every travelling wavefront in here. */
const bump = (x: number, width: number): number => Math.exp(-(x * x) / (width * width));

// ---------------------------------------------------------------------------
// MetricRing — every ring in one mesh
// ---------------------------------------------------------------------------

/**
 * Ring anatomy, from the centre out:
 *
 *   [ value arc ]  the gauge itself, thick, sweeps up to the value
 *   [ track     ]  a hairline concentric arc, always full — the "empty" state
 *   [ ticks     ]  ten graduations that latch on as the value passes them
 *   [ burst     ]  a radial corona, dark at rest, that flashes outward once
 *                  when a value lands
 *
 * All four sections share one buffer and one draw call. The gap sits at the
 * bottom so the whole thing reads as a gauge rather than a donut.
 */
const VALUE_SEGS = 36;
const TRACK_SEGS = 36;
const TICK_COUNT = 10;
const BURST_SPIKES = 14;

const R_VALUE_IN = 0.0455;
const R_VALUE_OUT = 0.0565;
const R_TRACK_IN = 0.0615;
const R_TRACK_OUT = 0.0648;
const R_TICK_IN = 0.0668;
const R_TICK_OUT = 0.0762;
const R_BURST_IN = 0.0575;
const R_BURST_OUT = 0.125;

const VALUE_SWEEP = Math.PI * 1.62;
const TRACK_SWEEP = Math.PI * 1.78;
const TICK_HALF_ANGLE = 0.026;
const BURST_HALF_ANGLE = 0.052;

const V_VALUE = (VALUE_SEGS + 1) * 2;
const V_TRACK = (TRACK_SEGS + 1) * 2;
const V_TICK = TICK_COUNT * 4;
const V_BURST = BURST_SPIKES * 4;
const OFF_VALUE = 0;
const OFF_TRACK = OFF_VALUE + V_VALUE;
const OFF_TICK = OFF_TRACK + V_TRACK;
const OFF_BURST = OFF_TICK + V_TICK;
const VERTS_PER_RING = OFF_BURST + V_BURST;

/** How long a landing burst takes to travel out and die, in seconds. */
const BURST_SECONDS = 0.62;

/** Gauge angles run clockwise from lower-left, through the top, to lower-right. */
const gaugeAngle = (t: number, sweep: number): number => Math.PI / 2 + sweep / 2 - t * sweep;

export class MetricRingBank {
  readonly mesh: THREE.Mesh;
  private colors: THREE.BufferAttribute;
  private positions: THREE.BufferAttribute;
  private count: number;
  private rich: boolean;

  /** Per-ring animated fill, 0..1. */
  private fill: Float32Array;
  private fillTarget: Float32Array;
  /** Per-ring landing burst envelope, 1 -> 0. */
  private burst: Float32Array;
  /** Per-ring boot reveal, 0..1. Drives a per-ring scale pop, not a bank-wide one. */
  private reveal: Float32Array;
  private tint: THREE.Color[] = [];

  private slots: HoloSlot[] = [];
  private positionsDirty = true;
  private focus = -1;

  constructor(count: number, opts: { rich?: boolean } = {}) {
    this.count = count;
    this.rich = opts.rich !== false;
    this.fill = new Float32Array(count);
    this.fillTarget = new Float32Array(count);
    this.burst = new Float32Array(count);
    this.reveal = new Float32Array(count);

    const totalVerts = VERTS_PER_RING * count;
    const positions = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);
    const indices: number[] = [];

    const quad = (a: number) => indices.push(a, a + 1, a + 2, a, a + 2, a + 3);

    for (let r = 0; r < count; r++) {
      const base = r * VERTS_PER_RING;
      // Two quad strips.
      for (let s = 0; s < VALUE_SEGS; s++) {
        const a = base + OFF_VALUE + s * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      for (let s = 0; s < TRACK_SEGS; s++) {
        const a = base + OFF_TRACK + s * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      // Two banks of independent quads.
      for (let k = 0; k < TICK_COUNT; k++) quad(base + OFF_TICK + k * 4);
      for (let k = 0; k < BURST_SPIKES; k++) quad(base + OFF_BURST + k * 4);
      this.tint.push(new THREE.Color(PALETTE.holo));
    }

    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(positions, 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.BufferAttribute(colors, 3);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('color', this.colors);
    geo.setIndex(indices);

    this.mesh = new THREE.Mesh(geo, additive({ opacity: 0 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Rebuilds ring geometry at the given world placements. */
  place(slots: HoloSlot[]): void {
    this.slots = slots;
    this.positionsDirty = true;
    this.writePositions();
  }

  private writePositions(): void {
    if (this.slots.length === 0) return;
    const arr = this.positions.array as Float32Array;
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();

    for (let r = 0; r < this.count; r++) {
      const slot = this.slots[r] ?? this.slots[this.slots.length - 1];
      q.setFromAxisAngle(axis, slot.yaw);
      // Rings arrive rather than appear: each one scales up with a small
      // overshoot on its own clock, so the bank lands as a cascade.
      const pop = 0.62 + 0.38 * (this.reveal[r] >= 1 ? 1 : easeOutBack(this.reveal[r]));
      const scale = slot.scale * pop;
      const base = r * VERTS_PER_RING;

      const put = (index: number, radius: number, angle: number) => {
        v.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
          .applyQuaternion(q)
          .add(slot.position);
        const i = index * 3;
        arr[i] = v.x;
        arr[i + 1] = v.y;
        arr[i + 2] = v.z;
      };

      for (let s = 0; s <= VALUE_SEGS; s++) {
        const angle = gaugeAngle(s / VALUE_SEGS, VALUE_SWEEP);
        put(base + OFF_VALUE + s * 2, R_VALUE_IN * scale, angle);
        put(base + OFF_VALUE + s * 2 + 1, R_VALUE_OUT * scale, angle);
      }
      for (let s = 0; s <= TRACK_SEGS; s++) {
        const angle = gaugeAngle(s / TRACK_SEGS, TRACK_SWEEP);
        put(base + OFF_TRACK + s * 2, R_TRACK_IN * scale, angle);
        put(base + OFF_TRACK + s * 2 + 1, R_TRACK_OUT * scale, angle);
      }
      for (let k = 0; k < TICK_COUNT; k++) {
        const angle = gaugeAngle(k / (TICK_COUNT - 1), VALUE_SWEEP);
        const i = base + OFF_TICK + k * 4;
        put(i, R_TICK_IN * scale, angle - TICK_HALF_ANGLE);
        put(i + 1, R_TICK_IN * scale, angle + TICK_HALF_ANGLE);
        put(i + 2, R_TICK_OUT * scale, angle + TICK_HALF_ANGLE);
        put(i + 3, R_TICK_OUT * scale, angle - TICK_HALF_ANGLE);
      }
      for (let k = 0; k < BURST_SPIKES; k++) {
        // The corona is a full circle, unlike the gauge — a landing reads as a
        // shock going out in every direction, not as more gauge.
        const angle = (k / BURST_SPIKES) * Math.PI * 2 + 0.11;
        const i = base + OFF_BURST + k * 4;
        put(i, R_BURST_IN * scale, angle - BURST_HALF_ANGLE);
        put(i + 1, R_BURST_IN * scale, angle + BURST_HALF_ANGLE);
        put(i + 2, R_BURST_OUT * scale, angle + BURST_HALF_ANGLE * 0.22);
        put(i + 3, R_BURST_OUT * scale, angle - BURST_HALF_ANGLE * 0.22);
      }
    }
    this.positions.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.positionsDirty = false;
  }

  setValue(index: number, value01: number, tint?: THREE.Color): void {
    if (index < 0 || index >= this.count) return;
    const next = clamp(value01);
    // A value *landing* is an event: it earns a burst. A value being re-set to
    // what it already was is not.
    if (Math.abs(next - this.fillTarget[index]) > 0.004 || this.fill[index] < 0.001) {
      this.burst[index] = 1;
    }
    this.fillTarget[index] = next;
    if (tint) this.tint[index].copy(tint);
  }

  /** 0..1 per-ring boot reveal. The rig staggers these; the bank just obeys. */
  setReveal(index: number, value01: number): void {
    if (index < 0 || index >= this.count) return;
    const next = clamp(value01);
    if (Math.abs(next - this.reveal[index]) < 0.0005) return;
    this.reveal[index] = next;
    this.positionsDirty = true;
  }

  /** The ring Evia is currently talking about, or -1. */
  setFocus(index: number | null): void {
    this.focus = index ?? -1;
  }

  /** True while any ring still has a landing burst in flight. */
  get bursting(): boolean {
    for (let r = 0; r < this.count; r++) if (this.burst[r] > 0) return true;
    return false;
  }

  update(dt: number, presence: number, elapsed: number, glitch = 0): void {
    (this.mesh.material as THREE.Material & { opacity: number }).opacity = presence;
    this.mesh.visible = presence > 0.004;
    if (!this.mesh.visible) return;
    if (this.positionsDirty) this.writePositions();

    const arr = this.colors.array as Float32Array;
    // A slow global shimmer chasing round the outer track. This is the single
    // cheapest cue that the interface is *live* rather than printed.
    const chase = (elapsed * 0.14) % 1;

    for (let r = 0; r < this.count; r++) {
      this.fill[r] += (this.fillTarget[r] - this.fill[r]) * Math.min(1, dt * 3.2);
      if (this.burst[r] > 0) this.burst[r] = Math.max(0, this.burst[r] - dt / BURST_SECONDS);

      const c = this.tint[r];
      const base = r * VERTS_PER_RING;
      const filled = this.fill[r] * VALUE_SEGS;
      const focused = this.focus === r;
      // Flicker keeps it feeling projected. Glitch frames punch straight through
      // it so the dropout reads as the projector stuttering, not as a fade.
      const flicker = (0.9 + Math.sin(elapsed * 5.1 + r * 1.7) * 0.06) * (1 + glitch * 0.9);
      const focusGain = focused ? 1.45 + Math.sin(elapsed * 3.4) * 0.12 : 1;
      const reveal = this.reveal[r];
      const gain = flicker * focusGain * reveal;

      const write = (index: number, k: number) => {
        const i = index * 3;
        arr[i] = c.r * k;
        arr[i + 1] = c.g * k;
        arr[i + 2] = c.b * k;
      };

      // --- value arc -------------------------------------------------------
      for (let s = 0; s <= VALUE_SEGS; s++) {
        const lit = s <= filled ? 1 : 0.11;
        // A bright head at the leading edge: the gauge is being written, not
        // displayed.
        const head = this.fill[r] > 0.015 && s > filled - 2.2 && s <= filled ? 2.1 : 1;
        const k = lit * head * gain;
        write(base + OFF_VALUE + s * 2, k);
        write(base + OFF_VALUE + s * 2 + 1, k * 0.82);
      }

      // --- outer track -----------------------------------------------------
      for (let s = 0; s <= TRACK_SEGS; s++) {
        const t = s / TRACK_SEGS;
        // `chase` is a bright dot running the track. On the low tier the track
        // is flat — it is the most-overdrawn per-frame maths here for the least
        // legibility gain.
        const shimmer = this.rich ? 0.55 * Math.pow(Math.max(0, Math.cos((t - chase) * Math.PI * 2)), 14) : 0;
        const k = (0.2 + shimmer) * gain;
        write(base + OFF_TRACK + s * 2, k);
        write(base + OFF_TRACK + s * 2 + 1, k);
      }

      // --- graduations -----------------------------------------------------
      for (let k = 0; k < TICK_COUNT; k++) {
        const t = k / (TICK_COUNT - 1);
        // Ticks latch on as the fill passes them: a discrete readout beside the
        // continuous one, which is what makes it read as an instrument.
        const passed = t <= this.fill[r] + 1e-4;
        const justPassed = passed && t > this.fill[r] - 0.06;
        const v = (passed ? (justPassed ? 1.5 : 0.78) : 0.16) * gain;
        const i = base + OFF_TICK + k * 4;
        write(i, v * 0.55);
        write(i + 1, v * 0.55);
        write(i + 2, v);
        write(i + 3, v);
      }

      // --- landing burst ---------------------------------------------------
      const env = this.burst[r];
      if (env <= 0) {
        for (let k = 0; k < BURST_SPIKES * 4; k++) write(base + OFF_BURST + k, 0);
      } else {
        // The wavefront travels from the inner radius outward as the envelope
        // decays. Only two radial samples exist per spike, so the quad's own
        // interpolation does the gradient for free.
        const front = 1 - env;
        const inner = bump(0 - front, 0.42) * env * 2.6;
        const outer = bump(1 - front, 0.42) * env * 2.6;
        for (let k = 0; k < BURST_SPIKES; k++) {
          const i = base + OFF_BURST + k * 4;
          write(i, inner);
          write(i + 1, inner);
          write(i + 2, outer);
          write(i + 3, outer);
        }
      }
    }
    this.colors.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// FaceModel — the scanned-face visualisation, its regions and its reticle
// ---------------------------------------------------------------------------

/**
 * The nine anatomical regions the ROI stage actually produces (§3). Naming them
 * the same thing in the hologram is the point: when Evia says "around your
 * cheeks", the patch that lights up is the region the number came from.
 */
export type FaceRegion =
  | 'forehead'
  | 'glabella'
  | 'nose'
  | 'cheekL'
  | 'cheekR'
  | 'periorbitalL'
  | 'periorbitalR'
  | 'perioral'
  | 'chin';

const FACE_REGIONS: FaceRegion[] = [
  'forehead',
  'glabella',
  'nose',
  'cheekL',
  'cheekR',
  'periorbitalL',
  'periorbitalR',
  'perioral',
  'chin',
];

/**
 * Region placement in the face model's own (t, u) parameter space, where t runs
 * crown (0) to chin (1) and u runs left (0) through centre (0.5) to right (1).
 */
const REGION_BOXES: Record<FaceRegion, { t: number; u: number; ht: number; hu: number }> = {
  forehead: { t: 0.19, u: 0.5, ht: 0.085, hu: 0.2 },
  glabella: { t: 0.33, u: 0.5, ht: 0.04, hu: 0.062 },
  periorbitalL: { t: 0.435, u: 0.305, ht: 0.045, hu: 0.075 },
  periorbitalR: { t: 0.435, u: 0.695, ht: 0.045, hu: 0.075 },
  nose: { t: 0.505, u: 0.5, ht: 0.09, hu: 0.055 },
  cheekL: { t: 0.555, u: 0.255, ht: 0.082, hu: 0.088 },
  cheekR: { t: 0.555, u: 0.745, ht: 0.082, hu: 0.088 },
  perioral: { t: 0.715, u: 0.5, ht: 0.05, hu: 0.1 },
  chin: { t: 0.855, u: 0.5, ht: 0.052, hu: 0.085 },
};

/**
 * Which regions light up for which metric. Straight out of §3's formulas — the
 * T-zone for oiliness, cheeks for the CIELAB a* baseline, infraorbital for
 * under-eye — so the highlight is never decorative.
 */
export const METRIC_FACE_REGIONS: Record<SkinMetricKey, FaceRegion[]> = {
  hydration: ['cheekL', 'cheekR'],
  oiliness: ['forehead', 'nose', 'glabella'],
  redness: ['cheekL', 'cheekR', 'nose'],
  texture: ['cheekL', 'cheekR', 'perioral'],
  pores: ['nose', 'glabella'],
  darkSpots: ['cheekL', 'cheekR', 'forehead'],
  evenness: ['forehead', 'cheekL', 'cheekR', 'chin'],
  underEye: ['periorbitalL', 'periorbitalR'],
  acneIndicators: ['chin', 'perioral', 'forehead'],
};

/**
 * Where each region sits on the contour model, in its own local space.
 *
 * Derived from `REGION_BOXES` with the same mapping `vertex()` uses, so a
 * leader line drawn to one of these lands exactly on the patch that lights up.
 * Exported because the rig needs to point at these from outside.
 */
export const REGION_ANCHORS: Record<string, { x: number; y: number; z: number }> =
  Object.fromEntries(
    Object.entries(REGION_BOXES).map(([name, box]) => [
      name,
      {
        // Same front-half remap the geometry uses, so a leader line lands on
        // the patch it points at rather than halfway round the head.
        x: Math.sin((box.u - 0.5) * 0.5 * Math.PI * 2) * 0.145,
        y: 0.4 * (0.5 - box.t),
        z: 0.075,
      },
    ]),
  );

/** A round, edgeless falloff. The only texture the region glows need. */
function softSprite(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2,
  );
  // Squared falloff: a linear one still has a discernible rim.
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    gradient.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, 2.4)})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const PATCH_SEGS = 12;
const PATCH_HATCH = 3;
const RETICLE_SEGS = 18;

/**
 * A contour map of a face — horizontal slices plus vertical meridians — with
 * per-region highlight patches and a lock-on reticle folded into the *same*
 * LineSegments. One draw call for the whole face readout.
 *
 * Everything animates through vertex colour except the reticle, whose 36
 * vertices are rewritten each frame so it can fly between regions.
 */
export class FaceModel {
  readonly lines: THREE.LineSegments;
  /**
   * The same surface drawn again as points.
   *
   * A wire grid describes a shape; a field of points describes a *scan*. The
   * reference reads as crisp because it is dense and granular rather than
   * ruled, and the cheapest way to get that here is to draw the vertices this
   * geometry already has. It shares the buffer, so it costs one draw call and
   * no extra memory.
   */
  readonly points: THREE.Points;
  /** The dense surface sampling. This is what the model actually reads as. */
  readonly cloud: THREE.Points;
  /** Soft light over each measured region. See the note where it is built. */
  readonly glows: THREE.Mesh;
  private glowColors!: THREE.BufferAttribute;
  private glowTexture!: THREE.Texture;
  private cloudColors!: THREE.BufferAttribute;
  private cloudRegionOf!: Int8Array;
  /** 0..1 — how much surface detail each sample sits on. See `detailAt`. */
  private cloudDetail!: Float32Array;
  private cloudCount = 0;
  readonly height: number;

  private colors: THREE.BufferAttribute;
  private positions: THREE.BufferAttribute;
  /** Authored brightness per vertex, before any animation. */
  private baseIntensity: Float32Array;
  /** Local Y per vertex — lets the scan band light contours as it passes. */
  private localY: Float32Array;
  /** |y| normalised, 0 at the centre line: the iris reveal order. */
  private irisOrder: Float32Array;
  /** Region index per vertex, or -1 for the base contours. */
  private regionOf: Int8Array;

  private reticleStart: number;
  private vertexCount: number;

  private tint = new THREE.Color(PALETTE.holo);
  private patchTint = new THREE.Color(PALETTE.holo);
  private regionGain: Float32Array;
  private regionTarget: Float32Array;

  private reticleAt = new THREE.Vector3();
  private reticleTo = new THREE.Vector3();
  private reticleGain = 0;
  private reticleTarget = 0;
  private reticleSpan = 0.09;
  private reveal = 1;

  private rich: boolean;

  constructor(opts: { rich?: boolean } = {}) {
    this.rich = opts.rich !== false;

    const points: number[] = [];
    const intensity: number[] = [];
    const region: number[] = [];

    // Fewer contours than before. The grid is the surface the scan is drawn
    // on, and at 30 x 34 it was legible enough to be the drawing itself.
    const rows = 22;
    const cols = 26;
    const height = 0.40;
    this.height = height;

    /**
     * How far down the model runs, past the chin.
     *
     * The previous version stopped at the jaw and swept only the front 180°,
     * which is why it read as a mask rather than a head: a face-shaped shell
     * with nothing behind it and nothing under it. A head has a back and it
     * stands on a neck, and both are needed before the front reads as a face.
     */
    const NECK_END = 1.26;

    /**
     * Silhouette width at each height, front-on.
     *
     * Retuned off the render. The crown fell away over the top 16% at a power
     * of 1.7, which is a point, not a skull — and combined with a jaw that lost
     * 56% of its width over the bottom 40% the whole thing read as a lightbulb.
     * A head is widest across the parietals at about a third of the way down,
     * loses very little going up from there, and narrows into the chin on a
     * curve that starts at the cheekbone rather than at the ear.
     */
    const widthAt = (t: number) => {
      if (t > 1) {
        // Neck, straight down. Any flare at all reads as the top of a vase,
        // because the shoulders that would explain it are not in this model —
        // and the base is dissolving anyway, so it never resolves into a shape.
        return 0.128 * 0.4;
      }
      const crown = 1 - Math.pow(clamp((0.28 - t) / 0.28), 2.1) * 0.32;
      const cheek = 1 + 0.035 * Math.exp(-Math.pow((t - 0.5) / 0.16, 2));
      const jaw = 1 - Math.pow(clamp((t - 0.54) / 0.46), 2.1) * 0.6;
      return 0.128 * crown * cheek * jaw;
    };

    /**
     * Depth radius at each height.
     *
     * The comment above this function always claimed the head was deeper than
     * it was wide; the number said 0.062 against a half-width of 0.128, so it
     * was half as deep. That is a mask on a stick — and it is why turning the
     * model showed nothing and every profile view collapsed. A head is roughly
     * 20cm front to back against 15cm across, so depth leads width here.
     */
    const depthRadius = (t: number) => {
      if (t > 1) return 0.062 * 0.62;
      const crown = 1 - Math.pow(clamp((0.2 - t) / 0.2), 2) * 0.24;
      const jaw = 1 - Math.pow(clamp((t - 0.58) / 0.42), 1.9) * 0.46;
      return 0.086 * crown * jaw;
    };

    /**
     * The features, as displacement along the surface normal.
     *
     * Applied on top of a full ellipsoid of revolution rather than baked into a
     * front-facing sheet, so the brow, nose and chin sit *on* a head instead of
     * being the whole of it.
     */
    const relief = (t: number, front: number, centre: number, lateral: number) => {
      if (t > 1) return 0;
      let d = 0;
      /*
       * Eye sockets, cut into the surface.
       *
       * Every other feature on this model was additive — a brow, a nose, a
       * chin, all pushed out of an ovoid — so the contour rings ran across the
       * face without ever being interrupted by it, and the result was an egg
       * with a face drawn on. The sockets are the one place a head goes
       * inwards, and they are what a horizontal contour has to dip into before
       * it reads as passing over a face rather than around a shape.
       *
       * `lateral` is sin(angle): the eye centres sit at u = 0.33 and 0.67 in
       * the authored front-facing space, which the front-half remap puts at
       * |lateral| ≈ 0.51.
       */
      const socket =
        Math.exp(-Math.pow((t - 0.425) / 0.06, 2)) *
        Math.exp(-Math.pow((Math.abs(lateral) - 0.51) / 0.24, 2)) *
        Math.max(0, front);
      d -= 0.0105 * socket;
      // Lips have volume; a mouth drawn only as lines sits on a flat plane.
      d += 0.005 * centre * Math.exp(-Math.pow((t - 0.745) / 0.045, 2));
      // Brow ridge.
      d += 0.008 * front * Math.exp(-Math.pow((t - 0.375) / 0.05, 2));
      // Nose: a ridge down the centre line, proudest at the tip.
      d += 0.03 * centre * Math.exp(-Math.pow((t - 0.53) / 0.12, 2));
      // Chin.
      d += 0.01 * centre * Math.exp(-Math.pow((t - 0.87) / 0.06, 2));
      // The back of the skull is fuller than a plain ellipsoid.
      d += 0.012 * Math.max(0, -front) * Math.exp(-Math.pow((t - 0.36) / 0.26, 2));
      return d;
    };

    /**
     * Maps a front-facing u (0..1 across the visible face) onto the full sweep.
     *
     * Every feature curve, region box and callout anchor in this file was
     * authored against a 180° sweep where u ran across the face. The sweep is
     * now 360°, so those coordinates would land halfway round the head. This
     * keeps all of that tuning valid by compressing the old range into the
     * front half.
     */
    const faceU = (u: number) => 0.5 + (u - 0.5) * 0.5;

    const vertex = (t: number, u: number, lift = 0): [number, number, number] => {
      const angle = (u - 0.5) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      // cos is +1 dead ahead and -1 at the back, which is exactly the weight
      // the facial relief should carry.
      const front = cos;
      const centre = Math.exp(-Math.pow(sin / 0.34, 2)) * Math.max(0, cos);
      const r = relief(t, front, centre, sin);
      const w = widthAt(t) + r * 0.35;
      const d = depthRadius(t) + r;
      const y = t <= 1
        ? height * (0.5 - t)
        : height * (0.5 - 1) - (t - 1) * height * 0.5;
      return [sin * w, y, cos * d + lift * cos];
    };

    const push = (
      a: [number, number, number],
      b: [number, number, number],
      k: number,
      reg: number,
    ) => {
      points.push(...a, ...b);
      intensity.push(k, k);
      region.push(reg, reg);
    };

    // Horizontal contours. Brow, eye and mouth lines read brighter — the
    // contours a clinician actually reads.
    for (let r = 0; r < rows; r++) {
      const t = (r / (rows - 1)) * NECK_END;
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        // Faint. The cloud carries the form now; these are the structure under
        // it, and at the old weight they buried it.
        push(vertex(t, cIdx / cols), vertex(t, (cIdx + 1) / cols), 0.055, -1);
      }
    }

    // Vertical meridians.
    for (let cIdx = 0; cIdx <= cols; cIdx += 2) {
      const u = cIdx / cols;
      for (let r = 0; r < rows - 1; r++) {
        push(
          vertex((r / (rows - 1)) * NECK_END, u),
          vertex(((r + 1) / (rows - 1)) * NECK_END, u),
          0.04,
          -1,
        );
      }
    }

    // --- features ----------------------------------------------------------
    //
    // The single reason this model used to read as a barrel rather than a face.
    //
    // An evenly spaced grid over an ovoid is a *scan mesh*: it describes a
    // volume and says nothing about whose volume it is. Raising the contrast on
    // three of its rings did not help, because a ring at brow height is still a
    // ring — it follows the silhouette, not the brow. A face is legible from
    // its features, so the features are drawn explicitly, sit proud of the
    // substrate, and carry most of the brightness. The grid behind them is now
    // dim enough to read as the surface they are drawn on.
    //
    // Everything is authored in (t, u): t runs 0 at the crown to 1 at the chin,
    // u runs 0 to 1 across with 0.5 on the centre line. Going through `vertex`
    // means every feature lies on the same surface as the mesh, so none of them
    // float or need separate depth handling.
    const FEATURE_LIFT = 0.006;
    const KEY = 1.7;
    const SOFT = 1.0;

    /** A polyline through (t, u) samples, laid onto the surface. */
    const stroke = (
      samples: Array<[number, number]>,
      k: number,
      closed = false,
    ) => {
      for (let i = 0; i < samples.length - 1; i++) {
        push(
          vertex(samples[i][0], faceU(samples[i][1]), FEATURE_LIFT),
          vertex(samples[i + 1][0], faceU(samples[i + 1][1]), FEATURE_LIFT),
          k,
          -1,
        );
      }
      if (closed && samples.length > 2) {
        push(
          vertex(samples[samples.length - 1][0], faceU(samples[samples.length - 1][1]), FEATURE_LIFT),
          vertex(samples[0][0], faceU(samples[0][1]), FEATURE_LIFT),
          k,
          -1,
        );
      }
    };

    /** Samples an arc in (t, u) — the shape most features reduce to. */
    const arc = (
      tc: number,
      uc: number,
      tr: number,
      ur: number,
      from: number,
      to: number,
      segs = 10,
    ): Array<[number, number]> =>
      Array.from({ length: segs + 1 }, (_, i) => {
        const a = from + ((to - from) * i) / segs;
        return [tc + Math.sin(a) * tr, uc + Math.cos(a) * ur] as [number, number];
      });

    // Eyes at u = 0.33 / 0.67, brows above them, on the same centres — an eye
    // and its brow that do not share a centre read as a squint.
    for (const side of [-1, 1]) {
      const u = 0.5 + side * 0.17;

      // Brow: a flatter arc than the eye, and it lifts towards the outer end.
      stroke(
        [
          [0.345, u - 0.105 * side],
          [0.323, u - 0.045 * side],
          [0.318, u + 0.02 * side],
          [0.331, u + 0.075 * side],
        ],
        KEY,
      );

      // Eye: an almond, not an ellipse. The upper lid is the more curved of the
      // two, and the corners meet at a point — an ellipse here reads as a
      // cartoon eye stuck onto a mesh.
      stroke(
        [
          [0.425, u - 0.085],
          [0.404, u - 0.04],
          [0.399, u + 0.01],
          [0.409, u + 0.055],
          [0.428, u + 0.085],
          [0.439, u + 0.04],
          [0.441, u - 0.01],
          [0.437, u - 0.05],
        ],
        KEY,
        true,
      );

      // Iris, dim: it is the thing the eye is pointed at, and at this scale a
      // bright one would be the loudest mark on the whole model.
      stroke(arc(0.421, u, 0.016, 0.026, 0, Math.PI * 2, 8), SOFT * 0.7, true);

      // Cheekbone sweep — the contour that gives the mid-face its width.
      stroke(
        [
          [0.5, u + side * 0.1],
          [0.545, u + side * 0.055],
          [0.6, u - side * 0.005],
        ],
        SOFT * 0.8,
      );
    }

    // Nose: two ridge lines rather than one. A single centre line reads as a
    // seam down the middle of the model; a pair reads as a bridge with width.
    for (const side of [-1, 1]) {
      stroke(
        [
          [0.345, 0.5 + side * 0.022],
          [0.46, 0.5 + side * 0.026],
          [0.55, 0.5 + side * 0.034],
          [0.6, 0.5 + side * 0.045],
        ],
        SOFT,
      );
    }
    // Nose base and the nostril wings.
    stroke(arc(0.612, 0.5, -0.018, 0.052, -Math.PI / 2, Math.PI / 2, 10), KEY);

    // Mouth. The upper lip carries the bow, the lower is a single curve, and
    // the corners are where they meet — that junction is what makes it a mouth
    // rather than a line.
    stroke(
      [
        [0.735, 0.5 - 0.072],
        [0.722, 0.5 - 0.035],
        [0.729, 0.5 - 0.012],
        [0.724, 0.5],
        [0.729, 0.5 + 0.012],
        [0.722, 0.5 + 0.035],
        [0.735, 0.5 + 0.072],
      ],
      KEY,
    );
    stroke(
      [
        [0.735, 0.5 - 0.072],
        [0.762, 0.5 - 0.035],
        [0.769, 0.5],
        [0.762, 0.5 + 0.035],
        [0.735, 0.5 + 0.072],
      ],
      KEY,
    );

    // Jaw, from just under each ear to the chin. This is the contour that
    // separates a face from an egg in a front view.
    stroke(
      [
        [0.6, 0.5 - 0.235],
        [0.71, 0.5 - 0.205],
        [0.82, 0.5 - 0.15],
        [0.9, 0.5 - 0.075],
        [0.925, 0.5],
        [0.9, 0.5 + 0.075],
        [0.82, 0.5 + 0.15],
        [0.71, 0.5 + 0.205],
        [0.6, 0.5 + 0.235],
      ],
      SOFT,
    );

    /*
     * --- region patches ---------------------------------------------------
     *
     * An ellipse in (t, u) lifted proud of the contours so it never z-fights,
     * plus three hatch lines across it.
     *
     * Drawn faint. At full weight these were the brightest thing on the model:
     * a hard oval on the forehead, one on each cheek, one on the chin, and with
     * four of them lit at once for a presented result the head read as a mask
     * with panels cut into it. The point of a region was never the ring around
     * it — it was the area inside, which the scan cloud now lights directly.
     * The outline is only there to say where the area ends.
     */
    const LIFT = 0.009;
    for (const name of FACE_REGIONS) {
      const box = REGION_BOXES[name];
      const idx = FACE_REGIONS.indexOf(name);
      const at = (a: number): [number, number, number] =>
        vertex(box.t + Math.sin(a) * box.ht, faceU(box.u + Math.cos(a) * box.hu), LIFT);
      for (let s = 0; s < PATCH_SEGS; s++) {
        push(
          at((s / PATCH_SEGS) * Math.PI * 2),
          at(((s + 1) / PATCH_SEGS) * Math.PI * 2),
          0.16,
          idx,
        );
      }
      for (let h = 0; h < PATCH_HATCH; h++) {
        const ht = box.t + ((h + 0.5) / PATCH_HATCH - 0.5) * box.ht * 1.5;
        const span = box.hu * 0.78;
        push(vertex(ht, faceU(box.u - span), LIFT), vertex(ht, faceU(box.u + span), LIFT), 0.2, idx);
      }
    }

    // --- lock-on reticle ---------------------------------------------------
    // Placeholder geometry; `writeReticle` rewrites all of it every frame.
    this.reticleStart = points.length / 3;
    for (let s = 0; s < RETICLE_SEGS; s++) push([0, 0, 0], [0, 0, 0], 1, -2);

    /*
     * The scan cloud.
     *
     * Drawing points at the *line vertices* only put them where the wires
     * already were, so the model stayed a lattice with dots on its corners.
     * This samples the surface on its own much finer grid, which is what makes
     * a scan read as a scan: density carrying the form, with the wireframe
     * demoted to a faint structure underneath rather than being the whole
     * drawing.
     *
     * Points are coloured per region, so lighting a metric lights the part of
     * the face it was measured from — the same channel the patches use, now
     * visible across the whole surface instead of only inside a small ellipse.
     */
    const cloudPositions: number[] = [];
    const cloudRegion: number[] = [];
    const cloudDetail: number[] = [];
    const CLOUD_ROWS = 92;
    const CLOUD_COLS = 104;
    /*
     * A deterministic hash, so the jitter is stable across reloads.
     *
     * Offsetting alternate rows sideways was not enough: it staggered the
     * columns and left the rows exactly where they were, so at 74 of them
     * across a 40cm head the cloud rendered as horizontal banding — a finer
     * lattice, which is the thing the cloud was added to stop being. Samples
     * have to move in *t* as well, and by a different amount each, or the
     * structure of the sampling stays visible in the result.
     */
    const hash = (a: number, b: number) => {
      const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };

    /*
     * Where the detail is.
     *
     * A uniform cloud over a head is a cloud of a head-shaped object: every
     * sample is worth the same, so nothing in it is a face. Real capture does
     * not work that way — a scanner spends its samples where the surface has
     * something to say, which on a face is the brows, the eyes, the nose, the
     * mouth and the jawline, and almost nowhere else. Weighting both the
     * density and the brightness by this is what pulls a face out of the
     * points instead of drawing one on top of them.
     *
     * Coordinates are the same (t, u) the feature curves above are authored in,
     * so the two describe the same face rather than two nearby ones.
     */
    const blob = (
      t: number, u: number, tc: number, uc: number, tr: number, ur: number,
    ) => Math.exp(-(Math.pow((t - tc) / tr, 2) + Math.pow((u - uc) / ur, 2)));

    const detailAt = (t: number, u: number) => {
      let d = 0;
      for (const side of [-1, 1]) {
        const eu = 0.5 + side * 0.17;
        d += 0.85 * blob(t, u, 0.328, eu, 0.026, 0.075);  // brow
        d += 1.0 * blob(t, u, 0.42, eu, 0.03, 0.07);      // eye
        d += 0.4 * blob(t, u, 0.55, eu - side * 0.04, 0.05, 0.06); // cheekbone
      }
      d += 0.55 * blob(t, u, 0.47, 0.5, 0.075, 0.03);     // nose bridge
      d += 0.9 * blob(t, u, 0.608, 0.5, 0.03, 0.05);      // nose base
      d += 1.0 * blob(t, u, 0.745, 0.5, 0.035, 0.06);     // mouth
      d += 0.5 * blob(t, u, 0.87, 0.5, 0.04, 0.07);       // chin
      d += 0.45 * blob(t, u, 0.2, 0.5, 0.05, 0.3);        // hairline
      return Math.min(1, d);
    };

    const dt = NECK_END / (CLOUD_ROWS - 1);
    const du = 1 / CLOUD_COLS;
    for (let r = 0; r < CLOUD_ROWS; r++) {
      for (let c = 0; c < CLOUD_COLS; c++) {
        const t = Math.min(
          NECK_END,
          Math.max(0, (r / (CLOUD_ROWS - 1)) * NECK_END + (hash(r, c) - 0.5) * dt * 1.6),
        );
        const u = (c + (hash(c, r) - 0.5) * 1.6) * du;

        // `detailAt` is authored front-on, so it is asked about the front-facing
        // coordinate — the same inverse the region lookup below uses.
        const frontUForDetail = 0.5 + (u - 0.5) * 2;
        const detail = detailAt(t, frontUForDetail) * Math.max(0, Math.cos((u - 0.5) * Math.PI * 2));

        // Thin the featureless areas out. Cheap on an integrated GPU, and the
        // uneven density is itself the thing that reads as captured data.
        if (hash(r + 7.3, c + 13.1) > 0.42 + 0.58 * detail) continue;

        const [x, y, z] = vertex(t, u, 0.001);
        cloudPositions.push(x, y, z);
        cloudDetail.push(detail);

        // Which region, if any, this sample belongs to. Measured in the
        // authored front-facing space, hence the inverse of `faceU`.
        const frontU = 0.5 + (u - 0.5) * 2;
        let owner = -1;
        for (let i = 0; i < FACE_REGIONS.length; i++) {
          const box = REGION_BOXES[FACE_REGIONS[i]];
          if (
            Math.abs(t - box.t) < box.ht * 1.15 &&
            Math.abs(frontU - box.u) < box.hu * 1.15
          ) {
            owner = i;
            break;
          }
        }
        cloudRegion.push(owner);
      }
    }
    this.cloudRegionOf = new Int8Array(cloudRegion);
    this.cloudDetail = new Float32Array(cloudDetail);
    this.cloudCount = cloudPositions.length / 3;

    const cloudGeo = new THREE.BufferGeometry();
    cloudGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(cloudPositions, 3),
    );
    this.cloudColors = new THREE.BufferAttribute(
      new Float32Array(this.cloudCount * 3),
      3,
    );
    this.cloudColors.setUsage(THREE.DynamicDrawUsage);
    cloudGeo.setAttribute('color', this.cloudColors);

    this.cloud = new THREE.Points(
      cloudGeo,
      new THREE.PointsMaterial({
        size: 0.0042,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        fog: false,
      }),
    );
    this.cloud.frustumCulled = false;
    this.cloud.renderOrder = 8;

    /*
     * Region glows.
     *
     * A lit region needs to look like an *area* of the face glowing. Drawing
     * its boundary was the obvious way to say which area, and it was the wrong
     * one: a ring on a forehead is a ring on a forehead however dim it gets,
     * and four of them at once is a mask with panels in it. Brightening the
     * cloud inside the region is right in principle but invisible in practice —
     * the samples are a pixel across, and a pixel does not glow.
     *
     * So: one soft sprite per region, sized to the region, additive, dark until
     * its metric is the subject. Nine quads in a single geometry with per-vertex
     * colour, which is eighteen triangles and one draw call for the whole set.
     */
    const glowPositions: number[] = [];
    const glowUvs: number[] = [];
    const glowIndices: number[] = [];
    for (let i = 0; i < FACE_REGIONS.length; i++) {
      const box = REGION_BOXES[FACE_REGIONS[i]];
      const anchor = REGION_ANCHORS[FACE_REGIONS[i]];
      // Generous against the box: a glow with a visible boundary is an outline
      // again, so it has to run past the region it belongs to.
      const hx = box.hu * 0.29 * 2.1;
      const hy = box.ht * height * 2.1;
      const base = i * 4;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        glowPositions.push(anchor.x + sx * hx, anchor.y + sy * hy, anchor.z + 0.004);
        glowUvs.push((sx + 1) / 2, (sy + 1) / 2);
      }
      glowIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(glowPositions, 3),
    );
    glowGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(glowUvs, 2));
    this.glowColors = new THREE.BufferAttribute(
      new Float32Array(FACE_REGIONS.length * 4 * 3),
      3,
    );
    this.glowColors.setUsage(THREE.DynamicDrawUsage);
    glowGeometry.setAttribute('color', this.glowColors);
    glowGeometry.setIndex(glowIndices);

    this.glowTexture = softSprite();
    this.glows = new THREE.Mesh(
      glowGeometry,
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        fog: false,
      }),
    );
    this.glows.frustumCulled = false;
    // Under the contours and the cloud: the glow is what the face is lit by,
    // not something printed over it.
    this.glows.renderOrder = 6;

    this.vertexCount = points.length / 3;
    this.baseIntensity = new Float32Array(intensity);
    this.regionOf = new Int8Array(region);
    this.localY = new Float32Array(this.vertexCount);
    this.irisOrder = new Float32Array(this.vertexCount);
    for (let i = 0; i < this.vertexCount; i++) {
      const y = points[i * 3 + 1];
      this.localY[i] = y;
      this.irisOrder[i] = clamp(Math.abs(y) / (height * 0.5));
    }

    this.regionGain = new Float32Array(FACE_REGIONS.length);
    this.regionTarget = new Float32Array(FACE_REGIONS.length);

    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(points), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.BufferAttribute(new Float32Array(this.vertexCount * 3), 3);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('color', this.colors);

    this.lines = new THREE.LineSegments(geo, additiveLines({ opacity: 0 }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;

    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: PALETTE.holo,
        size: 0.0055,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  /** Boot iris: 0 shows only the centre line, 1 shows the whole face. */
  setReveal(v: number): void {
    this.reveal = clamp(v);
  }

  /**
   * Light the regions behind `metric`, tinted the same colour its ring is using,
   * and fly the reticle to their centroid. `null` releases the lock.
   */
  /**
   * Lights several metrics' regions at once and leaves them lit.
   *
   * `setRegionFocus` is momentary and exclusive — it is what a hover does. This
   * is the resting state of a completed scan: the areas the reading actually
   * came from, glowing, the whole time the result is on screen. Without it the
   * region machinery only ever fired while a pointer happened to be over a row,
   * so on a still frame the face was uniformly lit and said nothing.
   */
  highlightMetrics(metrics: SkinMetricKey[], weight = 0.7): void {
    this.regionTarget.fill(0);
    for (const metric of metrics) {
      for (const name of METRIC_FACE_REGIONS[metric]) {
        const index = FACE_REGIONS.indexOf(name);
        if (index >= 0) this.regionTarget[index] = weight;
      }
    }
    this.reticleTarget = 0;
  }

  setRegionFocus(metric: SkinMetricKey | null, tint?: THREE.Color): void {
    this.regionTarget.fill(0);
    if (!metric) {
      this.reticleTarget = 0;
      return;
    }
    if (tint) this.patchTint.copy(tint);

    const regions = METRIC_FACE_REGIONS[metric];
    let cx = 0;
    let cy = 0;
    let span = 0;
    for (const name of regions) {
      const idx = FACE_REGIONS.indexOf(name);
      this.regionTarget[idx] = 1;
      const box = REGION_BOXES[name];
      // Reticle rides in the model's own local space, mirroring `vertex()`.
      cx += Math.sin((box.u - 0.5) * Math.PI) * 0.145;
      cy += this.height * (0.5 - box.t);
      span = Math.max(span, box.hu * 1.9);
    }
    const n = Math.max(1, regions.length);
    this.reticleTo.set(cx / n, cy / n, 0.075);
    // A multi-region metric gets a wider bracket, so the reticle describes what
    // was actually measured rather than pointing at an average.
    this.reticleSpan = clamp(0.055 + span * 0.5 + (regions.length - 1) * 0.02, 0.05, 0.16);
    this.reticleTarget = 1;
  }

  setTint(color: THREE.Color): void {
    this.tint.copy(color);
  }

  /**
   * `scanProgress` is the *real* pipeline progress. Contours within the sweep's
   * neighbourhood light up as it passes, which is what turns a moving band into
   * something that reads as measuring rather than decorating.
   */
  /** Lights each region's sprite from the gain its metric is driving. */
  private writeGlows(elapsed: number, presence: number): void {
    const material = this.glows.material as THREE.Material & { opacity: number };
    material.opacity = presence;
    this.glows.visible = presence > 0.004;
    if (!this.glows.visible) return;

    const arr = this.glowColors.array as Float32Array;
    const c = this.patchTint;
    let anyLit = false;
    for (let i = 0; i < FACE_REGIONS.length; i++) {
      const pulse = 0.84 + 0.16 * Math.sin(elapsed * 2.3 + i * 1.9);
      const v = this.regionGain[i] * pulse * 0.5;
      if (v > 0.004) anyLit = true;
      for (let corner = 0; corner < 4; corner++) {
        const j = (i * 4 + corner) * 3;
        arr[j] = c.r * v;
        arr[j + 1] = c.g * v;
        arr[j + 2] = c.b * v;
      }
    }
    this.glowColors.needsUpdate = true;
    // Nine unlit quads still cost their fill; skip the draw when none are on.
    this.glows.visible = anyLit;
  }

  /**
   * Fades the model out through the bottom of the neck.
   *
   * The sweep ends at a fixed height, which drew a flat lid across the base and
   * turned a floating head into a bust on a plinth. Light does not end on a
   * straight edge; dissolving the last few centimetres is the difference
   * between a projection and an ornament.
   */
  private neckFade(y: number): number {
    // Dissolving over a quarter of the head's height, not a tenth: a short
    // fade still ends somewhere, and anywhere it ends is an edge.
    const bottom = -this.height * 0.5 - 0.062;
    return Math.min(1, Math.max(0, (y - bottom) / (this.height * 0.26)));
  }

  /**
   * Colours and reveals the scan cloud.
   *
   * Region gain drives colour here as well as on the patches, so lighting a
   * metric lights the whole area of the face it was measured from rather than a
   * small ellipse drawn on top of it — which is the difference between a
   * diagram of a face and a reading of one.
   */
  private writeCloud(
    elapsed: number,
    presence: number,
    scanProgress: number,
    glitch: number,
  ): void {
    const material = this.cloud.material as THREE.Material & { opacity: number };
    material.opacity = presence * 0.95;
    this.cloud.visible = presence > 0.004;
    if (!this.cloud.visible) return;

    const arr = this.cloudColors.array as Float32Array;
    const base = this.tint;
    const hot = this.patchTint;
    const positions = this.cloud.geometry.getAttribute('position') as THREE.BufferAttribute;

    const half = this.height * 0.5;
    const scanning = scanProgress > 0 && scanProgress < 1;
    const scanY = half - scanProgress * this.height;
    const driftY = half - (((elapsed * 0.09) % 1) * this.height);
    const bandY = scanning ? scanY : driftY;
    const bandWidth = scanning ? 0.028 : 0.05;
    const bandGain = scanning ? 2.4 : 0.55;
    const flicker = 0.9 + Math.sin(elapsed * 3.1) * 0.1 + glitch * 0.9;

    for (let i = 0; i < this.cloudCount; i++) {
      const region = this.cloudRegionOf[i];
      const lit = region >= 0 ? this.regionGain[region] : 0;

      // A slow shimmer that is not the same everywhere, so the surface looks
      // sampled rather than printed.
      const y = positions.getY(i);
      const twinkle = 0.72 + 0.28 * Math.sin(elapsed * 1.6 + i * 0.7);
      const band = 1 + bandGain * Math.exp(-Math.pow((y - bandY) / bandWidth, 2));

      const detail = this.cloudDetail[i];
      const k =
        twinkle * band * flicker * (0.46 + lit * 2.5) * (0.4 + detail * 1.5) * this.neckFade(y);
      const j = i * 3;
      arr[j] = (base.r + (hot.r - base.r) * lit) * k;
      arr[j + 1] = (base.g + (hot.g - base.g) * lit) * k;
      arr[j + 2] = (base.b + (hot.b - base.b) * lit) * k;
    }
    this.cloudColors.needsUpdate = true;
  }

  update(
    dt: number,
    elapsed: number,
    presence: number,
    scanProgress: number,
    glitch = 0,
  ): void {
    (this.lines.material as THREE.Material & { opacity: number }).opacity = presence;
    this.lines.visible = presence > 0.004;
    if (!this.lines.visible) return;

    this.writeCloud(elapsed, presence, scanProgress, glitch);
    this.writeGlows(elapsed, presence);

    const k = Math.min(1, dt * 5.5);
    for (let i = 0; i < this.regionGain.length; i++) {
      this.regionGain[i] += (this.regionTarget[i] - this.regionGain[i]) * k;
    }
    this.reticleGain += (this.reticleTarget - this.reticleGain) * k;
    this.reticleAt.lerp(this.reticleTo, Math.min(1, dt * 7));
    this.writeReticle(elapsed);

    const arr = this.colors.array as Float32Array;
    const c = this.tint;
    const pc = this.patchTint;
    const half = this.height * 0.5;

    // The scan band, in local Y. Only live while the pipeline is actually
    // running; the rest of the time a much softer band drifts down instead, so
    // the model is never completely static.
    const scanning = scanProgress > 0 && scanProgress < 1;
    const scanY = half - scanProgress * this.height;
    const driftY = half - (((elapsed * 0.09) % 1) * this.height);
    const glitchGain = 1 + glitch * 1.4;

    for (let i = 0; i < this.vertexCount; i++) {
      const reg = this.regionOf[i];
      const y = this.localY[i];

      if (reg === -2) {
        // Reticle.
        const v = this.reticleGain * (1.35 + Math.sin(elapsed * 6.2) * 0.2) * glitchGain;
        arr[i * 3] = pc.r * v;
        arr[i * 3 + 1] = pc.g * v;
        arr[i * 3 + 2] = pc.b * v;
        continue;
      }

      // Iris reveal: the model opens outward from its own centre line.
      const irisEdge = this.reveal * 1.12;
      const iris =
        this.irisOrder[i] <= irisEdge
          ? 1 + (this.reveal < 1 ? bump(this.irisOrder[i] - irisEdge, 0.09) * 2.2 : 0)
          : 0;
      if (iris === 0) {
        arr[i * 3] = 0;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = 0;
        continue;
      }

      let v = this.baseIntensity[i] * iris * glitchGain * this.neckFade(y);
      if (scanning) v *= 1 + 3.2 * bump(y - scanY, 0.028);
      else if (this.rich) v *= 1 + 0.42 * bump(y - driftY, 0.05);

      if (reg >= 0) {
        // Patch: nearly dark at rest, so the face is not permanently covered in
        // boxes, and unmistakable when its metric is the subject.
        /*
         * The outline is now an *edge*, not the light.
         *
         * At the old gain a lit region drew a hard bright ellipse on the face,
         * and four lit regions drew four of them — which is exactly the lighted
         * mask the model was supposed to stop being. The glow moved to the
         * point cloud, which fills the whole region instead of ringing it, so
         * all the outline has to do now is say where the patch ends.
         */
        const gain = this.regionGain[reg];
        const pulse = 0.82 + 0.18 * Math.sin(elapsed * 4.1 + reg);
        v *= 0.02 + 0.8 * gain * pulse;
        arr[i * 3] = pc.r * v;
        arr[i * 3 + 1] = pc.g * v;
        arr[i * 3 + 2] = pc.b * v;
      } else {
        arr[i * 3] = c.r * v;
        arr[i * 3 + 1] = c.g * v;
        arr[i * 3 + 2] = c.b * v;
      }
    }
    this.colors.needsUpdate = true;
  }

  /**
   * Four corner brackets, two crosshair ticks and a small ranging circle. It
   * breathes and counter-rotates slightly, which is what stops a static overlay
   * reading as a sticker.
   */
  private writeReticle(elapsed: number): void {
    const arr = this.positions.array as Float32Array;
    let v = this.reticleStart;
    const s = this.reticleSpan * (0.97 + Math.sin(elapsed * 2.6) * 0.03);
    const arm = s * 0.42;
    const { x, y, z } = this.reticleAt;

    const seg = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      rotate = false,
    ) => {
      const write = (px: number, py: number) => {
        let ox = px;
        let oy = py;
        if (rotate) {
          const a = elapsed * 0.55;
          ox = px * Math.cos(a) - py * Math.sin(a);
          oy = px * Math.sin(a) + py * Math.cos(a);
        }
        arr[v * 3] = x + ox;
        arr[v * 3 + 1] = y + oy;
        arr[v * 3 + 2] = z;
        v++;
      };
      write(ax, ay);
      write(bx, by);
    };

    for (const [sx, sy] of [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      seg(sx * s, sy * s, sx * (s - arm), sy * s);
      seg(sx * s, sy * s, sx * s, sy * (s - arm));
    }
    seg(-s * 1.22, 0, -s * 0.72, 0);
    seg(s * 1.22, 0, s * 0.72, 0);

    // Ranging circle, slowly turning inside the brackets.
    const ring = s * 0.5;
    const arcs = RETICLE_SEGS - 10;
    for (let i = 0; i < arcs; i++) {
      const a0 = (i / arcs) * Math.PI * 2;
      const a1 = ((i + 0.6) / arcs) * Math.PI * 2;
      seg(Math.cos(a0) * ring, Math.sin(a0) * ring, Math.cos(a1) * ring, Math.sin(a1) * ring, true);
    }

    this.positions.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();

    /*
     * The cloud, the glows and the glow sprite belong to this model too.
     *
     * They were missed originally, so every sign-in/sign-out cycle leaked a
     * texture, two geometries and three materials — the auth gate builds a
     * FaceModel when it goes up and disposes it when it comes down.
     *
     * `points` deliberately shares `lines.geometry`, disposed above, but it
     * owns its own material.
     */
    (this.points.material as THREE.Material).dispose();
    this.cloud.geometry.dispose();
    (this.cloud.material as THREE.Material).dispose();
    this.glows.geometry.dispose();
    (this.glows.material as THREE.Material).dispose();
    this.glowTexture.dispose();
  }
}

// ---------------------------------------------------------------------------
// ScanBeam — the sweep that tracks real pipeline progress
// ---------------------------------------------------------------------------

/** Half-heights and brightnesses of the stacked quads, widest and dimmest first. */
const BEAM_LAYERS: Array<[halfHeight: number, brightness: number, widthScale: number]> = [
  [1.0, 0.1, 1.15],
  [0.42, 0.26, 1.0],
  [0.16, 0.55, 0.94],
  [0.045, 1.35, 0.86],
];
/** Column positions across a band, and how bright each one is. */
const BEAM_COLS = [-1, -0.62, 0, 0.62, 1];
const BEAM_COL_K = [0.04, 0.8, 1, 0.8, 0.04];
const BEAM_VERTS_PER_LAYER = BEAM_COLS.length * 2;
const BEAM_VERTS_PER_BAND = BEAM_LAYERS.length * BEAM_VERTS_PER_LAYER;

/**
 * Two horizontal bands in one mesh: a small one crossing the face model and a
 * wide one crossing *her*, both driven by `setProgress` from the real pipeline.
 *
 * The glow is faked by stacking four additive quads of decreasing height and
 * increasing brightness in the same plane. Additive blending sums them, so the
 * result is a hot core with a smooth falloff — a bloom without a bloom pass,
 * which the budget forbids (§9).
 */
export class ScanBeam {
  readonly mesh: THREE.Mesh;
  private positions: THREE.BufferAttribute;
  private faceBand = { x: 0, z: 0, width: 0.34, top: 0, bottom: 0 };
  private bodyBand = { x: 0, z: 0, width: 1.2, top: 0, bottom: 0 };
  private progress = 0;
  private opacity = 0;

  constructor() {
    const verts = BEAM_VERTS_PER_BAND * 2;
    const positions = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    const indices: number[] = [];
    const c = new THREE.Color(PALETTE.holo);

    for (let band = 0; band < 2; band++) {
      for (let l = 0; l < BEAM_LAYERS.length; l++) {
        const base = band * BEAM_VERTS_PER_BAND + l * BEAM_VERTS_PER_LAYER;
        // A quad strip across the columns: bright core, ends fading to nothing
        // so the band has no hard edge in mid-air.
        for (let col = 0; col < BEAM_COLS.length - 1; col++) {
          const a = base + col * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const k = BEAM_LAYERS[l][1];
        for (let col = 0; col < BEAM_COLS.length; col++) {
          const f = k * BEAM_COL_K[col];
          for (let row = 0; row < 2; row++) {
            const i = (base + col * 2 + row) * 3;
            colors[i] = c.r * f;
            colors[i + 1] = c.g * f;
            colors[i + 2] = c.b * f;
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(positions, 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);

    this.mesh = new THREE.Mesh(geo, additive({ opacity: 0 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  /** Both bands are placed by the layout solver, never hardcoded. */
  place(
    face: { x: number; z: number; width: number; top: number; bottom: number },
    body: { x: number; z: number; width: number; top: number; bottom: number },
  ): void {
    this.faceBand = { ...face };
    this.bodyBand = { ...body };
    this.writePositions();
  }

  setProgress(p: number): void {
    this.progress = clamp(p);
  }

  private writePositions(): void {
    const arr = this.positions.array as Float32Array;
    const bands = [this.faceBand, this.bodyBand];
    for (let b = 0; b < 2; b++) {
      const band = bands[b];
      const y = band.top + (band.bottom - band.top) * this.progress;
      for (let l = 0; l < BEAM_LAYERS.length; l++) {
        const [halfH, , widthScale] = BEAM_LAYERS[l];
        const h = halfH * band.width * 0.22;
        const w = (band.width * widthScale) / 2;
        const base = b * BEAM_VERTS_PER_BAND + l * BEAM_VERTS_PER_LAYER;
        for (let col = 0; col < BEAM_COLS.length; col++) {
          const x = band.x + BEAM_COLS[col] * w;
          // A shallow bow across the width: the band sags at its ends, which
          // sells it as a plane passing through her rather than a bar pasted on.
          const sag = -Math.abs(BEAM_COLS[col]) * h * 0.9;
          for (let row = 0; row < 2; row++) {
            const i = (base + col * 2 + row) * 3;
            arr[i] = x;
            arr[i + 1] = y + sag + (row === 0 ? -h : h);
            arr[i + 2] = band.z;
          }
        }
      }
    }
    this.positions.needsUpdate = true;
  }

  update(dt: number, elapsed: number, presence: number): void {
    const live = this.progress > 0 && this.progress < 1;
    const target = live ? 0.9 * presence : 0;
    this.opacity =
      target > this.opacity
        ? Math.min(target, this.opacity + dt * 6)
        : Math.max(target, this.opacity - dt * 3);

    // Invisible objects still cost a draw call, so drop it entirely when idle.
    // The scan bands only exist during an analysis, which is exactly the moment
    // the budget has the headroom.
    this.mesh.visible = this.opacity > 0.004;
    if (!this.mesh.visible) return;

    const mat = this.mesh.material as THREE.Material & { opacity: number };
    // A slow breath, not a buzz. At 24Hz the band strobed against the frame
    // rate and read as an electrical fault; an instrument mid-measurement
    // should hold steady and merely be alive.
    mat.opacity = this.opacity * (0.95 + Math.sin(elapsed * 6) * 0.05);
    if (live) this.writePositions();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// FloorRig — rails, flanking posts and event pulse rings, all in one buffer
// ---------------------------------------------------------------------------

const PULSE_SLOTS = 3;
const PULSE_SEGS = 44;
const PULSE_SECONDS = 2.1;

export interface FloorArchitecture {
  /** Flanking posts, solved so they stay inside the frame in both orientations. */
  postX: number;
  postZ: number;
  postHeight: number;
  /** The far floor ring, which is the only floor detail the shot actually sees. */
  ringRadius: number;
}

/**
 * The architecture of the interface: two luminous ladder posts flanking her, a
 * far floor ring, a small ring at her feet, and up to three pulse rings that
 * emanate outward on events.
 *
 * All of it is `depthTest: true` — see the module header. This is scenery, it
 * has no DOM label, and a pulse sweeping out behind her has to pass behind her
 * legs.
 *
 * The pulse rings are sized to be *seen*: the clinical shot is framed chest-up,
 * so the floor within roughly 2.5 m of the camera is below the bottom of frame
 * entirely. A ring expanding from her feet to a metre would be invisible; one
 * that carries on out to the far grid crosses the visible horizon band and reads
 * as a shockwave crossing the room.
 */
export class FloorRig {
  readonly lines: THREE.LineSegments;
  private positions: THREE.BufferAttribute;
  private colors: THREE.BufferAttribute;
  /** Reveal order per vertex for the boot sweep, 0..1. */
  private order: Float32Array;
  private baseIntensity: Float32Array;
  private staticVerts: number;
  private totalVerts: number;
  private tint = new THREE.Color(PALETTE.holo);

  private pulseAge: Float32Array;
  private pulseStrength: Float32Array;
  private pulseFrom: Float32Array;
  private reveal = 0;
  private rich: boolean;

  constructor(architecture: FloorArchitecture, opts: { rich?: boolean } = {}) {
    this.rich = opts.rich !== false;
    const points: number[] = [];
    const intensity: number[] = [];
    const order: number[] = [];

    const seg = (
      a: [number, number, number],
      b: [number, number, number],
      k: number,
      o: number,
    ) => {
      points.push(...a, ...b);
      intensity.push(k, k);
      order.push(o, o);
    };

    // --- the near ring at her feet ----------------------------------------
    // Mostly below frame in the shipped framing, kept small and cheap so it is
    // there if the shot ever tilts down.
    const nearR = 0.72;
    const nearSteps = 36;
    for (let i = 0; i < nearSteps; i++) {
      if (i % 3 === 2) continue;
      const a0 = (i / nearSteps) * Math.PI * 2;
      const a1 = ((i + 1) / nearSteps) * Math.PI * 2;
      seg(
        [Math.cos(a0) * nearR, 0.012, Math.sin(a0) * nearR],
        [Math.cos(a1) * nearR, 0.012, Math.sin(a1) * nearR],
        0.5,
        0.05 + (i / nearSteps) * 0.2,
      );
    }

    // --- the far ring, which the camera can actually see -------------------
    const farR = architecture.ringRadius;
    const farSteps = 72;
    for (let i = 0; i < farSteps; i++) {
      if (i % 4 === 3) continue;
      const a0 = (i / farSteps) * Math.PI * 2;
      const a1 = ((i + 1) / farSteps) * Math.PI * 2;
      seg(
        [Math.cos(a0) * farR, 0.014, Math.sin(a0) * farR],
        [Math.cos(a1) * farR, 0.014, Math.sin(a1) * farR],
        0.42,
        0.1 + (i / farSteps) * 0.35,
      );
    }

    // --- flanking ladder posts ---------------------------------------------
    // Two verticals plus rungs, rising out of the bottom of frame. These are the
    // strongest cue that she is standing *inside* a designed instrument rather
    // than in front of a backdrop.
    const { postX, postZ, postHeight } = architecture;
    const railGap = 0.05;
    for (const sx of [-1, 1]) {
      const x = sx * postX;
      for (const dx of [-railGap, railGap]) {
        seg([x + dx, 0, postZ], [x + dx, postHeight, postZ], 0.7, 0.2);
      }
      const rungs = 9;
      for (let i = 0; i <= rungs; i++) {
        const t = i / rungs;
        const y = t * postHeight;
        // Rungs thin out towards the top so the post fades into the dark
        // instead of stopping.
        seg(
          [x - railGap, y, postZ],
          [x + railGap, y, postZ],
          0.85 * (1 - t * 0.75),
          0.2 + t * 0.7,
        );
      }
    }

    this.staticVerts = points.length / 3;

    // --- pulse ring slots ---------------------------------------------------
    // Unit circles; `writePulses` scales them to the live radius each frame.
    for (let p = 0; p < PULSE_SLOTS; p++) {
      for (let i = 0; i < PULSE_SEGS; i++) {
        const a0 = (i / PULSE_SEGS) * Math.PI * 2;
        const a1 = ((i + 1) / PULSE_SEGS) * Math.PI * 2;
        seg([Math.cos(a0), 0.02, Math.sin(a0)], [Math.cos(a1), 0.02, Math.sin(a1)], 1, 0);
      }
    }

    this.totalVerts = points.length / 3;
    this.baseIntensity = new Float32Array(intensity);
    this.order = new Float32Array(order);
    this.pulseAge = new Float32Array(PULSE_SLOTS).fill(Infinity);
    this.pulseStrength = new Float32Array(PULSE_SLOTS);
    this.pulseFrom = new Float32Array(PULSE_SLOTS);

    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(points), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.BufferAttribute(new Float32Array(this.totalVerts * 3), 3);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('color', this.colors);

    this.lines = new THREE.LineSegments(
      geo,
      additiveLines({ opacity: 0, depthTest: true }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
  }

  /** Re-solves the architecture after a resize/orientation change. */
  reposition(architecture: FloorArchitecture): void {
    // Only the far ring and the posts depend on the frustum; rebuilding just
    // those keeps the resize path allocation-free.
    const arr = this.positions.array as Float32Array;
    let v = 0;
    const nearSteps = 36;
    for (let i = 0; i < nearSteps; i++) if (i % 3 !== 2) v += 2;

    const farR = architecture.ringRadius;
    const farSteps = 72;
    for (let i = 0; i < farSteps; i++) {
      if (i % 4 === 3) continue;
      const a0 = (i / farSteps) * Math.PI * 2;
      const a1 = ((i + 1) / farSteps) * Math.PI * 2;
      arr[v * 3] = Math.cos(a0) * farR;
      arr[v * 3 + 2] = Math.sin(a0) * farR;
      arr[(v + 1) * 3] = Math.cos(a1) * farR;
      arr[(v + 1) * 3 + 2] = Math.sin(a1) * farR;
      v += 2;
    }

    const { postX, postZ, postHeight } = architecture;
    const railGap = 0.05;
    for (const sx of [-1, 1]) {
      const x = sx * postX;
      for (const dx of [-railGap, railGap]) {
        arr[v * 3] = x + dx;
        arr[v * 3 + 1] = 0;
        arr[v * 3 + 2] = postZ;
        arr[(v + 1) * 3] = x + dx;
        arr[(v + 1) * 3 + 1] = postHeight;
        arr[(v + 1) * 3 + 2] = postZ;
        v += 2;
      }
      const rungs = 9;
      for (let i = 0; i <= rungs; i++) {
        const y = (i / rungs) * postHeight;
        arr[v * 3] = x - railGap;
        arr[v * 3 + 1] = y;
        arr[v * 3 + 2] = postZ;
        arr[(v + 1) * 3] = x + railGap;
        arr[(v + 1) * 3 + 1] = y;
        arr[(v + 1) * 3 + 2] = postZ;
        v += 2;
      }
    }
    this.positions.needsUpdate = true;
  }

  /** Fires a pulse ring outward. `from` is the radius it starts at. */
  pulse(strength = 1, from = 0.35): void {
    let slot = 0;
    let oldest = -1;
    for (let p = 0; p < PULSE_SLOTS; p++) {
      if (this.pulseAge[p] >= PULSE_SECONDS) {
        slot = p;
        oldest = -1;
        break;
      }
      if (this.pulseAge[p] > oldest) {
        oldest = this.pulseAge[p];
        slot = p;
      }
    }
    this.pulseAge[slot] = 0;
    this.pulseStrength[slot] = clamp(strength, 0, 1.5);
    this.pulseFrom[slot] = from;
  }

  /** Boot sweep: a light runs around the rails revealing them. */
  setReveal(v: number): void {
    this.reveal = clamp(v);
  }

  update(dt: number, elapsed: number, presence: number, glitch = 0): void {
    (this.lines.material as THREE.Material & { opacity: number }).opacity = presence;
    this.lines.visible = presence > 0.004;
    if (!this.lines.visible) return;

    const arr = this.colors.array as Float32Array;
    const c = this.tint;
    const edge = this.reveal * 1.15;
    // A slow light chasing round the far ring — the room breathing.
    const chase = (elapsed * 0.08) % 1;
    const glitchGain = 1 + glitch * 1.5;

    for (let i = 0; i < this.staticVerts; i++) {
      const o = this.order[i];
      let v = 0;
      if (o <= edge) {
        v = this.baseIntensity[i];
        // Bright head at the reveal front while booting.
        if (this.reveal < 1) v *= 1 + bump(o - edge, 0.06) * 3;
        if (this.rich) v *= 1 + 0.5 * bump(((o - chase + 1.5) % 1) - 0.5, 0.05);
        v *= glitchGain;
      }
      arr[i * 3] = c.r * v;
      arr[i * 3 + 1] = c.g * v;
      arr[i * 3 + 2] = c.b * v;
    }

    this.writePulses(dt, glitchGain);
    this.colors.needsUpdate = true;
  }

  private writePulses(dt: number, glitchGain: number): void {
    const pos = this.positions.array as Float32Array;
    const col = this.colors.array as Float32Array;
    const c = this.tint;
    let touchedPositions = false;

    for (let p = 0; p < PULSE_SLOTS; p++) {
      const start = this.staticVerts + p * PULSE_SEGS * 2;
      const end = start + PULSE_SEGS * 2;
      if (this.pulseAge[p] >= PULSE_SECONDS) {
        for (let i = start; i < end; i++) {
          col[i * 3] = 0;
          col[i * 3 + 1] = 0;
          col[i * 3 + 2] = 0;
        }
        continue;
      }

      this.pulseAge[p] += dt;
      const t = clamp(this.pulseAge[p] / PULSE_SECONDS);
      // Fast out, then coasting — a shock, not a balloon.
      const radius = this.pulseFrom[p] + (1 - Math.pow(1 - t, 2.4)) * 4.3;
      // Dies before it reaches the wall, so it never clips the shell.
      const fade = Math.pow(1 - t, 1.7) * this.pulseStrength[p];
      const v = fade * 0.9 * glitchGain;

      for (let i = start; i < end; i++) {
        const j = i * 3;
        // Unit circle scaled in place: x and z hold cos/sin of this vertex from
        // construction, so a single multiply moves the whole ring.
        const len = Math.hypot(pos[j], pos[j + 2]) || 1;
        pos[j] = (pos[j] / len) * radius;
        pos[j + 2] = (pos[j + 2] / len) * radius;
        col[j] = c.r * v;
        col[j + 1] = c.g * v;
        col[j + 2] = c.b * v;
      }
      touchedPositions = true;
    }

    if (touchedPositions) {
      this.positions.needsUpdate = true;
      // The pulse rings extend well past the rails; without this the whole
      // LineSegments can cull mid-pulse.
      this.lines.geometry.boundingSphere = null;
    }
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// ConnectorBank — the readouts are projected *by her*
// ---------------------------------------------------------------------------

const CONNECTOR_SEGS = 10;

/**
 * Thin additive threads running from a point just in front of her sternum out to
 * each metric ring.
 *
 * Without these the rings are decals floating in space; with them the whole
 * assembly reads as something she is projecting. They follow the layout solver's
 * slot positions exactly, so they recompose with everything else in portrait.
 *
 * One LineSegments for all six. Each thread carries a draw-in front during boot
 * and, afterwards, small packets of light running outward — the visual claim
 * that data is moving from her to the readout.
 */
export class ConnectorBank {
  readonly lines: THREE.LineSegments;
  private positions: THREE.BufferAttribute;
  private colors: THREE.BufferAttribute;
  private count: number;
  private draw: Float32Array;
  private tints: THREE.Color[] = [];
  private focus = -1;
  private rich: boolean;

  constructor(count: number, opts: { rich?: boolean } = {}) {
    this.count = count;
    this.rich = opts.rich !== false;
    this.draw = new Float32Array(count);

    const verts = count * CONNECTOR_SEGS * 2;
    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('color', this.colors);

    for (let i = 0; i < count; i++) this.tints.push(new THREE.Color(PALETTE.holo));

    this.lines = new THREE.LineSegments(geo, additiveLines({ opacity: 0 }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
  }

  /**
   * Routes each thread as a quadratic bezier from `origin` to the ring's outer
   * edge, bowed towards the camera so it reads as a curve in space rather than a
   * line on the screen.
   */
  place(origin: THREE.Vector3, slots: HoloSlot[]): void {
    const arr = this.positions.array as Float32Array;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const ctrl = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let r = 0; r < this.count; r++) {
      const slot = slots[r] ?? slots[slots.length - 1];
      a.copy(origin);
      b.copy(slot.position);
      // Stop at the ring's outer track rather than at its centre, where the DOM
      // label sits — a thread through the number would look like a strikethrough.
      const inward = a.clone().sub(b);
      const dist = inward.length() || 1;
      b.addScaledVector(inward, (R_TICK_OUT * slot.scale * 1.06) / dist);

      ctrl.copy(a).add(b).multiplyScalar(0.5);
      ctrl.z += 0.085;
      ctrl.y += (b.y - a.y) * 0.22;

      for (let s = 0; s < CONNECTOR_SEGS; s++) {
        for (let e = 0; e < 2; e++) {
          const t = (s + e) / CONNECTOR_SEGS;
          const inv = 1 - t;
          p.set(0, 0, 0)
            .addScaledVector(a, inv * inv)
            .addScaledVector(ctrl, 2 * inv * t)
            .addScaledVector(b, t * t);
          const i = (r * CONNECTOR_SEGS * 2 + s * 2 + e) * 3;
          arr[i] = p.x;
          arr[i + 1] = p.y;
          arr[i + 2] = p.z;
        }
      }
    }
    this.positions.needsUpdate = true;
    this.lines.geometry.computeBoundingSphere();
  }

  setTint(index: number, color: THREE.Color): void {
    if (index >= 0 && index < this.count) this.tints[index].copy(color);
  }

  /** 0..1 draw-in per thread; the rig staggers them during boot. */
  setDraw(index: number, v: number): void {
    if (index >= 0 && index < this.count) this.draw[index] = clamp(v);
  }

  setFocus(index: number | null): void {
    this.focus = index ?? -1;
  }

  update(elapsed: number, presence: number, glitch = 0): void {
    // Threads are connective tissue, not content: they read across her torso,
    // so they stay well under the rings they lead to.
    (this.lines.material as THREE.Material & { opacity: number }).opacity = presence * 0.45;
    this.lines.visible = presence > 0.004;
    if (!this.lines.visible) return;

    const arr = this.colors.array as Float32Array;
    for (let r = 0; r < this.count; r++) {
      const c = this.tints[r];
      const drawn = this.draw[r];
      const focused = this.focus === r;
      // Packets run outward; the focused thread runs faster and brighter, which
      // is the whole "she is talking about this one" signal.
      const speed = focused ? 0.55 : 0.3;
      const phase = (elapsed * speed + r * 0.37) % 1;
      const phase2 = (elapsed * speed + r * 0.37 + 0.5) % 1;
      const baseK = focused ? 0.62 : 0.26;

      for (let s = 0; s < CONNECTOR_SEGS; s++) {
        for (let e = 0; e < 2; e++) {
          const t = (s + e) / CONNECTOR_SEGS;
          let v = 0;
          if (t <= drawn) {
            // Dim at her end, brighter as it arrives — direction without arrows.
            v = baseK * (0.35 + 0.65 * t);
            if (drawn < 1) v *= 1 + bump(t - drawn, 0.07) * 4;
            if (this.rich) {
              v *= 1 + 2.4 * (bump(t - phase, 0.05) + bump(t - phase2, 0.05));
            }
            v *= 1 + glitch * 1.6;
            // A glitch frame drops the threads entirely — the readouts briefly
            // lose their tether, which is far more unsettling than a flicker.
            if (glitch > 0.5) v = 0;
          }
          const i = (r * CONNECTOR_SEGS * 2 + s * 2 + e) * 3;
          arr[i] = c.r * v;
          arr[i + 1] = c.g * v;
          arr[i + 2] = c.b * v;
        }
      }
    }
    this.colors.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// TrendGraph
// ---------------------------------------------------------------------------

/** The trend polyline shown during a progress review. */
export class TrendGraph {
  readonly line: THREE.Line;
  private positions: THREE.BufferAttribute;
  private capacity: number;

  constructor(capacity = 32) {
    this.capacity = capacity;
    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    geo.setDrawRange(0, 0);
    this.line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: PALETTE.holoWarm,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.line.frustumCulled = false;
    this.line.renderOrder = 5;
  }

  /** `values` are 0..1; drawn left to right across `width` at `origin`. */
  setSeries(values: number[], origin: THREE.Vector3, width: number, height: number): void {
    const n = Math.min(values.length, this.capacity);
    const arr = this.positions.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      arr[i * 3] = origin.x + (t - 0.5) * width;
      arr[i * 3 + 1] = origin.y + (values[i] - 0.5) * height;
      arr[i * 3 + 2] = origin.z;
    }
    this.positions.needsUpdate = true;
    this.line.geometry.setDrawRange(0, n);
    this.line.geometry.computeBoundingSphere();
  }

  setOpacity(v: number): void {
    (this.line.material as THREE.Material & { opacity: number }).opacity = v;
    this.line.visible = v > 0.004;
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
