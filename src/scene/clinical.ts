/**
 * The clinical analysis room (ARCHITECTURE §7, brief §12–13).
 *
 * A dark corridor whose entire character is horizontal light: strips running
 * along both side walls, away from the camera, converging into depth. Those
 * receding lines are the room. Everything else — the floor, the walls between
 * the strips, the ceiling — is close to black and exists to be the dark the
 * light is seen against.
 *
 * This replaces an earlier room that was architecturally careful and completely
 * wrong: panelled walls, a backlit scrim, a window, furniture. It was a good
 * room and it competed with her. At the framing this product actually uses —
 * waist up, close — the background's job is to give depth and colour and then
 * get out of the way, and a corridor of receding light does that with about a
 * dozen quads.
 *
 * Depth between her and the plate is two haze quads, not fog. Scene fog only
 * touches fog-enabled materials, and everything in this room — the plate, the
 * particles, the whole holographic overlay — opts out, so the FogExp2 that
 * used to live here was configured, applied, faded, and fogged nothing. A
 * little additive light hanging in the air between her plane and the picture
 * does the separating instead, and does it to things that actually render.
 */
import * as THREE from 'three';
import { LIGHTING, PALETTE } from '@/character/palette.ts';
import { radialTexture } from './textures.ts';
import type { EnvironmentLights, EviaEnvironment } from './environment.ts';
import { clamp } from '@/lib/math.ts';

/**
 * Narrow on purpose.
 *
 * The strips are the room, and a strip only enters a close frame once
 * perspective has carried it inwards. At 3.1m the walls sat outside the
 * frustum for the whole near half of the corridor and the background went
 * black. Tighter walls put the receding lines into frame where they can be
 * seen.
 */
const ROOM_HALF_WIDTH = 2.15;
const ROOM_HEIGHT = 3.1;
/** How far back the corridor runs. Only the particle drift volume uses it now. */
const ROOM_DEPTH = 13;
const ROOM_FRONT = 2.6;

/** The rendered interior, served from `public/`. */
const PLATE_URL = '/backdrops/clinic.webp';
/**
 * Big enough to cover the frame at every shot, and far enough back that moving
 * the camera between shots shifts it — a backdrop that does not move at all
 * reads as wallpaper stuck to the lens.
 *
 * Sized to the *width* of the frame at that distance, since the plate is square
 * and the frame is not: covering the width guarantees no edge is ever visible,
 * and the vertical crop is then chosen deliberately below.
 */
const PLATE_SIZE = 8.4;
const PLATE_Z = -4.2;

/**
 * Where the horizon sits in the picture, as a fraction up from its bottom edge,
 * and the world height it has to land at.
 *
 * Getting this wrong is what made the first attempt look like a photograph of a
 * floor: the plate was hung by its centre, which put the image's floor across
 * the whole frame and its ceiling somewhere above the room. A backdrop has to
 * be aligned by its horizon, not by its middle, or the camera and the picture
 * disagree about where the ground is.
 */
const PLATE_HORIZON = 0.57;
const PLATE_EYE_LEVEL = 1.42;

const PARTICLE_COUNT = 150;

export class ClinicalEnvironment implements EviaEnvironment {
  readonly group = new THREE.Group();
  readonly lights: EnvironmentLights;
  readonly background = new THREE.Color(0x04050a);

  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private presence = 0;
  private baseIntensities: [number, number, number];

  private particles: THREE.Points | null = null;
  private particleDrift!: Float32Array;

  constructor(opts: { particles?: boolean } = {}) {
    /*
     * Dormant, and kept anyway.
     *
     * Every surface this room ships is unlit MeshBasicMaterial — the plate
     * carries its own photographed lighting and the haze is additive — so
     * this rig illuminates nothing on a good day. It stays for the bad day:
     * the environment seam requires the three lights, the director grades
     * the room's mood through the key, and when the painted sprite fails to
     * load the procedural fallback avatar is Lambert-shaded and would stand
     * here in the dark without them.
     */
    const cfg = LIGHTING.clinical;
    const key = new THREE.DirectionalLight(cfg.key.color, 0);
    key.position.set(...cfg.key.position);
    const rim = new THREE.DirectionalLight(cfg.rim.color, 0);
    rim.position.set(...cfg.rim.position);
    const ambient = new THREE.AmbientLight(cfg.ambient.color, 0);

    this.lights = { key, rim, ambient };
    this.baseIntensities = [cfg.key.intensity, cfg.rim.intensity, cfg.ambient.intensity];
    this.group.add(key, rim, ambient);

    this.build(opts.particles !== false);
    this.setPresence(0);
  }

  private track<T extends THREE.Mesh | THREE.Points>(mesh: T): T {
    this.geometries.push(mesh.geometry);
    const material = mesh.material as THREE.Material;
    if (!this.materials.includes(material)) this.materials.push(material);
    return mesh;
  }

  private build(withParticles: boolean): void {
    this.buildPlate();
    this.buildHaze();
    if (withParticles) this.buildParticles();
  }

