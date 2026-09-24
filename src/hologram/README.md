# src/hologram: the Scan page's face hologram (three.js)

Draws the ref4 consult-room hologram from the user's own `ScanMesh`: a warm-mauve translucent face
surface built from the landmark triangles with a cyan Fresnel rim, a dense contour-following dot lattice,
soft zone tints (pink / lavender / periwinkle) where the reading has something to say, and around it the
decoration that makes it read as a bust: a head shell lofted from the face's upper edge, drawn as no more
than a broken hairline on its outline that fades toward the crown (with a few faint arcs, nodes and drifting
particles; no fill, so it never reads as a cap over the face), a translucent neck column that flares into
the base, and the emitter rings and glass orb. The forehead dissolves into the lattice along a dome that
follows the face's outline (the face shader's `top` term) rather than stopping at a flat hairline, and the
soft glow behind the head sits behind the face only, so the crown stays clear and the head reads as a
floating face rather than a face in a hood.
The pedestal itself is in the Blender plate; the canvas is transparent and sits over it.

**Load it lazily.** Everything here pulls in three.js, which must stay out of the first page load:

```ts
const { createHologram, loadSampleMesh } = await import('@/hologram/index.ts');
```

## API

```ts
const holo = createHologram(canvas, {
  box?: RefBox,            // part of ref4 the canvas shows; default HOLOGRAM_BOX = { x: 560, y: 0, w: 550, h: 620 }
  fit?: 'contain' | 'cover', // default 'contain'
  align?: { x, y },        // 0..1, like object-position; phone layout: { x: 0.5, y: 1 } keeps the rings on the bottom edge
  quality?: 'auto' | 'low' | 'medium' | 'high',  // default 'auto'
  reducedMotion?: boolean, // default: prefers-reduced-motion; pass the user's preference too
  maxFps?: number,         // default 60 (30 on touch devices and at 'low')
  onAnchors?: (anchors) => void,  // after a frame, whenever an anchor moved (> 0.25 px) or changed visibility
});

holo.supported                 // false if WebGL could not start: every method is a no-op, show your own fallback
holo.setMesh(mesh | null)      // the live session mesh; null clears the face (rings only)
holo.setRegions([{ region, tone, strength, outline? }])   // FaceRegionKey, 'pink'|'lavender'|'periwinkle', 0..1;
                               // outline defaults per region (REGION_OUTLINE: the right cheek is a bare dot field)
holo.setActiveRegion(region | null)             // the one being talked about: brighter, dots lifted
holo.anchors()                 // Record<FaceRegionKey, { x, y, visible }> in CSS px of the canvas
holo.resize()                  // re-read the canvas size (automatic where ResizeObserver exists)
holo.setQuality(q); holo.setReducedMotion(on); holo.pause(); holo.resume()
holo.dispose()                 // frees every GPU resource and the context; mount a fresh <canvas> for a new one
```

