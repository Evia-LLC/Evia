/**
 * The grade — one pass over the whole frame, so everything in it looks like it
 * came out of the same camera.
 *
 * This is the piece that was missing. A real-time character composited onto a
 * photographic backdrop reads as a cutout no matter how good either half is,
 * because nothing they share is doing any work: no common falloff, no common
 * grain, no common lens. Film fixes that with a grade over the finished frame,
 * and the absence of one is why the scene looked *assembled* rather than shot.
 *
 * Deliberately not an EffectComposer. A render-target round trip costs a full
 * copy of the frame on a GPU that is already fill-rate bound; two screen-space
 * quads parented to the camera do the same job for two draw calls and no extra
 * memory. Vignette multiplies the frame down at the edges, grain adds a little
 * noise on top, and between them the plate and the geometry stop being
 * separable by eye.
 */
import * as THREE from 'three';

/** How far in front of the camera the overlays sit. Inside the near plane. */
const DISTANCE = 0.2;

/*
 * The two film stocks, one per room.
 *
 * The vignette multiplies the whole frame through its colour, so these are the
 * grade's actual voice: warm and barely-there for the lounge, cool and heavier
 * for the clinic. The grain colours are the matching black-point lifts — a
 * live render reaches true black and a photograph never does, and the lift has
 * to agree with the room about which direction "warm" is.
 */
const VIGNETTE_WARM = new THREE.Color(0xffe2c8);
const VIGNETTE_COOL = new THREE.Color(0x8e9ec0);
const GRAIN_WARM = new THREE.Color(0xc8b49a);
const GRAIN_COOL = new THREE.Color(0x8fb6c8);

function vignetteTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  // White at the centre keeps the texture's own darkening in the falloff.
  // The middle of frame is no longer strictly untouched: the mood colour on
  // the material multiplies through everywhere, which is the tint doing the
  // grade's actual work.
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, size * 0.12,
    size / 2, size / 2, size * 0.62,
  );
  /*
   * Greyscale on purpose.
   *
   * The tint used to be baked into these stops, which welded the grade to one
   * room — a teal-violet vignette over the warm lounge dragged its corners
   * toward the wrong film stock. The falloff lives here; the colour lives on
   * the material, where `setMood` can slide it between the rooms. Same
   * luminance ramp as before, hue removed.
   */
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.42, '#e2e2e2');
  gradient.addColorStop(0.7, '#9d9d9d');
  gradient.addColorStop(0.88, '#5b5b5b');
  gradient.addColorStop(1, '#353535');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function grainTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.random() * 255;
    data[i] = n;
    data[i + 1] = n;
    data[i + 2] = n;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Nearest, so the grain stays grain instead of being smoothed into mush.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export class Grade {
  private vignette: THREE.Mesh;
  private grain: THREE.Mesh;
  private grainMaterial: THREE.MeshBasicMaterial;
  private vignetteMaterial: THREE.MeshBasicMaterial;
  private textures: THREE.Texture[] = [];
  private strength = 0;
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    const plane = new THREE.PlaneGeometry(1, 1);

    const vignetteMap = vignetteTexture();
    this.textures.push(vignetteMap);
    this.vignetteMaterial = new THREE.MeshBasicMaterial({
      map: vignetteMap,
      transparent: true,
      opacity: 1,
      blending: THREE.MultiplyBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.vignette = new THREE.Mesh(plane, this.vignetteMaterial);
    this.vignette.renderOrder = 9000;
    this.vignette.frustumCulled = false;

    const grainMap = grainTexture();
    this.textures.push(grainMap);
    this.grainMaterial = new THREE.MeshBasicMaterial({
      map: grainMap,
      /*
       * Tinted, and doing two jobs.
       *
       * Grain is the classic way to marry a sharp element to a soft plate —
       * one texture over both makes them share a surface. Colouring it also
       * lifts the frame's black point a little toward the room's own cast.
       * The colour itself is written by `setMood`; this is only a starting
       * value in case nothing ever calls it.
       */
      color: GRAIN_WARM.clone(),
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.grain = new THREE.Mesh(plane.clone(), this.grainMaterial);
    this.grain.renderOrder = 9001;
    this.grain.frustumCulled = false;

    /*
     * Fit at draw time, not on the frame tick.
     *
     * These quads have to exactly cover the frame, and their size depends on
     * the camera's aspect — which is changed by `Stage.resize` and by
     * `captureFrame`, both of which render before the next tick runs. Sizing
     * them in `update` therefore left them sized for the *previous* aspect: a
     * 16:9 capture taken while the canvas was 1.44 got a grade covering 81% of
     * the width, with two ungraded strips down the sides.
     *
     * `onBeforeRender` runs after the camera matrices are settled and before
     * the object is drawn, which is the only moment that is right in every
     * path — tick, resize and capture alike.
     */
    const fit = (_r: unknown, _s: unknown, cam: THREE.Camera) => this.fit(cam);
    this.vignette.onBeforeRender = fit;
    this.grain.onBeforeRender = fit;

    // The session opens in the lounge, so the stock starts warm.
    this.setMood(0);

    camera.add(this.vignette, this.grain);
  }

  /** 0 disables the grade entirely; 1 is full strength. */
  setStrength(value: number): void {
    this.strength = Math.min(1, Math.max(0, value));
  }

  /**
   * Slides the grade between the rooms: 0 is the lounge's warm stock, 1 the
   * clinic's cool one. The director owns the mix — cross-fading it with the
   * environment transition is what makes both rooms come out of one camera.
   */
  setMood(mix: number): void {
    const t = Math.min(1, Math.max(0, mix));
    this.vignetteMaterial.color.lerpColors(VIGNETTE_WARM, VIGNETTE_COOL, t);
    this.grainMaterial.color.lerpColors(GRAIN_WARM, GRAIN_COOL, t);
  }

  /**
   * Resizes the overlays to exactly fill the frame.
   *
   * Recomputed every frame rather than on resize, because the fov changes with
   * the shot as well as with the window — a quad sized once for one framing
   * leaves a visible edge in another.
   */
  /** Sizes one overlay to exactly fill whatever camera is about to draw it. */
  private fit(camera: THREE.Camera): void {
    const perspective = camera as THREE.PerspectiveCamera;
    if (!perspective.isPerspectiveCamera) return;
    const height = 2 * DISTANCE * Math.tan((perspective.fov * Math.PI) / 360);
    const width = height * perspective.aspect;
    for (const mesh of [this.vignette, this.grain]) {
      mesh.position.set(0, 0, -DISTANCE);
      mesh.scale.set(width, height, 1);
    }
  }

  update(elapsed: number): void {
    for (const mesh of [this.vignette, this.grain]) {
      mesh.visible = this.strength > 0.01;
    }

    // Multiply toward white as the grade weakens, so it fades to a no-op.
    this.vignetteMaterial.opacity = this.strength;
    this.grainMaterial.opacity = 0.085 * this.strength;

    // Grain that does not move is dirt on the lens. Jumping the offset by whole
    // texels keeps each frame's noise uncorrelated with the last.
    const map = this.grainMaterial.map;
    if (map) {
      const step = 1 / 256;
      map.offset.set(
        Math.floor(Math.random() * 256) * step,
        Math.floor(Math.random() * 256) * step,
      );
      // Tiled well past 1 so the grain is fine at any output resolution.
      map.repeat.set(3.5, 3.5);
    }
    void elapsed;
  }

  dispose(): void {
    this.camera.remove(this.vignette, this.grain);
    this.vignette.geometry.dispose();
    this.grain.geometry.dispose();
    this.vignetteMaterial.dispose();
    this.grainMaterial.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
