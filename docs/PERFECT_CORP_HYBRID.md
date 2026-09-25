# Skin scan provider boundary

Evia's holographic face is **not** a Perfect Corp-rendered object. The public
Perfect Corp server API supplies asynchronous skin-analysis records (`ui_score`
and optional temporary 2D masks). It does not supply the live mesh used by the
room.

The production scan therefore has two explicit, independent inputs:

1. `src/scan/face-mesh.ts` runs MediaPipe Face Landmarker in the browser and
   captures the 478-point mesh at the shutter moment.
2. `server/ai/perfectcorp.ts` requests the vendor's calibrated `ui_score`
   records when a signed-in account has provider access. If unavailable,
   `src/skin-analysis/provider.ts` retains the deterministic local analysis.
3. `src/holograms/portrait.ts` and `src/holograms/face-mesh-3d.ts` render the
   captured frame and mesh in Evia's renderer. `presentAnalysis` lights the
   regions from the same nine metrics; no vendor mesh or vendor hologram is
   claimed.

This boundary is intentional: scores can arrive asynchronously after capture,
while the mesh remains aligned to the exact local frame. A future Perfect Corp
mask response may be added as an additional 2D texture, but must never replace
the local mesh or be described as a 3D provider output without written vendor
documentation.
