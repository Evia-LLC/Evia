# scan-face-mesh.json: SAMPLE DATA, not a person's scan

478 MediaPipe face landmarks (x, y, z per point, normalised to the crop) plus the tessellation,
contour and face-oval index pairs, traced from the Evia Scan mockup's own hologram face
(`ref4.png`, crop x 640, y 20, w 420, h 600). Because the points are in that crop's frame, the
sample hologram lands exactly where the mockup draws it.

- It is illustrative sample data for **sample mode only** (`?sample=1`, "Sample data" badge on).
- It is never shown as, or mixed with, a user's result. Real mode renders only the live session
  mesh, which is never stored (SRS RET-01..03), or no face at all.
- Loaded lazily through `loadSampleMesh()` in `src/hologram/sample.ts`, so it is in no bundle until
  sample mode asks for it. The file carries `"sample": true` and a `label` saying the same.
