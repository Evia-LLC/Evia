/**
 * The face, in three dimensions, as light.
 *
 * The capture screen now finds 478 landmarks on the face being scanned, and
 * every one of them carries a depth. That is a real 3D surface of the person's
 * own face — which is what the hologram beside her should be, rather than a
 * flat projection of a photograph or an abstract contour of nobody.
 *
 * Built once per scan from the landmarks the overlay captured at the moment of
 * measurement: the lattice as additive line segments, the vertices as points
 * brighter where they are nearer, and soft glows over the regions the reading
 * actually flagged — so the head turning slowly beside her is *their* head,
 * lit where *their* findings are. It never touches a measurement.
 *
 * Three draw calls. The geometry is a few thousand vertices; the budget is not
 * troubled.
 */
import * as THREE from 'three';
import { PALETTE } from '@/character/palette.ts';
import { radialTexture } from '@/scene/textures.ts';
import type { FaceRegionKey } from '@shared/types.ts';

/** What the capture screen hands over. Normalised to the source image. */
export interface ScanMesh {
  points: Float32Array;
  count: number;
  /** Source width over height, so x can be put in the same units as y. */
  aspect: number;
  tessellation: Uint16Array;
  contours: Uint16Array;
  oval: Uint16Array;
}

/**
 * Where each measured region sits on the canonical MediaPipe mesh: one anchor
 * vertex and a radius, in units of face height. The measurement regions are
 * rectangles on a 2D crop; these are the same places on the 3D surface.
 */
const REGION_SPOTS: Record<FaceRegionKey, { index: number; radius: number }> = {
  forehead: { index: 10, radius: 0.2 },
  glabella: { index: 9, radius: 0.09 },
  nose: { index: 4, radius: 0.1 },
  cheekLeft: { index: 50, radius: 0.13 },
  cheekRight: { index: 280, radius: 0.13 },
  periorbitalLeft: { index: 118, radius: 0.08 },
  periorbitalRight: { index: 347, radius: 0.08 },
  perioral: { index: 13, radius: 0.11 },
  chin: { index: 152, radius: 0.11 },
};

export class HoloFaceMesh3D {
  readonly group = new THREE.Group();

  private lines: THREE.LineSegments;
  private contourLines: THREE.LineSegments;
  private points: THREE.Points;
  private glows: THREE.Points;
  private pointColours: THREE.BufferAttribute;
  private baseBrightness: Float32Array;
  private glowColours: THREE.BufferAttribute;
  private glowTargets = new Map<FaceRegionKey, number>();
  private glowLevels = new Map<FaceRegionKey, number>();
  private regionKeys: FaceRegionKey[] = [];
  /** Per-vertex, per-region proximity weights, so a lit region brightens its vertices. */
  private regionWeights = new Map<FaceRegionKey, Float32Array>();
  private positions: Float32Array;
  private tint = new THREE.Color(PALETTE.holo);
  private warm = new THREE.Color(PALETTE.holoWarm);
  private alert = new THREE.Color(PALETTE.holoAlert);

  private presence = 0;
  readonly height = 1;
  /** Which way the viewer is; the slow turn oscillates about this. */
  baseYaw = 0;