Size the canvas with CSS; the engine reads `clientWidth`/`clientHeight` and handles DPR itself. While the
canvas has no layout size (`display: none`, a collapsed panel on the phone's sequential flow) it keeps its
last drawing buffer and draws nothing; it never guesses a size from the buffer.

### Placement

World units are ref4 pixels (1672 x 941 frame). With the default box, a canvas laid over x 560-1110,
y 0-620 of the Scan stage puts the face exactly where the mockup draws it (landmarks span x 713-1024,
y 155-484) and ring A on the pedestal glass (centre 865,547.5). Any face is scaled to the same height
and centred on the same point (`FACE_SLOT`). `fitBox(box, w, h, fit, align)` is exported if DOM overlays
need the same mapping (CSS px per ref px = `scale`).

### Anchors and callouts

`anchors()` / `onAnchors` give one point per `FaceRegionKey`, projected from a landmark on the moving
face every frame, for the DOM leader lines and anchor dots (the dots and lines are UI, not drawn here).
The landmarks are in `ANCHOR_LANDMARK`: the capture's `MESH_REGION_ANCHORS`, moved where that point is
off its zone or away from the mockup's callout (forehead 151, cheeks 207 / 427, chin 428). `ANCHOR_BLEND`
moves an anchor part of the way toward a second landmark: the forehead's goes half-way from 151 to 9,
since 151 sits inside the band where the forehead dissolves. Each anchor lies inside its own zone. On the
sample mesh they land within 15 px of the mockup's callout anchors, except the forehead's, about 38 px
lower: the mockup draws its forehead zone above y 155, where the mesh has no landmarks, and the anchor
here stays on lit, measured surface. `visible` is false without a face, while
it builds in, or if the point turns away or leaves the canvas: hide that callout's line then.

### Wiring it to the director

- `director.hologram.mesh` → `setMesh` (real mode). It is cleared by the controller when the
  presentation ends; pass `null` then. Never cache it.
- Findings → `setRegions`: map each metric to its regions with `METRIC_REGIONS`
  (`src/skin-analysis/metrics.ts`) or, better, only the region `locusFor` names; strength from severity
  (suggested: slight 0.45, moderate 0.7, marked 0.9); tone as the mockup does (forehead and cheeks pink,
  chin and left under-eye lavender, right under-eye periwinkle), or one tone per metric family.
- `director.hologram.activeRegion` is a **metric key**; map it to its main region for `setActiveRegion`.
- Reduced motion: pass `prefers-reduced-motion` or `session.user?.preferences.reducedMotion` to
  `setReducedMotion`. Under it nothing sways, pulses, drifts or sweeps, and frames are only drawn when
  something changes.

### Sample mode

`loadSampleMesh()` returns the sample mesh (`src/sample/fixtures/scan-face-mesh.json`, traced from the
mockup's own hologram face, not a person). Use it only with sample mode on (the "Sample data" badge is
then showing). Real mode renders the live mesh or nothing: no mesh means rings only, and the page shows
its "Scan to see your map" state. Never a stock head.

## What it never does

- Persist anything. The mesh lives in this object's GPU buffers until `setMesh(null)` / `dispose()`
  (SRS RET-01..03). It does not read `director.hologram.capture` (the photo) at all.
- Present decoration as data. The head shell is a smooth ellipsoid cap lofted from the face's own upper
  edge, drawn as a faint blue hairline with a few geometric arcs and particles, never skin, lattice or hair;
  the neck is a shaded column. Both are placed from the face's size and carry no captured data.

## Performance

- DPR cap 2 / 1.5 / 1 (high / medium / low), and never a drawing buffer over 4096 px on a side; 'low'
  also caps at 30 fps and uses a coarser lattice (about 3,000 dots against 3,800).
- 'auto' picks low on <= 2 cores or <= 2 GB, medium on touch devices, else high. Frames are timed in
  two-second windows; a window that averaged slower than 1.5x the frame budget (under 2/3 of the cap)
  steps down one level. Materials are made once per engine, so a step (or a new mesh) only rebuilds
  geometry and textures, never shader programs.
- Pauses itself when the tab is hidden or the canvas is off-screen (IntersectionObserver).
- Measured on the 2-core dev laptop (frame drawn and forced to finish with a 1 px readPixels, which alone
  costs about 1.9 ms): 9.6 ms/frame at 1100 x 1240 px (high), 6.8 at 825 x 930 (medium), 4.4 at
  550 x 620 (low). Building a face (triangles, lattice, shell, zone textures) about 25 ms of script plus
  about 60 ms of texture upload and first draw, once per mesh.
- Draw calls: 17 with a face and zones (7 for the base alone). Context loss is handled (pauses, rebuilds on restore).

## Files

| file | what |
|---|---|
| `index.ts` | the public surface (lazy-import this) |
| `engine.ts` | `createHologram`: scene, loop, anchors, lifecycle |
| `geometry.ts` | three-free: triangles from the tessellation, hole filling, normals, silhouette, dot lattice, head shell |
| `regions.ts` | region shapes from landmarks, zone and feature textures, anchor landmarks |
| `layout.ts` | ref4 placements (box, face slot, rings, orb) and the fit arithmetic |
| `shaders.ts` | GLSL |
| `sample.ts` | sample-mode mesh loader |

Tests: `test/hologram-engine.test.ts` (triangulation, lattice, head shell, anchors against the mockup and
their zones, no-mesh, zero-size layout, material reuse, dispose).
