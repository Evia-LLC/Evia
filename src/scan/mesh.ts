/**
 * The face mesh the capture hands over, and nothing that draws it.
 *
 * The capture screen finds 478 landmarks on the face being scanned, each with
 * a depth, and at the shutter it leaves them on `session.lastMesh` for the
 * presentation to build the hologram from. This file is the shape of that
 * hand-off and the little arithmetic every renderer of it needs, kept free of
 * three.js so the session, the controller and the director can name the type
 * without pulling a renderer into the first page load.
 *
 * Presentation only, never measurement: the numbers come from the skin
 * pipeline, the mesh is never added to a scan or sent to the server, and every
 * scan exit path clears it (see `session.clearScanArtifacts`).
 *
 * Moved here from the retired `holograms/face-mesh-3d.ts`, which also held the
 * three.js lattice built from it. The anchors and the normalisation below are
 * that file's, unchanged.
 */
import type { FaceRegionKey } from '@shared/types.ts';

/** What the capture screen hands over. Normalised to the source image. */
export interface ScanMesh {
  /** xyz per landmark: x and y in 0..1 of the source frame, z relative depth (negative toward the camera). */
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
 * rectangles on a 2D crop; these are the same places on the 3D surface, which
 * is what lets a callout point at the user's own face rather than at a stock
 * head. The indices were carried over as they were and have not been checked
 * against a canonical-mesh map since.
 */
export const MESH_REGION_ANCHORS: Record<FaceRegionKey, { index: number; radius: number }> = {
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

/**
 * The mesh in a centred frame one face-height tall: y up, z toward the viewer.
 *
 * x is put in the same units as y using the source aspect, the whole face is
 * centred on its bounding box, and depth - the least trustworthy axis a single
 * camera gives - is kept but flattened a little so the head reads as a head
 * rather than a mask. Returns a new array; the capture's own is left alone.
 */
export function normaliseMesh(mesh: ScanMesh): Float32Array {
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
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = (raw[i * 3] - cx) * scale;
    out[i * 3 + 1] = (raw[i * 3 + 1] - cy) * scale;
    out[i * 3 + 2] = (raw[i * 3 + 2] - cz) * scale * 0.8;
  }
  return out;
}