  constructor(mesh: ScanMesh, renderOrder = 0) {
    // Into a centred, face-height-one frame. y up, z toward the viewer.
    const n = mesh.count;
    const raw = new Float32Array(n * 3);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = mesh.points[i * 3] * mesh.aspect;
      const y = -mesh.points[i * 3 + 1];
      const z = -mesh.points[i * 3 + 2] * mesh.aspect;
      raw[i * 3] = x;
      raw[i * 3 + 1] = y;
      raw[i * 3 + 2] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const scale = 1 / Math.max(1e-4, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    this.positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.positions[i * 3] = (raw[i * 3] - cx) * scale;
      this.positions[i * 3 + 1] = (raw[i * 3 + 1] - cy) * scale;
      // Depth is the least trustworthy axis a single camera gives; it is kept,
      // but flattened a little so the head reads as a head rather than a mask.
      this.positions[i * 3 + 2] = (raw[i * 3 + 2] - cz) * scale * 0.8;
    }

    const positionAttribute = new THREE.BufferAttribute(this.positions, 3);

    // The lattice.
    const latticeGeometry = new THREE.BufferGeometry();
    latticeGeometry.setAttribute('position', positionAttribute);
    latticeGeometry.setIndex(new THREE.BufferAttribute(mesh.tessellation, 1));
    this.lines = new THREE.LineSegments(
      latticeGeometry,
      new THREE.LineBasicMaterial({
        color: this.tint,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );

    // The contours, brighter.
    const contourGeometry = new THREE.BufferGeometry();
    contourGeometry.setAttribute('position', positionAttribute);
    contourGeometry.setIndex(new THREE.BufferAttribute(mesh.contours, 1));
    this.contourLines = new THREE.LineSegments(
      contourGeometry,
      new THREE.LineBasicMaterial({
        color: PALETTE.holoCyan,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );

    // The vertices. Nearer is brighter; a lit region is brighter still.
    this.baseBrightness = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = this.positions[i * 3 + 2];
      this.baseBrightness[i] = 0.35 + Math.max(0, Math.min(1, (z - minZ * scale * 0.8) * 1.4)) * 0.65;
    }
    this.pointColours = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.pointColours.setUsage(THREE.DynamicDrawUsage);
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', positionAttribute);
    pointGeometry.setAttribute('color', this.pointColours);
    this.points = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({
        size: 0.012,
        map: radialTexture(3),
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: true,
      }),
    );

    // The region glows: soft discs at the anchors, coloured by what was found.
    this.regionKeys = Object.keys(REGION_SPOTS) as FaceRegionKey[];
    const glowPositions = new Float32Array(this.regionKeys.length * 3);
    this.glowColours = new THREE.BufferAttribute(new Float32Array(this.regionKeys.length * 3), 3);
    this.glowColours.setUsage(THREE.DynamicDrawUsage);
    this.regionKeys.forEach((key, i) => {
      const spot = REGION_SPOTS[key];
      const idx = Math.min(n - 1, spot.index);
      glowPositions[i * 3] = this.positions[idx * 3];
      glowPositions[i * 3 + 1] = this.positions[idx * 3 + 1];
      glowPositions[i * 3 + 2] = this.positions[idx * 3 + 2] + 0.02;
      // Which vertices this region lights, by distance from the anchor.
      const weights = new Float32Array(n);
      for (let v = 0; v < n; v++) {
        const dx = this.positions[v * 3] - glowPositions[i * 3];
        const dy = this.positions[v * 3 + 1] - glowPositions[i * 3 + 1];
        const d = Math.sqrt(dx * dx + dy * dy);
        weights[v] = Math.max(0, 1 - d / spot.radius);
      }
      this.regionWeights.set(key, weights);
      this.glowTargets.set(key, 0);
      this.glowLevels.set(key, 0);
    });
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
    glowGeometry.setAttribute('color', this.glowColours);
    this.glows = new THREE.Points(
      glowGeometry,
      new THREE.PointsMaterial({
        size: 0.26,
        map: radialTexture(2.4),
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: true,
      }),
    );

    for (const part of [this.glows, this.lines, this.points, this.contourLines]) {
      part.frustumCulled = false;
      part.renderOrder = renderOrder;
      this.group.add(part);
    }
    this.paint(0);
  }

  /** Lights the regions a reading flagged. Others fade. */
  highlightRegions(regions: Array<{ region: FaceRegionKey; tone: 'good' | 'bad' | 'neutral' }>): void {
    for (const key of this.regionKeys) this.glowTargets.set(key, 0);
    for (const { region, tone } of regions) {
      if (!this.glowTargets.has(region)) continue;
      this.glowTargets.set(region, tone === 'bad' ? 1 : tone === 'good' ? 0.55 : 0.75);
    }
  }

  /** How much of the assembly is on, 0..1. */
  setPresence(presence: number): void {
    this.presence = Math.max(0, Math.min(1, presence));
  }

  private paint(elapsed: number): void {
    const n = this.baseBrightness.length;
    const c = new THREE.Color();
    // Start from the base tint scaled by depth, then add each lit region.
    const r = new Float32Array(n);
    const g = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = this.baseBrightness[i];
      r[i] = this.tint.r * k;
      g[i] = this.tint.g * k;
      b[i] = this.tint.b * k;
    }
    this.regionKeys.forEach((key, gi) => {
      const level = this.glowLevels.get(key) ?? 0;
      const weights = this.regionWeights.get(key);
      const pulse = 0.85 + Math.sin(elapsed * 2.1 + gi) * 0.15;
      c.copy(this.warm).lerp(this.alert, level > 0.8 ? 0.6 : 0);
      if (weights && level > 0.001) {
        for (let i = 0; i < n; i++) {
          const w = weights[i] * level * pulse;
          if (w <= 0) continue;
          r[i] = Math.min(1.6, r[i] + c.r * w * 0.9);
          g[i] = Math.min(1.6, g[i] + c.g * w * 0.9);
          b[i] = Math.min(1.6, b[i] + c.b * w * 0.9);
        }
      }
      this.glowColours.setXYZ(gi, c.r * level * pulse, c.g * level * pulse, c.b * level * pulse);
    });
    for (let i = 0; i < n; i++) this.pointColours.setXYZ(i, r[i], g[i], b[i]);
    this.pointColours.needsUpdate = true;
    this.glowColours.needsUpdate = true;
  }

  update(dt: number, elapsed: number, glitch = 0): void {
    let moved = false;
    for (const key of this.regionKeys) {
      const target = this.glowTargets.get(key) ?? 0;
      const level = this.glowLevels.get(key) ?? 0;
      const next = level + (target - level) * Math.min(1, dt * 2.4);
      if (Math.abs(next - level) > 1e-4) moved = true;
      this.glowLevels.set(key, next);
    }
    // Repainting the colours every frame is affordable (478 vertices) and is
    // what keeps the region pulse alive; skipped when nothing is lit.
    if (moved || [...this.glowLevels.values()].some((v) => v > 0.001)) this.paint(elapsed);

    const p = this.presence;
    const flicker = 1 - glitch * 0.5 + Math.sin(elapsed * 9.7) * 0.03;
    (this.lines.material as THREE.LineBasicMaterial).opacity = p * 0.22 * flicker;
    (this.contourLines.material as THREE.LineBasicMaterial).opacity = p * 0.6 * flicker;
    (this.points.material as THREE.PointsMaterial).opacity = p * 0.95 * flicker;
    (this.glows.material as THREE.PointsMaterial).opacity = p * 0.9;
    this.group.visible = p > 0.01;

    // A slow turn, so it reads as a volume rather than a decal. Never so far
    // that the profile hides the face.
    // A glitch throws the turn a hair off for a frame. The position belongs to
    // the rig, which places the group every frame; nothing here may touch it.
    const jolt = glitch > 0.5 ? (Math.random() - 0.5) * 0.06 : 0;
    this.group.rotation.y = this.baseYaw + Math.sin(elapsed * 0.32) * 0.42 + jolt;
  }

  dispose(): void {
    for (const part of [this.lines, this.contourLines, this.points, this.glows]) {
      part.geometry.dispose();
      (part.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}
