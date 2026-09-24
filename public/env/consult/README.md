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

## Regenerating

See the header of `scripts/blender/room_consult.py` for the preview and final tiers and
`--camera mobile`. Then run `consult_post.py --exr <exr> --publish public/env/consult`. Renders
must go through the shared lock wrapper (`tools/blender-render.sh`).
