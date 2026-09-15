/**
 * What makes a hologram read as a hologram.
 *
 * The contour model, the scan cloud and the region glows describe the *subject*
 * accurately and still looked like a wireframe head, because none of them say
 * anything about the projection itself. In film, almost all of the read comes
 * from artefacts of the medium rather than from the thing being projected:
 *
 *   scrim       the room dimmed behind it, so the light has somewhere to land
 *   halo        light scattering in the air around a bright volume
 *   cone        the beam from the emitter, so the image has a source
 *   scanlines   the raster it is drawn with, drifting because it is not locked
 *   rollbar     a brighter band sweeping the refresh, the oldest CRT tell
 *
 * The scrim is the one that actually made it readable. Everything a hologram
 * is drawn with is *additive* — it can only ever add light — and the clinic
 * plate behind it is a bright white room. Additive light against a near-white
 * wall has almost no headroom left, which is why the projection kept washing
 * out into the room no matter how far its brightness was pushed. A real
 * volumetric display has the same problem and solves it the same way: the
 * projection volume is darker than the room around it. So a soft multiply quad
 * goes in *behind* the hologram and dims the room there first, and the additive
 * layers then have contrast to work against.
 *
 * All five are quads with no lighting and no depth writes, and together they
 * cost five draw calls and fourteen triangles. That is affordable
 * precisely because the face itself measured at effectively zero — the frame
 * budget in this scene goes to text panels, not to the hologram.
 *
 * Deliberately not a shader pass. Everything here is a quad with a canvas
 * texture, which keeps it on the same cheap path as the rest of the overlay and
 * avoids a render target on a fill-rate-bound GPU.
 */
import * as THREE from 'three';

/** Soft round falloff — the halo, and the cone's cross-section. */
function haloTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // A steep falloff: a wide soft disc reads as fog, not as light around a thing.
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    g.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, 3.1) * 0.85})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The raster: fine horizontal lines, plus a wider soft band for the roll bar.
 *
 * Drawn into a tall thin texture and repeated across the quad, so the line
 * spacing is set by `repeat` rather than by the texture's own resolution.
 */
function scanlineTexture(height = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  // Wide enough to carry a horizontal falloff. At 4px the raster reached the
  // quad's own edge and drew a hard bright rectangle across the room.
  canvas.width = 128;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, height);
  // Two lit rows in every eight: a duty cycle low enough that the gaps read as
  // gaps rather than as a texture.
  for (let y = 0; y < height; y += 8) {
    const g = ctx.createLinearGradient(0, y, 0, y + 8);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, canvas.width, 8);
  }

  // Fade the left and right edges to nothing, so the raster has no vertical
  // boundary in mid-air. The top and bottom are handled by vertex colour on
  // the quad, because this texture tiles vertically and cannot carry one.
  const sides = ctx.createLinearGradient(0, 0, canvas.width, 0);
  sides.addColorStop(0, 'rgba(0,0,0,1)');
  sides.addColorStop(0.28, 'rgba(0,0,0,0)');
  sides.addColorStop(0.72, 'rgba(0,0,0,0)');
  sides.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = sides;
  ctx.fillRect(0, 0, canvas.width, height);
  ctx.globalCompositeOperation = 'source-over';
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** A vertical gradient, bright at the base and gone at the top. */
function beamTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const vertical = ctx.createLinearGradient(0, size, 0, 0);
  vertical.addColorStop(0, 'rgba(255,255,255,0.5)');
  vertical.addColorStop(0.35, 'rgba(255,255,255,0.16)');
  vertical.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, size, size);
  // Fade the sides so the beam has no vertical edges.
  const sides = ctx.createLinearGradient(0, 0, size, 0);
  sides.addColorStop(0, 'rgba(0,0,0,1)');
  sides.addColorStop(0.5, 'rgba(0,0,0,0)');
  sides.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = sides;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function additiveQuad(map: THREE.Texture, order: number): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  return mesh;
}

export class HoloProjection {
  readonly group = new THREE.Group();

  private scrim: THREE.Mesh;
  private halo: THREE.Mesh;
  private beam: THREE.Mesh;
  private scan: THREE.Mesh;
  private roll: THREE.Mesh;
  private textures: THREE.Texture[] = [];

  private presence = 0;
  /** Height of the projected subject, set by `place`. */
  private height = 0.6;

  constructor(tint: THREE.ColorRepresentation) {
    const haloMap = haloTexture();
    const beamMap = beamTexture();
    const scanMap = scanlineTexture();
    this.textures.push(haloMap, beamMap, scanMap);

    /*
     * Furthest back: the room, dimmed. Multiply rather than a dark additive,
     * because only multiply can take light *away* — which is the entire point.
     */
    this.scrim = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        /*
         * Black, alpha-faded, over the top. Not multiply.
         *
         * Multiply is the "right" operator for dimming and it was the wrong
         * choice twice over: it ignores the texture's alpha (so a soft-edged
         * mask becomes a hard black rectangle), and combining it with material
         * opacity gave a result that lightened rather than darkened. Ordinary
         * alpha compositing of a black disc does exactly one thing and does it
         * predictably.
         */
        map: haloMap,
        color: new THREE.Color(0x05060c),
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );
    this.scrim.renderOrder = 4;
    this.scrim.frustumCulled = false;
    this.group.add(this.scrim);

