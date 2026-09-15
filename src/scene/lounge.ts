/**
 * The lounge — Elohim's conversational environment.
 *
 * This is where the user actually spends their time, so it has to feel like a
 * *place* rather than a backdrop, while staying quiet enough that she remains
 * the subject. Warm, minimal, low-poly.
 *
 * Everything the eye reads as depth here is a gradient, an additive plane or a
 * vertex-coloured ramp. There are no shadow maps, no volumetrics and no
 * post-processing (ARCHITECTURE §9) — the depth is painted, not simulated.
 */
import * as THREE from 'three';
import { LIGHTING, PALETTE } from '@/character/palette.ts';
import { radialTexture } from './textures.ts';
import type { EnvironmentLights, ElohimEnvironment } from './environment.ts';
import { clamp } from '@/lib/math.ts';

/** The rendered interior, served from `public/`. */
// Versioned: the plate changed (bright to dark) and the file name did not, so
// browsers that had the old one kept showing it.
const PLATE_URL = '/backdrops/lounge.webp';
const PLATE_SIZE = 7.2;
const PLATE_Z = -3.4;
/** Where the horizon sits in the picture, and the height it must land at. */
const PLATE_HORIZON = 0.56;
const PLATE_EYE_LEVEL = 1.5;

export class LoungeEnvironment implements ElohimEnvironment {
  readonly group = new THREE.Group();
  readonly lights: EnvironmentLights;
  readonly background = new THREE.Color(0x0b0d15);

  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private presence = 1;
  private baseIntensities: [number, number, number];
  private baseOpacity = new WeakMap<THREE.Material, number>();

  private lampGlow!: THREE.Mesh;
  private lampCore!: THREE.Mesh;
  private motes: THREE.Points | null = null;
  private moteDrift!: Float32Array;

  constructor(opts: { particles?: boolean; ground?: boolean } = {}) {
    const cfg = LIGHTING.lounge;

    const key = new THREE.DirectionalLight(cfg.key.color, cfg.key.intensity);
    key.position.set(...cfg.key.position);
    const rim = new THREE.DirectionalLight(cfg.rim.color, cfg.rim.intensity);
    rim.position.set(...cfg.rim.position);
    const ambient = new THREE.AmbientLight(cfg.ambient.color, cfg.ambient.intensity);

    this.lights = { key, rim, ambient };
    this.baseIntensities = [cfg.key.intensity, cfg.rim.intensity, cfg.ambient.intensity];
    this.group.add(key, rim, ambient);

    this.build(opts.particles !== false, opts.ground !== false);
  }

  private track<T extends THREE.Object3D>(obj: T): T {
    const mesh = obj as unknown as THREE.Mesh;
    if (mesh.geometry) this.geometries.push(mesh.geometry);
    if (mesh.material) {
      const material = mesh.material as THREE.Material & { opacity: number };
      this.materials.push(material);
      this.baseOpacity.set(material, material.opacity);
    }
    return obj;
  }

  /**
   * Builds the room.
   *
   * `ground` covers the floor disc, its reflection smear and the contact
   * shadow — everything that exists to sit a standing figure on a surface.
   * With the painted Elohim, who is cropped at the hips and has no feet, all
   * three describe a floor nobody is standing on: an empty lit patch below a
   * character who visibly never reaches it. The backdrop plate has a
   * photographed floor of its own and covers the frame without them.
   */
  private build(withMotes: boolean, ground: boolean): void {
    if (ground) this.buildFloor();
    this.buildBackdrop();
    this.buildLamp();
    if (ground) this.buildContactShadow();
    if (withMotes) this.buildMotes();
  }

