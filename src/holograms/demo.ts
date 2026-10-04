/**
 * A demonstration, projected.
 *
 * When Evia recommends something — a chin tuck for a forward head, working a
 * ceramide cream along the orbital bone — telling someone is a fraction of the
 * job. The reason people do an exercise wrong is almost never that they were
 * not told; it is that "draw your chin straight back" describes a movement they
 * have never seen. So the recommendation comes with a figure doing it.
 *
 * A spritesheet, played on the same quad the scan projection uses. Deliberately
 * frame-by-frame rather than a rigged figure:
 *
 *  - The frames are generated art, in the same hand as everything else in the
 *    room. A procedural mannequin would be the one 3D thing left again.
 *  - Frame-swapping costs one texture offset per frame and no geometry at all,
 *    which is the whole reason this can run beside the readouts on a phone.
 *  - The drift that made generated animation unusable for Evia's own face —
 *    16% frame to frame — does not matter for a demonstration figure. There is
 *    no mouth patch to register against it. It just plays.
 *
 * Sheets are one row: `frames` cells across, each the full height.
 */
import * as THREE from 'three';

export interface DemoClip {
  /** Where the spritesheet lives. */
  url: string;
  frames: number;
  /** Frames per second. Demonstrations read best slower than life. */
  fps: number;
  /** What is being demonstrated, for the label. */
  title: string;
  /** Why it is being shown — spoken by Evia, shown under the figure. */
  because: string;
}

const DEFAULT_FPS = 12;

export class HoloDemo {
  readonly mesh: THREE.Mesh;

  private material: THREE.MeshBasicMaterial;
  private texture: THREE.Texture | null = null;
  private loader = new THREE.TextureLoader();
  private clip: DemoClip | null = null;
  private frame = 0;
  private elapsed = 0;
  private presence = 0;
  private presenceTarget = 0;
  /** Width over height of a single cell, for sizing the quad. */
  private cellAspect = 0.5;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      // Additive like the rest of the projection: it is light in the room.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
  }

  get playing(): boolean {
    return this.clip !== null;
  }

  get title(): string {
    return this.clip?.title ?? '';
  }

  /** Loads a clip and starts it. Passing null fades whatever is playing out. */
  async play(clip: DemoClip | null): Promise<void> {
    if (!clip) {
      this.presenceTarget = 0;
      this.clip = null;
      return;
    }

    const texture = await this.loader.loadAsync(clip.url);
    texture.colorSpace = THREE.SRGBColorSpace;
    /*
     * Nearest, and no mips.
     *
     * A spritesheet sampled with linear filtering bleeds the neighbouring
     * frame's pixels in at the cell edges, and a mip chain averages the whole
     * sheet together at distance — both produce a ghost of the next pose
     * hanging off this one.
     */
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1 / clip.frames, 1);

    const image = texture.image as { width: number; height: number };
    this.cellAspect = image.width / clip.frames / Math.max(1, image.height);

    this.texture?.dispose();
    this.texture = texture;
    this.material.map = texture;
    this.material.needsUpdate = true;

    this.clip = clip;
    this.frame = 0;
    this.elapsed = 0;
    this.presenceTarget = 1;
  }

  /** Places the figure, holding `height` and taking width from the frame. */
  place(centre: THREE.Vector3, height: number, viewer: THREE.Vector3): void {
    this.mesh.position.copy(centre);
    this.mesh.scale.set(height * Math.max(0.2, this.cellAspect), height, 1);
    this.mesh.rotation.set(
      0,
      Math.atan2(viewer.x - centre.x, viewer.z - centre.z),
      0,
    );
  }

  update(dt: number): void {
    const rate = this.presenceTarget > this.presence ? 2.6 : 3.4;
    this.presence += (this.presenceTarget - this.presence) * Math.min(1, rate * dt);
    this.material.opacity = this.presence;
    this.mesh.visible = this.presence > 0.01 && this.texture !== null;
    if (!this.clip || !this.texture) return;

    const fps = this.clip.fps || DEFAULT_FPS;
    this.elapsed += dt;
    const wanted = Math.floor(this.elapsed * fps) % this.clip.frames;
    if (wanted !== this.frame) {
      this.frame = wanted;
      this.texture.offset.x = wanted / this.clip.frames;
    }
  }

  dispose(): void {
    this.texture?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
