/**
 * The projection field — concentric rings of light encircling her at waist height.
 *
 * This is the single element that says the room is doing the analysing rather
 * than displaying it. She is not standing next to equipment; she is standing
 * *in* it.
 *
 * They float at her waist rather than lying on the floor, and that is not a
 * stylistic choice — it is what makes the composition possible. The reference
 * frames her from the waist up, and rings on the floor are simply not in that
 * frame; showing them at all would force the camera back until she became a
 * figure in a room instead of a person in front of you. At waist height they
 * sit on the bottom edge of a close shot, exactly where they belong.
 *
 * Mostly line loops: a ring costs almost nothing and, being thin, reads as
 * projected light rather than as a surface.
 *
 * Mostly — because arcs alone turned out to read as arcs. Five thin curves and
 * a few ticks is a diagram of a table, not a table: there is no field between
 * them, so nothing says the space enclosed is *doing* anything. One additive
 * disc carrying the graduations, the radial grid and the rim glow fixes that
 * for a single draw call, and its fill cost is bounded because the field is
 * small in frame and mostly transparent. The rings still do the moving parts
 * on top of it; the disc is the ground they run on.
 */
import * as THREE from 'three';

interface Ring {
  radius: number;
  /** Turns per second. Alternating signs so the set never reads as one object. */
  spin: number;
  /** Fraction of the circle actually drawn, 0..1. */
  span: number;
  /** Where the drawn arc starts, in turns. */
  phase: number;
  brightness: number;
  /** Segments — bigger rings need more before they polygonise. */
  segments: number;
}

/**
 * The projection field itself, drawn once into a canvas.
 *
 * Everything static about the console lives here — graduations, radial grid,
 * rim — so the geometry only has to carry what actually moves.
 */
function fieldTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  const c = size / 2;
  const R = size * 0.5;

  // Body: near-empty in the middle, gathering toward the rim. A field that is
  // brightest at its centre reads as a spotlight on the floor; one that is
  // brightest at its edge reads as a surface with a boundary.
  const glow = ctx.createRadialGradient(c, c, R * 0.04, c, c, R);
  glow.addColorStop(0, 'rgba(255,255,255,0.05)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.09)');
  glow.addColorStop(0.82, 'rgba(255,255,255,0.2)');
  glow.addColorStop(0.94, 'rgba(255,255,255,0.34)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Radial grid. Faded in from the centre so the lines emerge rather than
  // converging on a hard point.
  ctx.lineCap = 'butt';
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const major = i % 6 === 0;
    const inner = R * (major ? 0.18 : 0.46);
    const grad = ctx.createLinearGradient(
      c + Math.cos(a) * inner, c + Math.sin(a) * inner,
      c + Math.cos(a) * R * 0.95, c + Math.sin(a) * R * 0.95,
    );
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, `rgba(255,255,255,${major ? 0.3 : 0.12})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = major ? size * 0.0035 : size * 0.0018;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
    ctx.lineTo(c + Math.cos(a) * R * 0.95, c + Math.sin(a) * R * 0.95);
    ctx.stroke();
  }

  // Graduations.
  for (const [r, alpha] of [[0.24, 0.14], [0.4, 0.1], [0.56, 0.16], [0.72, 0.12]] as const) {
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = size * 0.002;
    ctx.beginPath();
    ctx.arc(c, c, R * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rim. The edge is what makes it an object.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = size * 0.006;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.93, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/*
 * Scaled down off the render.
 *
 * At the old radii the field sat almost directly under the lens and its near
 * edge ran off the bottom of the frame, so the curve of the rim read as a
 * horizon — the console looked like a planet. A table has to be small enough
 * that you can see both sides of it.
 */
const RINGS: Ring[] = [
  { radius: 0.23, spin: 0.05, span: 1, phase: 0, brightness: 1.1, segments: 48 },
  { radius: 0.29, spin: -0.09, span: 0.62, phase: 0.1, brightness: 1.5, segments: 52 },
  { radius: 0.35, spin: 0.07, span: 0.34, phase: 0.55, brightness: 1.7, segments: 56 },
  { radius: 0.41, spin: -0.04, span: 0.86, phase: 0.3, brightness: 0.7, segments: 60 },
  { radius: 0.47, spin: 0.03, span: 0.22, phase: 0.75, brightness: 1.3, segments: 64 },
];

/** Waist height. See the note on the class about why they are not on the floor. */
const RING_HEIGHT = 1.06;

/**
 * How far in front of her the field sits.
 *
 * This is a *table*, not a pedestal. She stands behind it and works over it,
 * which is why a waist-up frame cuts her where it does. Centred on her instead,
 * the rings pass straight through her body and she reads as standing inside a
 * hoop — which is exactly what it looked like.
 */
/*
 * Far enough forward that the far edge of the field clears her.
 *
 * At 0.5 the ring's back edge sat at z = 0.16 while she stands at 0.28, so the
 * table still passed through her waist — the exact thing moving it forward was
 * meant to stop. It has to clear her by its own radius plus her depth.
 */
const RING_FORWARD = 0.78;

/** Short radial ticks crossing the rings, like the graduations on an instrument. */
const SPOKES = 18;

/** Radius of the field disc. Just outside the widest ring, so it has a rim. */
const FIELD_RADIUS = 0.52;

/**
 * Light rising off the rim.
 *
 * The one cue that separates a projection table from a lit circle on the floor:
 * something has to be coming *up* out of it. Eight short vertical gradients,
 * sixteen vertices, and the field stops being flat.
 */
const SHAFTS = 8;
const SHAFT_HEIGHT = 0.26;

/**
 * Multiplied into every line's vertex colour.
 *
 * The pulse in `update` now peaks at 0.86 opacity instead of riding the clamp
 * at 1, so the lines dimmed. Uniform opacity cannot exceed 1; an additive
 * vertex colour can, meaningfully — so the lost brightness is put back here,
 * where it scales the light instead of fighting the clamp.
 */
const LINE_GAIN = 1.35;

export class HoloRings {
  readonly group = new THREE.Group();

  private material: THREE.LineBasicMaterial;
  private loops: THREE.LineLoop[] = [];
  private spokes: THREE.LineSegments;
  private shafts: THREE.LineSegments;
  private field: THREE.Mesh;
  private fieldMaterial: THREE.MeshBasicMaterial;
  private fieldTexture: THREE.CanvasTexture;
  private geometries: THREE.BufferGeometry[] = [];

  private reveal = 0;
  private revealTarget = 0;

  constructor(tint: THREE.ColorRepresentation) {
    this.fieldTexture = fieldTexture();
    this.fieldMaterial = new THREE.MeshBasicMaterial({
      map: this.fieldTexture,
      color: tint,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const fieldGeometry = new THREE.PlaneGeometry(FIELD_RADIUS * 2, FIELD_RADIUS * 2);
    this.geometries.push(fieldGeometry);
    this.field = new THREE.Mesh(fieldGeometry, this.fieldMaterial);
    this.field.rotation.x = -Math.PI / 2;
    this.field.frustumCulled = false;
    // Under the rings, which are the moving parts drawn on top of it.
    this.field.renderOrder = 3;
    this.group.add(this.field);

    this.material = new THREE.LineBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Part of the holographic overlay: light in the room, not a surface.
      depthTest: false,
      vertexColors: true,
    });

    for (const ring of RINGS) {
      const points: number[] = [];
      const colors: number[] = [];
      const count = Math.round(ring.segments * ring.span);
      for (let i = 0; i < count; i++) {
        const t = ring.phase + (i / ring.segments);
        const a = t * Math.PI * 2;
        points.push(Math.cos(a) * ring.radius, 0, Math.sin(a) * ring.radius);
        // Each arc fades out at its own ends, so no ring terminates on a hard
        // stop — the giveaway that an arc is a drawn shape rather than light.
        const edge = Math.sin((i / Math.max(1, count - 1)) * Math.PI);
        const k = LINE_GAIN * ring.brightness * (ring.span >= 1 ? 1 : 0.15 + 0.85 * edge);
        colors.push(k, k, k);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this.geometries.push(geometry);

      const loop = new THREE.LineLoop(geometry, this.material);
      loop.frustumCulled = false;
      loop.userData.spin = ring.spin;
      this.loops.push(loop);
      this.group.add(loop);
    }

    // Graduations.
    const spokePoints: number[] = [];
    const spokeColors: number[] = [];
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2;
      const long = i % 3 === 0;
      // On the rim, not floating inside it — graduations belong to an edge.
      const r0 = long ? 0.44 : 0.47;
      const r1 = long ? 0.55 : 0.51;
      spokePoints.push(Math.cos(a) * r0, 0, Math.sin(a) * r0);
      spokePoints.push(Math.cos(a) * r1, 0, Math.sin(a) * r1);
      const k = LINE_GAIN * (long ? 1.1 : 0.5);
      spokeColors.push(k, k, k, 0, 0, 0);
    }
    const spokeGeometry = new THREE.BufferGeometry();
    spokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(spokePoints, 3));
    spokeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(spokeColors, 3));
    this.geometries.push(spokeGeometry);
    this.spokes = new THREE.LineSegments(spokeGeometry, this.material);
    this.spokes.frustumCulled = false;
    this.spokes.renderOrder = 4;
    this.group.add(this.spokes);

    // Shafts off the rim, bright at the base and gone by the top.
    const shaftPoints: number[] = [];
    const shaftColors: number[] = [];
    for (let i = 0; i < SHAFTS; i++) {
      const a = (i / SHAFTS) * Math.PI * 2 + Math.PI / SHAFTS;
      const x = Math.cos(a) * FIELD_RADIUS * 0.93;
      const z = Math.sin(a) * FIELD_RADIUS * 0.93;
      const tall = i % 2 === 0;
      shaftPoints.push(x, 0, z, x, SHAFT_HEIGHT * (tall ? 1 : 0.5), z);
      const k = LINE_GAIN * (tall ? 1.5 : 0.9);
      shaftColors.push(k, k, k, 0, 0, 0);
    }
    const shaftGeometry = new THREE.BufferGeometry();
    shaftGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shaftPoints, 3));
    shaftGeometry.setAttribute('color', new THREE.Float32BufferAttribute(shaftColors, 3));
    this.geometries.push(shaftGeometry);
    this.shafts = new THREE.LineSegments(shaftGeometry, this.material);
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 4;
    this.group.add(this.shafts);
  }

  /** Centres the platform on her, just clear of the floor. */
  place(position: THREE.Vector3): void {
    this.group.position.set(position.x, position.y + RING_HEIGHT, position.z + RING_FORWARD);
  }

  setReveal(target: number): void {
    this.revealTarget = Math.min(1, Math.max(0, target));
  }

  update(dt: number, elapsed: number, presence: number): void {
    this.reveal += (this.revealTarget - this.reveal) * Math.min(1, 3 * dt);

    for (const loop of this.loops) {
      loop.rotation.y += (loop.userData.spin as number) * dt * Math.PI * 2;
    }
    this.spokes.rotation.y -= dt * 0.06 * Math.PI * 2;
    this.shafts.rotation.y += dt * 0.02 * Math.PI * 2;

    // A slow swell, so the platform reads as running rather than printed.
    //
    // The whole expression has to live below 1, or the swell is theatre: the
    // old 2.3× gain pinned opacity at the clamp for the entire cycle and the
    // "breathing" platform was a constant. Brightness lost to the lower ceiling
    // comes back through the vertex colours instead — see LINE_GAIN.
    this.material.opacity = this.reveal * presence * (0.72 + Math.sin(elapsed * 0.9) * 0.14);
    // The field settles a beat behind the rings and breathes on its own cycle,
    // so the console does not switch on as one flat object.
    this.fieldMaterial.opacity =
      Math.pow(this.reveal, 1.6) * presence * (0.78 + Math.sin(elapsed * 0.62) * 0.12);
    this.group.visible = this.material.opacity > 0.01;
  }

  setTint(color: THREE.Color): void {
    this.material.color.copy(color);
    this.fieldMaterial.color.copy(color);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.fieldMaterial.dispose();
    this.fieldTexture.dispose();
    this.group.removeFromParent();
  }
}
