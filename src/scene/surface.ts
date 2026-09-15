/**
 * Architectural surfaces with the lighting baked into vertex colours.
 *
 * Two problems this solves at once.
 *
 * *Draw calls.* An interior is a dozen planes, and a dozen planes is a dozen
 * draw calls if each is its own mesh. `SurfaceBuilder` accumulates every plane
 * into one indexed buffer sharing one material, so the entire shell of the room
 * — floor, walls, ceiling, reveals, console — costs a single call.
 *
 * *Light.* The budget allows two directional lights and an ambient
 * (ARCHITECTURE §9), and a directional light gives a flat plane one constant
 * value: no falloff, no spill, no sense of a source in the room. What actually
 * makes an interior read is light *running out* — a cove bright at the wall it
 * hugs and gone two metres later. So the coves are evaluated here, once, at
 * build time, into a colour per vertex. It costs nothing per frame and it is
 * strictly better looking than what three lights could do.
 *
 * A cove is modelled as a *line* light rather than a point, because that is
 * what a light channel physically is, and a point light sampled at the middle
 * of a three-metre slot produces a hot spot the real thing does not have.
 *
 * The camera never moves (two fixed shots, `SHOT_CLINICAL` /
 * `SHOT_CLINICAL_PORTRAIT`), which means the specular term can be baked too.
 * That is the one trick that makes the floor read as polished rather than as
 * matte paper, and it is free.
 */
import * as THREE from 'three';
import { clamp } from '@/lib/math.ts';

/** A recessed light channel: a line segment that throws light one way only. */
export interface CoveLight {
  a: THREE.Vector3;
  b: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  /** Knee of the inverse-square falloff, in metres. */
  radius: number;
  /**
   * Distance at which the cove contributes nothing at all, in metres.
   *
   * Inverse-square alone never reaches zero — at three radii it is still giving
   * 10%, and seven coves each giving 10% everywhere is a uniformly lit box with
   * no darkness left to contrast against. Defaults to three radii, windowed so
   * it arrives at zero smoothly rather than with a visible edge.
   */
  range?: number;
  /**
   * The direction the channel opens towards.
   *
   * Without it the bake lights the back of every wall it is mounted on, and the
   * room turns into a uniformly glowing box. A recess throws forward; this is
   * the cheapest stand-in for the geometry that would otherwise block it.
   */
  facing: THREE.Vector3;
  /** Samples along the segment. Long coves need more or they read as beads. */
  samples?: number;
  /** Blinn exponent of the streak this cove leaves on a polished surface. */
  gloss?: number;
  /** Strength of that streak. Surfaces pass their own multiplier as well. */
  specular?: number;
}

export interface BakeOptions {
  lights: CoveLight[];
  /**
   * Bounce floor. Nothing in a room is truly black, and a surface at exactly
   * zero reads as a hole rather than as a dark wall.
   */
  ambient: THREE.Color;
  /** Ambient is scaled by height: the floor sees less sky than the walls. */
  ambientAt?: (p: THREE.Vector3) => number;
  /** Camera position, for the baked specular. */
  view: THREE.Vector3;
  /** Depth haze. Lifts distant blacks so far surfaces sit behind near ones. */
  haze: THREE.Color;
  hazeNear: number;
  hazeFar: number;
  hazeStrength: number;
}

