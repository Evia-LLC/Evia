# Consult room plates (Scan screen, ref4)

Rendered in Blender 4.5 LTS (Cycles CPU, 64 spp, OpenImageDenoise) from the procedural scene
`scripts/blender/room_consult.py`, then graded and encoded by `scripts/blender/consult_post.py`.
No person, head, face, hologram or text is in any image. The character is an SVG overlay, the
hologram is code-built, and all wall, pedestal and book text is HTML placed with `anchors.json`.

## Files

| File | Size | What it is |
|---|---|---|
| `plate-{2560,1920,1280}.webp` | 16:9 (93 / 66 / 42 KB) | Room plate, opaque. Includes the pedestal and book stack, so it is complete on its own. |
| `fg-{2560,1920,1280}.webp` | 16:9 RGBA (53 / 39 / 22 KB) | Foreground: pedestal (copper band, glass top, blue rim, under-glow, base) plus the book stack, tray and ledge. Where alpha = 1 the pixels match the plate. |
| `glow-neon-*.webp` | 16:9 | Additive boost of the rose LEDs and their spill: ceiling halo, wall strips, arch coves, tier lips, ring light. |
| `glow-under-*.webp` | 16:9 | Additive boost of the pedestal under-glow ring. |
| `glow-emitter-*.webp` | 16:9 | Additive boost of the blue emitter rim and inlaid glass rings, masked to the pedestal. |
| `plate-blur-640.webp` | 640 wide | Pre-blurred plate for frosted-glass UI panels. Stretch it to the plate box. |
| `anchors.json` | | Overlay anchors for the desktop plate (see below). |
| `mobile-*.webp`, `mobile-plate-blur-360.webp`, `anchors-mobile.json` | 1080x2340 / 720 | The same set for the phone-portrait camera C2. |

## Layer stack (scan.md 1.3)

```
z 0    plate-*.webp                          normal
z 0.5  glow-neon-*.webp                      mix-blend-mode: plus-lighter (fallback: screen), animate opacity
z 1    character body (SVG)                  anchors.character.bbox
z 2    fg-*.webp (RGBA)                      normal  -> hides her lower body behind the pedestal rim and books
z 2.5  glow-under-*.webp                     plus-lighter, animate opacity
z 3    character resting hand (SVG group)    anchors.character.restingHand (fingers on the rim)
z 3.5  glow-emitter-*.webp                   plus-lighter, animate opacity (pulse with the hologram)
z 4    hologram (code)                       base = anchors.ellipses.hologram_base, axis = anchors.points.emitter_centre
z 5    wall, pedestal and book text (HTML)   anchors.surfaces (quads) and anchors.curves (textPath)
z 6    UI
```

- All image layers share one pixel grid. Stack them as same-size images in one box.
- Glow layers are display-space deltas:
  - opacity 0 = the plate exactly as rendered
  - opacity 1 = those lights brighter by the factor noted in `anchors.json -> files`
- scan.md 9 asks for very subtle breathing, for example opacity 0 to 0.35 over 8 s.
- Turn the breathing off under `prefers-reduced-motion`.
- There is no baked vignette; add one in CSS if wanted.

## Responsive framing (safe margin)

The desktop plate carries a 10 % safe margin on every side. The reference framing (ref4, 1672x941)
is the rect `anchors.refFrame` = `{x: 0.0833, y: 0.0833, w: 0.8333, h: 0.8333}` of the plate.

- **To reproduce the reference:** scale the plate so that `refFrame` covers the stage. The plate
  width is stage width / 0.8333, offset by -10 % of the stage on each axis.
- **At other aspect ratios:** use `object-fit: cover` on the whole plate. The margin then shows
  real room content (the full ceiling halo, the arch nook, the ring light, the floor) instead of an
  empty edge.
- **The phone-portrait plates (`mobile-*`)** have no reference framing (`refFrame: null`), and
  their anchors are in their own plate coordinates. C2 layout:
  - same eye position, 900 reference px wide
  - pedestal top at 70 % of the height, sides cropped
  - hologram space and halo above the pedestal

## anchors.json

Coordinates are normalised to the plate (0..1, origin top-left). Multiply them by the rendered
plate box.

- **`ellipses`** (`pedestal_top`, `pedestal_glass`, `glass_ring_*`, `hologram_base`,
  `ceiling_halo`): projected circles as `cx, cy, rx, ry`, plus `yTop` / `yBottom`.
- **`points`** (`emitter_centre`, `emitter_axis_top`): the hologram axis on the glass.
- **`curves`** (`pedestal_band_mid/top/bottom`): polylines along the front of the copper band, for
  an SVG `<textPath>`.
- **Engraving quads:** `surfaces.pedestal_text_left` holds "Your skin. Understood." and
  `surfaces.pedestal_text_right` holds "Evia".
- **Blank-surface quads:** `surfaces.wall_left_text`, `wall_right_text` and `book_spine_*` are
  perspective quads (TL, TR, BR, BL). Map the HTML onto them with a homography (`matrix3d`).
  `blurPx` is the depth-of-field blur at a 2560 px plate width; scale it with the rendered width.
- **`character`:** `bbox`, `restingHand`, `presentingHand`, `headTarget`, `pxPerMetre`, `blurPx`.
- **`light`:** key, rim and ambient colours for tinting the character.
- **`build`:** Blender version, script hash, seed, spp, render time and every scene parameter.





## Living-room masks (for animating the plate)

