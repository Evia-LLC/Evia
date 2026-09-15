/**
 * The light behind the display panel.
 *
 * This used to draw the whole fixture — border, corner brackets, header rule,
 * separators, tick rail — as additive line segments in 3D. All of that is now
 * drawn by `HoloPanel.svelte` in CSS, where a 1px edge is actually 1px, corners
 * align to the content they wrap, and none of it costs a draw call.
 *
 * What is left is the part CSS cannot do: a lit surface hanging in the room,
 * seen *through* the frosted DOM panel in front of it. That glow is what stops
 * the interface reading as a rectangle pasted onto a photo, and it is one quad.
 *
 * It also owns the scan → routine blend, because the wipe is a property of the
 * display rather than of either content state, and both the DOM and the 3D read
 * from it so they cross-fade together.
 */
import * as THREE from 'three';
import { PALETTE } from '@/character/palette.ts';
import { clamp } from '@/lib/math.ts';
import { onRect, type WorldRect } from '@/scene/anchor.ts';

export type PanelMode = 'scan' | 'routine';

export class DisplayPanel {
  readonly glass: THREE.Mesh;

  private glassColors: THREE.BufferAttribute;

  /** 0..1 reveal. */
  private reveal = 0;
  /** 0 = scan content, 1 = routine content. The wipe rides this. */
  private modeBlend = 0;
  private modeTarget = 0;
  private wipe = 0;

  private tint = new THREE.Color(PALETTE.holo);
  private rich: boolean;

  constructor(opts: { rich?: boolean } = {}) {
    this.rich = opts.rich !== false;

    // Tinted at the corners so the surface has a gradient rather than reading
    // as a flat rectangle of colour.
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.glassColors = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
    this.glassColors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', this.glassColors);

    this.glass = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.glass.frustumCulled = false;
  }

  /**
   * Match the DOM panel exactly.
   *
   * The quad is written as four world corners rather than positioned and
   * rotated, so it stays registered to the rectangle whatever the camera is
   * doing — no orientation to keep in sync, no drift to correct.
   */
  placeRect(rect: WorldRect): void {
    const pos = this.glass.geometry.getAttribute('position') as THREE.BufferAttribute;
    const corners: Array<[number, number]> = [
      [-0.5, 0.5],
      [0.5, 0.5],
      [-0.5, -0.5],
      [0.5, -0.5],
    ];
    const w = new THREE.Vector3();
    corners.forEach(([u, v], i) => {
      onRect(rect, u, v, w);
      pos.setXYZ(i, w.x, w.y, w.z);
    });
    pos.needsUpdate = true;
    this.glass.geometry.computeBoundingSphere();
  }

  setReveal(v: number): void {
    this.reveal = clamp(v);
  }

  setMode(mode: PanelMode): void {
    this.modeTarget = mode === 'routine' ? 1 : 0;
  }

  get mode(): PanelMode {
    return this.modeTarget >= 0.5 ? 'routine' : 'scan';
  }

  /** 0..1 — how far the content wipe has travelled. Drives what the rig shows. */
  get contentBlend(): number {
    return this.modeBlend;
  }

  /** True while the wipe is crossing. */
  get wiping(): boolean {
    return Math.abs(this.modeBlend - this.modeTarget) > 0.001;
  }

  setTint(color: THREE.Color): void {
    this.tint.copy(color);
  }

  update(dt: number, elapsed: number, glitch = 0): void {
    // Deliberately not instant: the wipe *is* the transition from "here is your
    // face" to "here is your plan", which is what the whole scan was building
    // towards.
    const delta = this.modeTarget - this.modeBlend;
    if (Math.abs(delta) > 0.001) {
      this.modeBlend += Math.sign(delta) * Math.min(dt / 0.85, Math.abs(delta));
      this.wipe = 1 - Math.abs(this.modeBlend * 2 - 1);
    } else {
      this.modeBlend = this.modeTarget;
      this.wipe = Math.max(0, this.wipe - dt * 2.2);
    }

    (this.glass.material as THREE.Material & { opacity: number }).opacity =
      this.reveal * (this.rich ? 0.5 : 0.34);

    const arr = this.glassColors.array as Float32Array;
    const c = this.tint;
    // Brighter at the top, and brighter still while the wipe crosses.
    const flare = 1 + this.wipe * 1.8 + glitch * 0.5;
    const breathe = 0.92 + Math.sin(elapsed * 0.6) * 0.08;
    const shade = [0.55 * flare * breathe, 0.55 * flare * breathe, 0.16 * flare, 0.16 * flare];
    for (let i = 0; i < 4; i++) {
      arr[i * 3] = c.r * shade[i];
      arr[i * 3 + 1] = c.g * shade[i];
      arr[i * 3 + 2] = c.b * shade[i];
    }
    this.glassColors.needsUpdate = true;
  }

  dispose(): void {
    this.glass.geometry.dispose();
    (this.glass.material as THREE.Material).dispose();
  }
}
