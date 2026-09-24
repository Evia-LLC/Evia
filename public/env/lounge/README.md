# Lounge environment plates (Home, sidebar)

Rendered in Blender 4.5 LTS (Cycles, CPU, OpenImageDenoise) from
`scripts/blender/room_lounge.py` (+ `lounge_lib.py`) and graded/encoded with
`scripts/blender/lounge_post.py` (look `lounge`). Everything is procedural and
seeded. There is no character, no UI and no wall/sign text in any plate.

Coordinates in `anchors.json` are normalised to the plate: 0..1, origin top-left,
x right, y down. Quads are ordered TL, TR, BR, BL.

## Files

| file | what | size |
|---|---|---|
| `home-2560.webp`, `home-1920.webp`, `home-1280.webp` | **L1 Home plate**, 16:9 desktop. Dusk penthouse lounge with the empty armchair, marble side table and blank acrylic sign. | 2560x1440 and downscales |
| `home-dim-2560.webp`, `home-dim-1280.webp` | Same plate with the LED/lamp light group ("glow") at 45 %. | |
| `home-glow-2560.webp`, `home-glow-1280.webp` | Additive glow delta = plate - dim (mostly black). | |
| `home-fg-2560.webp`, `home-fg-1280.webp` | RGBA foreground: marble table + acrylic sign only (alpha = cryptomatte coverage, soft DOF edges). | |
| `home-depth-1280.webp` | Mist depth, 0 = 0.5 m, 1 = 30.5 m (linear). Optional (parallax/fog). | |
| `home-mobile-1080.webp`, `home-mobile-720.webp` (+ `-fg-`, `-dim-`, `-glow-`) | **L2 phone-portrait Home plate** (1080x2340, 9:19.5). New composition, no reference. | |
| `sidebar-window-640.webp`, `sidebar-window-320.webp`, `sidebar-window-blur-160.webp` | **L3 sidebar strip** (640x2048 = ref2 sidebar 320x1024 @2x): large cocoa column on the left, dusk window + skyline, plants, cream seating and LED ledges on the right. Rendered clean; the dark rose-brown glass is CSS. | |
| `anchors.json` | Per-camera anchors (`cameras.home`, `cameras.home_mobile`, `cameras.sidebar_window`). | |

## Layering (back to front)

1. `home-*.webp` (or, for breathing LEDs, `home-dim-*` with `home-glow-*` on top,
   `mix-blend-mode: plus-lighter` (fallback `screen`), animating the glow layer's
   `opacity` between ~0.6 and 1.0. At opacity 1 it is identical to the plate).
2. Wall text on the niche: `surfaces.niche_text` / `niche_rule` (behind the
   character, it is on the back wall).
3. Character SVG (when one exists) at `character.*`.
4. `home-fg-*.webp` (table + sign; it occludes the character's lower right).
5. Sign text on the acrylic: `surfaces.sign_text` / `sign_rule`.
6. UI.

## anchors.json, camera `home`

- `refFrame` {x, y, w, h}: where ref1's Home panel (ref1.png x 0..993, y 0..1023)
  sits inside the plate. The plate adds a ~10 % safe margin on every side
  (more on the left, which continues the window wall), so any aspect ratio can
  be covered. To reproduce ref1 exactly in a 994x1024-shaped box: draw the
  plate at `width = box.w / refFrame.w`, `height = box.h / refFrame.h`, offset
  `left = -refFrame.x * width`, `top = -refFrame.y * height`. For other boxes
  use `object-fit: cover` with `object-position: right center` (keeps the
  chair/niche/table side), or compute a cover scale that keeps `refFrame`'s
  right edge in view.
- `surfaces.*.quad`: projected quads of the blank surfaces for HTML text. Warp
  the text box onto them with a homography (CSS `matrix3d`). They land on the
  ref1-measured text positions (niche TL (852,238) ... BL (851,308); sign
  TL (898,627) ... BL (897,684) in ref px). `depthM` is the camera depth,
  `cocPx` the depth-of-field blur diameter in plate pixels at the plate width
  (scale it to the displayed width, then `filter: blur(cocPx/2 px)`).
- `character`: slot for a person seated in the armchair (the chair is
  rendered empty): `seatAnchor`, `headTarget`, `bbox` [x0,y0,x1,y1],
  `pxPerMetre` (plate px per metre at the chair), `depthM`, `cocPx`.
  The chair was moved back (4 m) so the plate reads across the room without a
  character; a character drawn in this slot is smaller than in ref1.
- `ellipses.table_top`: marble table top (for hover glow or contact shadows).
- `layers.fg.depthM`: depth of the foreground layer (for parallax).

`home_mobile` has the same keys minus `refFrame`. `sidebar_window` has only the
plate size (no overlays).

## Re-rendering

See the header of `scripts/blender/room_lounge.py`. Renders go through the
lock wrapper (`work/evia-rebuild/tools/blender-render.sh`). Final tier used:
Cycles 40 spp adaptive (threshold 0.02) + OIDN, 2560x1440, ~26 min on the
i3 MacBook.