  /**
   * Floor: a disc that is warm directly under her and falls to black at the
   * edge, so the room has no visible boundary. The gradient is the light pool —
   * cheaper and more controllable than an actual spot light.
   */
  private buildFloor(): void {
    const geo = new THREE.CircleGeometry(7, 32);
    geo.rotateX(-Math.PI / 2);
    this.radialTint(geo, new THREE.Color(0x2f2a33), new THREE.Color(0x08090e), 4.2, 1.35);

    const floor = this.track(
      new THREE.Mesh(
        geo,
        new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 1 }),
      ),
    );
    this.group.add(floor);

    // A faint elongated smear under her reads as a soft reflection on a
    // polished floor. Additive, so it only ever brightens.
    const reflectGeo = new THREE.CircleGeometry(0.5, 20);
    reflectGeo.rotateX(-Math.PI / 2);
    reflectGeo.scale(1, 1, 2.4);
    this.radialTint(reflectGeo, new THREE.Color(0x6a5a72), new THREE.Color(0x000000), 0.5, 1.8);
    const reflection = this.track(
      new THREE.Mesh(
        reflectGeo,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    reflection.position.set(0, 0.006, 0.42);
    this.group.add(reflection);
  }

  /**
   * Backdrop: a curved wall carrying a vertical ramp plus a horizontal warm
   * bias towards the lamp side. Two axes of gradient is what stops it reading
   * as flat colour.
   */
  /**
   * The lounge, as a rendered plate.
   *
   * Same reasoning as the clinic: the thing being chased here — warm practical
   * lamps, sheer curtains catching light, a sofa, wood with real reflections —
   * is photography, and a vertex-tinted gradient wall was never going to be it.
   * The floor, the lamp glow and the contact shadow stay as geometry, because
   * those are the parts that have to agree with where she is actually standing.
   */
  private buildBackdrop(): void {
    const geometry = new THREE.PlaneGeometry(PLATE_SIZE, PLATE_SIZE);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      // Built at full opacity: `setPresence` takes whatever it is made with as
      // the base and multiplies by the transition, so a zero here fades from
      // nothing to nothing.
      opacity: 1,
      toneMapped: false,
      depthWrite: false,
    });

    const plate = this.track(new THREE.Mesh(geometry, material));
    // Hung by its horizon rather than its middle, so the picture and the camera
    // agree about where the ground is.
    plate.position.set(0, PLATE_EYE_LEVEL - (PLATE_HORIZON - 0.5) * PLATE_SIZE, PLATE_Z);
    plate.renderOrder = -10;

    /*
     * Width from the image, not from a constant.
     *
     * The geometry is square and the first plates happened to be square too, so
     * nothing caught it. A 16:9 plate on a square quad is stretched 78%
     * vertically — a room that looks subtly, unplaceably wrong. Reading the
     * aspect off the texture means a new backdrop at any shape just works,
     * which is the whole point of the backdrop being an image.
     */
    const texture = new THREE.TextureLoader().load(PLATE_URL, (loaded) => {
      const { width, height } = loaded.image as { width: number; height: number };
      if (width && height) plate.scale.x = width / height;
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    material.needsUpdate = true;
    this.group.add(plate);
  }

  private buildLamp(): void {
    /*
     * Dimmer than it was, and smaller.
     *
     * The plate behind this went dark — a room after hours, lit by its own
     * strips — and a three-metre additive disc at 0.75 that once read as a
     * lamp in a bright room now flooded half the frame back to daylight. The
     * lamp is a lamp again: a pool, not a sun.
     */
    // A textured quad, not a vertex-tinted disc: the tint is linear from the
    // centre vertex to a black rim, and against a dark plate that rim is a
    // visible polygon. The texture falls off smoothly to nothing.
    const glowGeo = new THREE.PlaneGeometry(2.4, 2.4);
    this.lampGlow = this.track(
      new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({
          map: radialTexture(2.1),
          color: PALETTE.loungeAccent,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    this.lampGlow.position.set(-1.15, 1.62, -2.4);
    this.group.add(this.lampGlow);

    /*
     * The core needs a falloff like everything else that glows in here.
     *
     * It was a flat 16-segment disc of solid #ffe0b8, additively blended at
     * 0.85 — every other glow in this file is radially tinted, and this one was
     * not. On screen that is not a light, it is a hard white sticker with a
     * visible polygon edge sitting on the left of frame. More segments so the
     * rim is a circle rather than a hexadecagon, and a tint so it falls off.
     */
    const coreGeo = new THREE.CircleGeometry(0.13, 32);
    this.radialTint(coreGeo, new THREE.Color(0xffe0b8), new THREE.Color(0), 0.13, 0.85);
    this.lampCore = this.track(
      new THREE.Mesh(
        coreGeo,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    this.lampCore.position.set(-1.15, 1.62, -2.38);
    this.group.add(this.lampCore);
  }

  /** Grounds her. A shadow map for one contact patch would be absurd. */
  private buildContactShadow(): void {
    const geo = new THREE.CircleGeometry(0.46, 20);
    geo.rotateX(-Math.PI / 2);
    this.radialTint(geo, new THREE.Color(0x000000), new THREE.Color(0x121522), 0.46, 1.1);
    const contact = this.track(
      new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62 }),
      ),
    );
    contact.position.y = 0.004;
    this.group.add(contact);
  }

  /** Dust in the lamp light. Six-ish pixels of atmosphere, one draw call. */
  private buildMotes(): void {
    const COUNT = 90;
    const positions = new Float32Array(COUNT * 3);
    this.moteDrift = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = -2.4 + Math.random() * 3.2;
      positions[i * 3 + 1] = 0.5 + Math.random() * 2.2;
      positions[i * 3 + 2] = -2.2 + Math.random() * 2.0;
      this.moteDrift[i] = 0.006 + Math.random() * 0.016;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.motes = this.track(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: 0xffd9ac,
          size: 0.014,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
        }),
      ),
    ) as unknown as THREE.Points;
    this.group.add(this.motes);
  }

  /**
   * Centre-to-edge colour ramp baked into vertex colours. `falloff` above 1
   * concentrates the bright centre, which is what makes a flat disc read as a
   * pool of light rather than a painted circle.
   */
  private radialTint(
    geo: THREE.BufferGeometry,
    inner: THREE.Color,
    outer: THREE.Color,
    radius: number,
    falloff = 1,
  ): void {
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const d = clamp(Math.hypot(pos.getX(i), pos.getZ(i) || pos.getY(i)) / radius);
      c.copy(inner).lerp(outer, Math.pow(d, falloff));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  update(_dt: number, elapsed: number): void {
    if (this.presence < 0.01) return;

    // The practical breathes very slightly — enough that the frame is never a
    // still image, not enough to register as an effect.
    //
    // The base levels come from `baseOpacity`, which `track` records at build
    // time. They used to be restated here as literals, and when the lamp was
    // retuned for the dark plate the constructor's new levels were silently
    // overwritten every frame by this method's old ones. Whatever the lamp is
    // built at is what breathes.
    const flicker = 1 + Math.sin(elapsed * 0.47) * 0.06 + Math.sin(elapsed * 1.31) * 0.02;
    const glow = this.lampGlow.material as THREE.MeshBasicMaterial;
    const core = this.lampCore.material as THREE.MeshBasicMaterial;
    glow.opacity = (this.baseOpacity.get(glow) ?? 1) * this.presence * flicker;
    core.opacity = (this.baseOpacity.get(core) ?? 1) * this.presence * flicker;

    if (this.motes) {
      const attr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.moteDrift.length; i++) {
        arr[i * 3 + 1] += this.moteDrift[i] * _dt;
        // Sideways sway, so they float rather than rise like a fountain.
        arr[i * 3] += Math.sin(elapsed * 0.3 + i) * 0.0006;
        if (arr[i * 3 + 1] > 2.9) arr[i * 3 + 1] = 0.4;
      }
      attr.needsUpdate = true;
    }
  }

  setPresence(presence: number): void {
    this.presence = clamp(presence);
    this.group.visible = this.presence > 0.001;
    for (const material of this.materials) {
      material.transparent = true;
      const base = this.baseOpacity.get(material) ?? 1;
      // Scale each material's *own* opacity rather than flattening them all to
      // the presence value, which used to make the additive layers slam to full
      // brightness for a frame at the start of a transition.
      (material as THREE.Material & { opacity: number }).opacity = base * this.presence;
    }
    this.lights.key.intensity = this.baseIntensities[0] * this.presence;
    this.lights.rim.intensity = this.baseIntensities[1] * this.presence;
    this.lights.ambient.intensity = this.baseIntensities[2] * this.presence;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}
