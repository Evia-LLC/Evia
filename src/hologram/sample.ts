/**
 * The sample face, for sample mode only.
 *
 * `src/sample/fixtures/scan-face-mesh.json` holds 478 landmarks traced from
 * the Evia mockup's own hologram face (ref4, crop x640 y20 w420 h600), so in
 * sample mode the hologram sits exactly where the mockup draws it. It is not a
 * person's scan and must only ever be shown with the "Sample data" badge on;
 * real mode renders the live session mesh or nothing. The fixture is fetched
 * through a dynamic import, so it is not in any bundle until sample mode asks.
 */
import type { ScanMesh } from '@/scan/mesh.ts';

interface SampleMeshFile {
  sample: true;
  width: number;
  height: number;
  count: number;
  points: number[];
  tessellation: number[];
  contours: number[];
  oval: number[];
}

/** Turns the fixture's JSON into the `ScanMesh` shape the capture hands over. */
export function toScanMesh(file: SampleMeshFile): ScanMesh {
  return {
    points: Float32Array.from(file.points),
    count: file.count,
    aspect: file.width / file.height,
    tessellation: Uint16Array.from(file.tessellation),
    contours: Uint16Array.from(file.contours),
    oval: Uint16Array.from(file.oval),
  };
}

/** Loads the sample mesh (sample mode only). */
export async function loadSampleMesh(): Promise<ScanMesh> {
  const mod = await import('@/sample/fixtures/scan-face-mesh.json');
  return toScanMesh((mod.default ?? mod) as unknown as SampleMeshFile);
}
