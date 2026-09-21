import type { ScanMesh } from '@/holograms/face-mesh-3d.ts';
import data from './face-data.json';

/**
 * Development-only illustration from MediaPipe's canonical face: 468 original
 * landmarks plus the ten official iris landmarks, preserving detector indices.
 * This is generic geometry, never a capture or a skincare measurement.
 * See MEDIAPIPE-ATTRIBUTION.md for pinned sources, mapping and license.
 */
export function studioFace(): ScanMesh {
  if (!import.meta.env.DEV) throw new Error('The illustrative studio face is development-only.');
  return {
    points: new Float32Array(data.points),
    count: data.points.length / 3,
    aspect: 1,
    tessellation: new Uint16Array(data.edges),
    contours: new Uint16Array(data.contours),
    oval: new Uint16Array(data.oval),
  };
}