    // Behind everything: the air around the projection, lit by it.
    this.halo = additiveQuad(haloMap, 5);
    (this.halo.material as THREE.MeshBasicMaterial).color.set(tint);
    this.group.add(this.halo);

    // The beam it arrives on. Without a source, a floating head is a sticker.
    this.beam = additiveQuad(beamMap, 5);
    (this.beam.material as THREE.MeshBasicMaterial).color.set(tint);
    this.group.add(this.beam);

    // Over the top: the raster it is drawn with.
    this.scan = additiveQuad(scanMap, 11);
    const scanMaterial = this.scan.material as THREE.MeshBasicMaterial;
    scanMaterial.color.set(tint);
    scanMaterial.vertexColors = true;
    // Five rows of vertices carrying a vertical fade. The texture tiles
    // vertically so it cannot hold one itself, and without it the raster ends
    // on a straight line above her head.
    this.scan.geometry.dispose();
    const scanGeometry = new THREE.PlaneGeometry(1, 1, 1, 4);
    const rows = scanGeometry.getAttribute('position');
    const shade = new Float32Array(rows.count * 3);
    for (let i = 0; i < rows.count; i++) {
      const fade = Math.cos(rows.getY(i) * Math.PI) * 0.5 + 0.5;
      shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = fade;
    }
    scanGeometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    this.scan.geometry = scanGeometry;
    this.group.add(this.scan);

    this.roll = additiveQuad(haloMap, 12);
    (this.roll.material as THREE.MeshBasicMaterial).color.set(0xffffff);
    this.group.add(this.roll);
  }

  /**
   * Positions the projection around a subject of `height` centred on `centre`,
   * with the beam running down to `emitterY`.
   */
  place(centre: THREE.Vector3, height: number, emitterY: number): void {
    this.height = height;
    const width = height * 0.82;

    this.halo.position.copy(centre);
    this.halo.scale.set(width * 1.5, height * 1.35, 1);

    // Wider than the halo: the dimming has to reach past the glow, or the glow
    // sits on a visible dark disc.
    this.scrim.position.copy(centre);
    this.scrim.scale.set(width * 2.4, height * 2.0, 1);

    const beamHeight = Math.max(0.05, centre.y - height * 0.42 - emitterY);
    this.beam.position.set(centre.x, emitterY + beamHeight / 2, centre.z);
    // Flares out toward the emitter, like a projector cone seen edge-on.
    this.beam.scale.set(width * 1.5, beamHeight, 1);

    this.scan.position.copy(centre);
    this.scan.scale.set(width * 1.25, height * 1.05, 1);
    const map = (this.scan.material as THREE.MeshBasicMaterial).map;
    if (map) {
      // Line spacing in world terms rather than texture terms, so the raster
      // stays the same density whatever size the subject is drawn at.
      map.repeat.set(1, Math.max(6, Math.round(height * 190)));
    }

    this.roll.position.copy(centre);
    this.roll.scale.set(width * 1.5, height * 0.16, 1);
  }

  /** Turns to face the viewer. Y-only, so it stays upright in the room. */
  face(viewer: THREE.Vector3): void {
    for (const mesh of [this.scrim, this.halo, this.beam, this.scan, this.roll]) {
      mesh.rotation.set(
        0,
        Math.atan2(viewer.x - mesh.position.x, viewer.z - mesh.position.z),
        0,
      );
    }
  }

  setPresence(value: number): void {
    this.presence = Math.min(1, Math.max(0, value));
  }

  update(elapsed: number, glitch: number): void {
    const p = this.presence;
    this.group.visible = p > 0.01;
    if (!this.group.visible) return;

    // A projection that is perfectly steady is a photograph of a projection —
    // but one slow term is enough. The second shimmer at 23.1 rad/s beat
    // against the frame rate and read as an electrical fault running
    // constantly, which made every actual glitch invisible. The projector now
    // breathes gently and saves its instability for the glitch, where a
    // smaller multiplier goes further because calm surrounds it.
    const flicker = 0.94 + Math.sin(elapsed * 7.3) * 0.04;
    const unstable = 1 + glitch * 0.9;

    // The scrim is steady. Flickering the dimming as well as the light makes
    // the whole room pulse, which reads as a fault in the room, not the image.
    (this.scrim.material as THREE.MeshBasicMaterial).opacity = p * 0.88;
    (this.halo.material as THREE.MeshBasicMaterial).opacity = p * 0.62 * flicker;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = p * 0.5 * flicker * unstable;

    const scanMaterial = this.scan.material as THREE.MeshBasicMaterial;
    scanMaterial.opacity = p * 0.3 * unstable;
    // Drift the raster slowly upward. Locked lines read as a printed texture.
    if (scanMaterial.map) {
      scanMaterial.map.offset.y = (elapsed * 0.06) % 1;
    }

    // The roll bar: one pass down the subject every few seconds.
    const period = 4.2;
    const t = (elapsed % period) / period;
    this.roll.position.y = this.halo.position.y + (0.5 - t) * this.height * 1.15;
    (this.roll.material as THREE.MeshBasicMaterial).opacity =
      p * 0.07 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + glitch * 0.18;
  }

  setTint(color: THREE.Color): void {
    for (const mesh of [this.halo, this.beam, this.scan]) {
      (mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    }
  }

  dispose(): void {
    for (const mesh of [this.scrim, this.halo, this.beam, this.scan, this.roll]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const texture of this.textures) texture.dispose();
    this.group.removeFromParent();
  }
}