  /**
   * The room, as a rendered plate.
   *
   * Everything before this was an attempt to build a photographic interior out
   * of primitives: gradient walls, quads for the light coves, a canvas texture
   * of shelving. It got closer each pass and was never going to arrive, because
   * the look being chased — real depth of field, real bloom, bottles on a glass
   * shelf, chairs — is *photography*, and photography is not a thing a
   * real-time renderer produces from a dozen planes on an integrated GPU.
   *
   * So the room is a picture and the product is drawn in front of it. She, the
   * readouts and the contour model stay live geometry; the environment stops
   * pretending to be geometry and becomes what it always was — a backdrop.
   *
   * The plate sits far enough behind her to parallax slightly as the camera
   * moves between shots, which is what stops it reading as wallpaper. It is
   * unlit: it already contains its own lighting.
   */
  private buildPlate(): void {
    const geometry = new THREE.PlaneGeometry(PLATE_SIZE, PLATE_SIZE);
    this.geometries.push(geometry);

    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      // Full opacity here, not zero.
      //
      // `setPresence` records whatever opacity a material was built with as its
      // base and multiplies that by the transition. Building this at 0 makes the
      // base 0, and the plate then fades from nothing to nothing.
      opacity: 1,
      toneMapped: false,
      // The plate is the far wall of the world and carries its own
      // atmosphere; if any scene fog ever comes back, it must not dim it.
      fog: false,
      depthWrite: false,
    });
    this.materials.push(material);

    const plate = new THREE.Mesh(geometry, material);
    plate.position.set(
      0,
      PLATE_EYE_LEVEL - (PLATE_HORIZON - 0.5) * PLATE_SIZE,
      PLATE_Z,
    );
    plate.renderOrder = -10;
    this.group.add(plate);

    /*
     * Width comes from the image, not from a constant.
     *
     * The geometry is square and the first two plates happened to be square
     * too, so nothing caught it. A 16:9 plate on a square quad is stretched 78%
     * vertically — a room that looks subtly, unplaceably wrong. Reading the
     * aspect off the texture means dropping in a new backdrop at any shape just
     * works, which is the whole point of the plate being an image.
     */
    const texture = new THREE.TextureLoader().load(PLATE_URL, (loaded) => {
      const { width, height } = loaded.image as { width: number; height: number };
      if (width && height) plate.scale.x = width / height;
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    material.needsUpdate = true;
  }

  /**
   * The air between her and the picture.
   *
   * She and the plate are both flat, and with nothing between them they read
   * as two layers of one collage. Two big soft additive quads in the holo hue
   * hang in the gap — nearly invisible as objects, but anything that faint in
   * front of the plate pushes the plate back. The far one is a touch denser,
   * so the haze thickens with distance the way real air does.
   */
  private buildHaze(): void {
    for (const layer of [
      { z: -1.5, y: 1.35, w: 5.4, h: 3.4, opacity: 0.035 },
      { z: -2.6, y: 1.4, w: 6.6, h: 4.2, opacity: 0.05 },
    ]) {
      const geometry = new THREE.PlaneGeometry(layer.w, layer.h);
      this.geometries.push(geometry);
      const material = new THREE.MeshBasicMaterial({
        map: radialTexture(1.3),
        color: PALETTE.holo,
        transparent: true,
        opacity: layer.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      this.materials.push(material);
      const quad = new THREE.Mesh(geometry, material);
      quad.position.set(0, layer.y, layer.z);
      // After the plate, before everything that stands in the room.
      quad.renderOrder = -8;
      this.group.add(quad);
    }
  }

  /** Motes, so the air between the camera and the far wall is not empty. */
  private buildParticles(): void {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    this.particleDrift = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * ROOM_HALF_WIDTH * 2;
      positions[i * 3 + 1] = Math.random() * ROOM_HEIGHT;
      positions[i * 3 + 2] = ROOM_FRONT - Math.random() * ROOM_DEPTH * 0.7;
      this.particleDrift[i] = 0.008 + Math.random() * 0.022;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.particles = this.track(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: PALETTE.holo,
          size: 0.014,
          transparent: true,
          // The working level, not zero. `setPresence` records the built
          // opacity as the base it scales — the exact trap the plate comment
          // above spells out — and this material spent its whole life at 0
          // because it was built there: 150 particles, none ever visible.
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
          fog: false,
        }),
      ),
    );
    this.group.add(this.particles);
  }

  update(dt: number, _elapsed: number): void {
    if (this.presence < 0.01) return;


    if (this.particles) {
      const attribute = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        array[i * 3 + 1] += this.particleDrift[i] * dt;
        if (array[i * 3 + 1] > ROOM_HEIGHT) array[i * 3 + 1] = 0;
      }
      attribute.needsUpdate = true;
    }
  }

  setPresence(presence: number): void {
    this.presence = clamp(presence);
    this.group.visible = this.presence > 0.001;

    for (const material of this.materials) {
      const shell = material as THREE.Material & { userData: { baseOpacity?: number }; opacity: number };
      if (shell.userData.baseOpacity === undefined) shell.userData.baseOpacity = shell.opacity;
      shell.transparent = true;
      shell.opacity = (shell.userData.baseOpacity ?? 1) * this.presence;
    }

    this.lights.key.intensity = this.baseIntensities[0] * this.presence;
    this.lights.rim.intensity = this.baseIntensities[1] * this.presence;
    this.lights.ambient.intensity = this.baseIntensities[2] * this.presence;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