The plates are still pictures. To give the room life (plants swaying in the air-conditioning, city windows
twinkling, lamps flickering, LED coves breathing or carrying a slow travelling pulse), the web layer can drive
small effects from these **data maps**. They were rendered from the same Blender scene, camera, depth of field,
framing (including the safe margin where the plate has one) and size as the plates they pair with (`--passes masks`,
`scripts/blender/mask_passes.py`, encoded by `scripts/blender/mask_post.py`), so every mask pixel lies exactly on the
plate pixel of the same width. The anchors file lists them under `masks` (with the plate they pair with), and adds
`lights`, `strips` and `plants` (ids used inside the masks) plus `points`/`ellipses` `lamp_<name>` for each lamp.

They are not plates: never show them, sample them. All masks are 8-bit RGB **lossless** WebP (value = byte / 255,
ids exact); `depth` is lossy. Masks that would be empty in a room are not published.

| mask | R | G | B |
|---|---|---|---|
| `mask-plants` | leaf/stem coverage (anti-aliased, soft where the plate is out of focus) | sway weight: (distance from the plant's base / camera depth of the base) / `swayScale`, 0 at the pot .. 1 at the most mobile leaf tip in the frame, feathered to 0 at `featherPx` outside the silhouette | plant id / 255 (`plants[].id`), nearest plant inside the feather zone |
| `mask-sky` | open sky seen through the glass (R=G=B) | | |
| `mask-glass` | window glass seen directly (R=G=B) | | |
| `mask-windows` | lit city windows (and street lights), weighted by haze visibility | per-window random id 0..1 (constant over a window) | city coverage (skyline silhouette) |
| `mask-lamps` | lamp fixture coverage | lamp id / 255 (`lights[].id`) on the fixture and its halo zone | halo weight, 1 at the lamp centre .. 0 at `haloScale` x the fixture's radius |
| `mask-coves` | LED strip / cove / ring coverage (only strips the camera sees) | distance along the strip 0..1 (`strips[].lengthM` in metres), carried outward to `zonePx` from the nearest strip | strip id / 255 (`strips[].id`), same zone |
| `mask-emitter` (consult) | emitter rim + inlaid glass rings | angle around the pedestal axis 0..1 | radius / pedestal radius 0..1 (0 outside the glass top) |
| `depth` | linear mist depth (R=G=B), range in `masks.depth.note` | | |

Suggested use (not wired into the app yet):

- **WebGL** (one full-screen quad per room; plate, glow/dim layers and masks as textures): plants
  `uv -= wind(t, id) * G * A / plateWidth` with A about 2-3 px at 1280 wide (keep A below `featherPx`); windows
  `rgb += rgb * R * twinkle(t, G)`; lamps `rgb *= 1 + B * flicker(t, id)` (candle: fast irregular, globes: slow
  breathe, beacons: blink); coves `rgb += glowDelta * pulse(G * lengthM - speed * t)` where B > 0 (on closed strips,
  `shape: "ring"`, use a whole number of waves per loop so the 1 -> 0 wrap never shows; the wrap is placed in a
  stretch the camera cannot see or, on a ring seen all the way round, at its faintest point, where a few pixels
  carry a mixed value).
- **Exact values**: decode with `createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`
  and `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE`; sample id channels with NEAREST, coverage/weights with LINEAR.
- **Without WebGL**: lamps can pulse as CSS radial-gradient spans at `points.lamp_*` / `ellipses.lamp_*`
  (`mix-blend-mode: plus-lighter`), coves with the existing glow layers; a grayscale mask (sky, glass) works as a
  CSS `mask-image` with `mask-mode: luminance`.
- Everything stays still under `prefers-reduced-motion` (and the app's reduced-motion setting).
- Re-run `mask_post.py` after re-publishing a plate: the plate's own post step rewrites the anchors file.

### In this folder

| render | masks (widths) | pairs with | depth |
|---|---|---|---|
| C1 desktop | `mask-{plants,sky,glass,windows,coves,emitter}-{2560,1280}.webp` | `plate-{2560,1280}.webp` | `depth-1280.webp` (0 = 0.5 m .. 1 = 40 m) |
| C2 phone | `mobile-mask-{plants,sky,glass,windows,coves,emitter}-{1080,720}.webp` | `mobile-plate-{1080,720}.webp` | `mobile-depth-720.webp` |

- **No lamps mask**: this room has no lamp fixtures. Its lights are LED lines and rings, all in `mask-coves`: the
  ceiling halo (band + LED line), the wall ring light, the pedestal under-glow ring, the tier, step, sill and plinth
  lines, and the jamb, pilaster and right-panel strips. Rings have `shape: "ring"` in `strips`.
- **Emitter**: the blue rim and inlaid rings of the pedestal glass (R), with polar coordinates over the whole glass
  top (G angle from +X counter-clockwise seen from above, B radius / pedestal radius; the glass outline itself is
  `ellipses.pedestal_glass`). This is for rings rippling outward from the hologram base or a slow rotating sweep
  under the code-built hologram; the `glow-emitter` layer stays the way to brighten them.
- **Plants**: the two blossom trees and the two shrubs on the tier (C1); the two shrubs (C2).
- **Windows**: lit windows and the street-light river, as the same depth-of-field discs as the plate. No aviation
  beacon is visible from these cameras.
- **Sky**: the thin band of night sky between the towers.
- `consult_post.py` rewrites the anchors files: run `mask_post.py` again after it (commands in the header of
  `scripts/blender/room_consult.py`).

## Regenerating

See the header of `scripts/blender/room_consult.py` for the preview and final tiers and
`--camera mobile`. Then run `consult_post.py --exr <exr> --publish public/env/consult`. Renders
must go through the shared lock wrapper (`tools/blender-render.sh`).
