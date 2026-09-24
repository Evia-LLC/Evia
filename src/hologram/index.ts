/**
 * The hologram module's public surface. Import it lazily from the Scan page:
 *
 *   const { createHologram } = await import('@/hologram/index.ts');
 *
 * Everything reachable from here pulls in three.js; nothing on the first page
 * load may import it statically. See README.md for the API and wiring.
 */
export { createHologram } from './engine.ts';
export type { HologramAnchor, HologramAnchors, HologramController, HologramOptions, HologramQuality, HologramRenderer } from './engine.ts';
export { ANCHOR_LANDMARK, type RegionHighlight, type ZoneTone } from './regions.ts';
export { HOLOGRAM_BOX, FACE_SLOT, BASE, fitBox, type RefBox, type Fit } from './layout.ts';
export { loadSampleMesh, toScanMesh } from './sample.ts';