export type ShadeFn = (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;

const _sample = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _view = new THREE.Vector3();
const _half = new THREE.Vector3();

/**
 * Evaluates the cove rig at a point. Returns a *linear* colour: three's colour
 * management decodes hex literals to linear on the way in and encodes the
 * framebuffer on the way out, so summing light here is summing real radiance
 * rather than gamma-space nonsense.
 */
export function makeShader(opts: BakeOptions, specularGain = 0): ShadeFn {
  const {
    lights,
    ambient,
    view,
    haze,
    hazeNear,
    hazeFar,
    hazeStrength,
  } = opts;

  return (p, n, out) => {
    const amb = opts.ambientAt ? opts.ambientAt(p) : 1;
    out.setRGB(ambient.r * amb, ambient.g * amb, ambient.b * amb);

    _view.copy(view).sub(p).normalize();

    for (const light of lights) {
      const samples = light.samples ?? 6;
      const scale = light.intensity / samples;
      for (let s = 0; s < samples; s++) {
        // Offset by half a step so the samples sit inside the segment rather
        // than piling two of them on the end points.
        const t = (s + 0.5) / samples;
        _sample.lerpVectors(light.a, light.b, t);
        _dir.copy(_sample).sub(p);
        const dist = _dir.length();
        if (dist < 1e-4) continue;
        _dir.multiplyScalar(1 / dist);

        const lambert = n.dot(_dir);
        if (lambert <= 0) continue;

        // How much of the channel's own cone points back at us.
        const emit = -light.facing.dot(_dir);
        if (emit <= 0) continue;

        const range = light.range ?? light.radius * 3;
        if (dist >= range) continue;
        // Attenuation is measured from a floor of half a radius, not from the
        // true distance. A line light is a stand-in for a panel several metres
        // tall, and inverse-square from a mathematical line goes to infinity as
        // you approach it — which blew the wall the scrim is mounted on to flat
        // white while the far half of the room was still black. A real source
        // with area has bounded radiance; this is the cheap version of that.
        const soft = Math.max(dist, light.radius * 0.55);
        const knee = soft / light.radius;
        const window = 1 - (dist * dist) / (range * range);
        const atten = (1 / (1 + knee * knee)) * window * window;
        // Softened rather than raw, so the edge of a cove's throw is a fade and
        // not the hard cut-off that gives away a fake light.
        const cone = Math.pow(emit, 0.55);
        const energy = scale * lambert * cone * atten;

        out.r += light.color.r * energy;
        out.g += light.color.g * energy;
        out.b += light.color.b * energy;

        if (specularGain > 0 && light.specular) {
          _half.copy(_dir).add(_view).normalize();
          const spec =
            Math.pow(Math.max(0, n.dot(_half)), light.gloss ?? 48) *
            atten *
            cone *
            scale *
            light.specular *
            specularGain;
          out.r += light.color.r * spec;
          out.g += light.color.g * spec;
          out.b += light.color.b * spec;
        }
      }
    }

    const depth = clamp((view.distanceTo(p) - hazeNear) / Math.max(0.001, hazeFar - hazeNear));
    const h = depth * depth * hazeStrength;
    out.r += (haze.r - out.r) * h;
    out.g += (haze.g - out.g) * h;
    out.b += (haze.b - out.b) * h;
  };
}

/** Cell classification along one axis of a panel. */
const FACE = 0;
const JOINT = 1;
const LIP = 2;

interface AxisBands {
  edges: number[];
  kind: number[];
}

/**
 * Splits an axis into shading cells, inserting a groove and a light-catching
 * lip at each joint.
 *
 * Joint positions are given explicitly rather than as a count. Evenly divided
 * cladding is one of the loudest tells of generated architecture — real panel
 * layouts are set out from a datum and stop where the wall stops.
 */
function bands(length: number, joints: number[], width: number, lip: number, detail: number): AxisBands {
  const edges: number[] = [0];
  const kind: number[] = [];

  const subdivide = (to: number) => {
    const from = edges[edges.length - 1];
    const span = to - from;
    if (span <= 1e-4) return;
    const steps = Math.max(1, Math.round(span / detail));
    for (let i = 1; i <= steps; i++) {
      edges.push(from + (span * i) / steps);
      kind.push(FACE);
    }
  };

  for (const j of [...joints].sort((a, b) => a - b)) {
    const start = j - width * 0.5;
    const end = j + width * 0.5;
    if (start <= edges[edges.length - 1] || end + lip >= length) continue;
    subdivide(start);
    edges.push(end);
    kind.push(JOINT);
    edges.push(end + lip);
    kind.push(LIP);
  }
  subdivide(length);

  return { edges, kind };
}

export interface PanelSpec {
  /** The corner at (u = 0, v = 0). */
  origin: THREE.Vector3;
  /** Full edge vectors. The face normal is u x v, so winding matters. */
  u: THREE.Vector3;
  v: THREE.Vector3;
  /** Joint positions in metres along each edge. */
  uJoints?: number[];
  vJoints?: number[];
  jointWidth?: number;
  /** Multipliers for the groove and for the lip beside it. */
  jointShade?: number;
  lipShade?: number;
  /** Target size of a shading cell, in metres. Per-axis when an array. */
  detail?: number | [number, number];
  /** Metres of surface per texture tile, or 'fit' to stretch one tile over it. */
  tile?: number | 'fit';
  /** Flat multiplier over the whole panel. */
  tint?: THREE.Color;
  /**
   * Flip the panel if its normal points away from here.
   *
   * Every surface in a room seen from inside faces the camera, and getting the
   * winding right by hand across floor, ceiling, four walls, a console and
   * eight cove reveals is a bug farm — an inverted normal shows up as a black
   * surface, not as a missing one. One reference point states the rule once.
   */
  faceToward?: THREE.Vector3;
  shade: ShadeFn;
}

const _pos = new THREE.Vector3();
const _n = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _uHat = new THREE.Vector3();
const _vHat = new THREE.Vector3();
const _col = new THREE.Color();

/**
 * Accumulates planar panels into one indexed geometry.
 *
 * Vertices are deliberately *not* shared between cells. Sharing them would make
 * a groove's darkness bleed a whole cell either side of it, which turns a crisp
 * 15 mm shadow line into a 400 mm smudge — and the crisp line is the entire
 * reason the joints are geometry rather than texture.
 */
export class SurfaceBuilder {
  private position: number[] = [];
  private uv: number[] = [];
  private color: number[] = [];
  private index: number[] = [];

  panel(spec: PanelSpec): this {
    const uLen = spec.u.length();
    const vLen = spec.v.length();
    _uHat.copy(spec.u).multiplyScalar(1 / uLen);
    _vHat.copy(spec.v).multiplyScalar(1 / vLen);
    _n.crossVectors(_uHat, _vHat).normalize();

    // Measured from the middle of the panel, not its corner: a 4 m wall whose
    // corner happens to sit behind the reference point would otherwise flip.
    let flipped = false;
    if (spec.faceToward) {
      _mid
        .copy(spec.origin)
        .addScaledVector(spec.u, 0.5)
        .addScaledVector(spec.v, 0.5);
      if (spec.faceToward.clone().sub(_mid).dot(_n) < 0) {
        _n.negate();
        flipped = true;
      }
    }

    const detail = spec.detail ?? 0.45;
    const [du, dv] = Array.isArray(detail) ? detail : [detail, detail];
    const jw = spec.jointWidth ?? 0.018;
    const lip = jw * 0.7;

    const uBands = bands(uLen, spec.uJoints ?? [], jw, lip, du);
    const vBands = bands(vLen, spec.vJoints ?? [], jw, lip, dv);

    const jointShade = spec.jointShade ?? 0.34;
    const lipShade = spec.lipShade ?? 1.5;
    const tile = spec.tile ?? 1;

    for (let j = 0; j < vBands.kind.length; j++) {
      for (let i = 0; i < uBands.kind.length; i++) {
        const cell = Math.max(uBands.kind[i], vBands.kind[j]);
        // A groove crossing a lip is still a groove: the deeper cut wins.
        const isJoint = uBands.kind[i] === JOINT || vBands.kind[j] === JOINT;
        const factor = isJoint ? jointShade : cell === LIP ? lipShade : 1;

        const u0 = uBands.edges[i];
        const u1 = uBands.edges[i + 1];
        const v0 = vBands.edges[j];
        const v1 = vBands.edges[j + 1];
        const base = this.position.length / 3;

        for (const [uu, vv] of [
          [u0, v0],
          [u1, v0],
          [u1, v1],
          [u0, v1],
        ] as Array<[number, number]>) {
          _pos
            .copy(spec.origin)
            .addScaledVector(_uHat, uu)
            .addScaledVector(_vHat, vv);
          this.position.push(_pos.x, _pos.y, _pos.z);
          if (tile === 'fit') this.uv.push(uu / uLen, vv / vLen);
          else this.uv.push(uu / tile, vv / tile);

          spec.shade(_pos, _n, _col);
          let r = _col.r * factor;
          let g = _col.g * factor;
          let b = _col.b * factor;
          if (spec.tint) {
            r *= spec.tint.r;
            g *= spec.tint.g;
            b *= spec.tint.b;
          }
          this.color.push(r, g, b);
        }

        if (flipped) {
          this.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
        } else {
          this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    return this;
  }

  /**
   * A bilinear patch through four arbitrary corners, tessellated for shading.
   *
   * `panel` only makes parallelograms, and the one thing in the room that is
   * not a parallelogram is the floor reflection: a mirrored wall converges
   * towards the viewer, and drawing it as a rectangle is the difference between
   * a reflection and a rug.
   */
  quadGrid(
    p00: THREE.Vector3,
    p10: THREE.Vector3,
    p11: THREE.Vector3,
    p01: THREE.Vector3,
    nu: number,
    nv: number,
    shade: ShadeFn,
    tile: number | 'fit' = 'fit',
  ): this {
    _n.crossVectors(_a.copy(p10).sub(p00), _b.copy(p01).sub(p00)).normalize();

    const at = (u: number, v: number, out: THREE.Vector3) => {
      _a.copy(p00).lerp(p10, u);
      _b.copy(p01).lerp(p11, u);
      out.copy(_a).lerp(_b, v);
    };

    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const base = this.position.length / 3;
        for (const [u, v] of [
          [i / nu, j / nv],
          [(i + 1) / nu, j / nv],
          [(i + 1) / nu, (j + 1) / nv],
          [i / nu, (j + 1) / nv],
        ] as Array<[number, number]>) {
          at(u, v, _pos);
          this.position.push(_pos.x, _pos.y, _pos.z);
          if (tile === 'fit') this.uv.push(u, v);
          else this.uv.push((_pos.x + _pos.z) / tile, (_pos.y + _pos.z) / tile);
          shade(_pos, _n, _col);
          this.color.push(_col.r, _col.g, _col.b);
        }
        this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    geo.setIndex(this.index);
    // No normals: the shell is MeshBasicMaterial, because the light it needs is
    // already in the vertex colours and a lit shader would only average it back
    // out again. Skipping the attribute also saves a third of the buffer.
    return geo;
  }

  get triangles(): number {
    return this.index.length / 3;
  }
}

/** Builds an axis-aligned rectangle spec from two corners. Saves a lot of noise. */
export function rect(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  rest: Omit<PanelSpec, 'origin' | 'u' | 'v'>,
): PanelSpec {
  // Exactly one axis is degenerate; the other two become u and v, ordered so
  // the normal points the way the caller drew the corners.
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  let u: THREE.Vector3;
  let v: THREE.Vector3;
  if (Math.abs(dy) < 1e-6) {
    u = new THREE.Vector3(dx, 0, 0);
    v = new THREE.Vector3(0, 0, dz);
  } else if (Math.abs(dx) < 1e-6) {
    u = new THREE.Vector3(0, 0, dz);
    v = new THREE.Vector3(0, dy, 0);
  } else {
    u = new THREE.Vector3(dx, 0, 0);
    v = new THREE.Vector3(0, dy, 0);
  }
  return { origin: new THREE.Vector3(x0, y0, z0), u, v, ...rest };
}
