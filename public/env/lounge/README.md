# Lounge environment plates (Home, phone Home, sidebar strip)

Rendered in Blender 4.5 LTS (Cycles, CPU, OpenImageDenoise) from
`scripts/blender/room_lounge.py` (+ `lounge_lib.py`) and graded/encoded with
`scripts/blender/lounge_post.py` (look `lounge`, or `strip` for the sidebar
strip). Everything is procedural and seeded. No plate contains a character, UI
or wall/sign text.

Coordinates in the anchors files are normalised to the plate: 0..1, origin
top-left, x right, y down. Quads are ordered TL, TR, BR, BL.

## Files

| file | what | size |
|---|---|---|
| `home-2560.webp`, `home-1920.webp`, `home-1280.webp` | **L1 Home plate**, 16:9 desktop. Dusk penthouse lounge with the empty armchair, marble side table and blank acrylic sign. | 2560x1440 and downscales |
| `home-dim-2560.webp`, `home-dim-1280.webp` | The same plate with the LED/lamp light group ("glow") at 45 %. | |
| `home-glow-2560.webp`, `home-glow-1280.webp` | Additive glow delta = plate - dim (mostly black). | |
| `home-fg-2560.webp`, `home-fg-1280.webp` | RGBA foreground: the marble table and acrylic sign only (alpha = cryptomatte coverage, soft depth-of-field edges). | |
| `home-depth-1280.webp` | Mist depth, 0 = 0.5 m, 1 = 30.5 m (linear). Optional, for parallax or fog. | |
| `anchors.json` | Room format for room `lounge` (the L1 plate), with the Blender job's anchors under `cameras.home`. | |
| `mobile-1080.webp`, `mobile-720.webp` | **L2 phone-portrait Home plate** (1080x2340, 9:19.5): the seating group (empty armchair, marble table, blank acrylic), the dusk window and skyline, the glowing niche and the cove. There is no mockup for this composition. | 1080x2340, 720x1560 |
| `mobile-dim-*`, `mobile-glow-*`, `mobile-fg-*` (1080, 720), `mobile-depth-720.webp` | The same layers as for Home. | |
| `anchors-mobile.json` | Room-format anchors for the L2 plate (same keys as `anchors.json`, no ref frame). | |
| `strip-window-640.webp`, `strip-window-320.webp` | **L3 sidebar strip** (640x2048 = ref2's sidebar, 320x1024, at 2x): a rose plaster column on a stepped LED plinth with a small plant, a floating ceiling soffit whose cove sweeps across the top, the dusk window with a few towers, a tall plant, cream banquette and sofa, glossy floor. Rendered clean. | |
| `strip-window-soft-320.webp` | The strip softened slightly (gaussian sigma 1.2 px at 320 wide), about as soft as the room in ref2's sidebar. | |

The strip's Room anchors live in `public/env/lounge-strip-window/anchors.json`
(room id `lounge-strip-window`). They point at the two strip files here by
absolute src: `strip-window-640.webp` is the `base` plate and
`strip-window-soft-320.webp` is the `blur` plate, which `<Room blurred>` (the
sidebar) shows. The dark rose-brown glass (`--sidebar-glass`,
`--sidebar-insurance`) is CSS, drawn over the strip. The strip was tuned
under a simulation of that glass so that the result matches ref2's sidebar. If
you want the heavier CSS `blur(16px)` instead, drop the `blur` plate from that
anchors file.

## Layering, Home (back to front)

1. `home-*.webp`. For breathing LEDs, use `home-dim-*` with `home-glow-*` on
   top (`mix-blend-mode: plus-lighter`, fallback `screen`), and animate the glow
   layer's `opacity` between ~0.6 and 1.0. At opacity 1 the result matches the
   plate.
2. Wall text on the niche: `surfaces.niche_text` / `niche_rule`. It is on the
   back wall, behind the character.
3. The character SVG, if one is ever drawn, at `points.character` /
   `character_head` (full slot in `cameras.home.character`). None is drawn now,
   and the plate is composed to read with the chair empty.
4. `home-fg-*.webp` (table + sign; it covers the lower right of the character).
5. Sign text on the acrylic: `surfaces.sign_text` / `sign_rule`.
6. UI.

The phone plate layers the same way with the `mobile-*` files and
`anchors-mobile.json`.

## anchors.json (room `lounge`, camera `home`)

- `points.home_ref_tl` / `home_ref_br` (and `cameras.home.refFrame`): where
  ref1's Home panel (ref1.png x 0..993, y 0..1023) sits inside the plate. The
  plate adds a ~10 % safe margin on every side, and more on the left, which
  continues the window wall, so any aspect ratio can be covered. HomeRoom and
  stage.ts already use this frame.
- `surfaces.*.quad`: projected quads of the blank surfaces for HTML text. They
  land on the text positions measured in ref1: niche TL (852,238) ... BL
  (851,308); sign TL (898,627) ... BL (897,684), in ref px. `blurPx` = `cocPx`/4
  at the plate width. `cocPx` is the depth-of-field blur diameter in plate
  pixels.
- `ellipses.table_top`: the marble table top (for a hover glow or contact
  shadows).

## anchors-mobile.json (L2)

It has the same Room keys, verified by drawing them over the plate: the niche
quad sits on the niche panel, the sign quad on the acrylic, and the table
ellipse on the table top. **The app does not use it yet.** On phones,
HomeRoom/stage.ts crop the desktop plate to the seating group, which shows
about 665 plate px across a ~1170 px phone screen. To use the sharper,
dedicated phone plate, load `anchors-mobile.json` and show `mobile-1080.webp`
with `object-fit: cover`. `frame.focus` [0.5, 0.55] keeps the seat. The seat
(`points.character`) sits at 58 % of the height. The top ~22 % is a plain,
dark ceiling, which suits the greeting text.





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
| L1 Home | `home-mask-{plants,sky,glass,windows,lamps,coves}-{2560,1280}.webp` | `home-{2560,1280}.webp` (and its dim/glow/fg layers) | `home-depth-1280.webp` (published with the plate) |
| L2 phone | `mobile-mask-{plants,sky,glass,windows,lamps,coves}-{1080,720}.webp` | `mobile-{1080,720}.webp` | `mobile-depth-720.webp` (published with the plate) |
| L3 strip | `strip-window-mask-{plants,sky,glass,windows,lamps,coves}-{640,320}.webp` | `strip-window-{640,320}.webp`; the 320 masks also fit `strip-window-soft-320.webp` | `strip-window-depth-320.webp` (0 = 0.5 m .. 1 = 30.5 m) |

`anchors.json` / `anchors-mobile.json` carry the L1 / L2 lists; the strip's are in
`../lounge-strip-window/anchors.json` (absolute srcs). Each `masks` list also names the plate's breathing layers
(`glow`, `dim`: pictures, not data maps). The strip now has them too: `strip-window-{dim,glow}-{640,320}.webp`, graded
by `lounge_post.py` (look `strip`) from the same final render as the published strip, whose plates that run
reproduces bit for bit. As for Home, draw `glow` over `dim` with `plus-lighter` and animate its opacity ~0.6..1; unlike
the cove mask, the glow layer includes the LEDs' reflections in the glossy floor.

- **Plants**: the big plant in front of the window, the plant on the fluted planter, the two plants on the sofa ledge
  and the small shrubs of the low planter, each with its own id so they can move out of phase. The palm at the far
  left of the scene sits behind the partition and is not in the L1 mask. L3: the tall plant by the window and the small
  plant on the plinth.
- **Lamps**: the candle globe on the console (`motion: "flicker"`), the globe lamp by the acrylic sign (`breathe`) and
  the ceiling downlights (`steady`). The second globe lamp is hidden by the armchair on L1 (partly visible on L2, see
  `lights[].visible`). The city's red aviation beacons are in the scene but hidden behind towers from these cameras,
  so none are listed.
- **Coves**: island ceiling cove, portal arch, niche outline, fluted-planter rim, low-planter edge, ottoman and
  banquette floor lines, the sign's edge and base (L3: soffit cove and rim, the two plinth rings, banquette line).
- **Windows**: every lit window of the procedural city, far ones fainter in R (haze); B is the skyline silhouette.
- **Outside**: the lounge looks out over a city about 60 m below; there are no trees outside. The outside life
  available is the lit windows (twinkle) and the sky (a slow colour drift under `mask-sky`). Trees on a terrace would
  need new geometry and a re-render of the plates.
- Regenerate: `room_lounge.py -- --camera {home|home_mobile|sidebar_window} --passes masks --spp 128`, then
  `mask_post.py publish ...` (header of `scripts/blender/room_lounge.py`). The render is deterministic (fixed seed).

## History

- Home plate v2 (current): re-graded from the second L1 final
  (`final_home2`: the window glass no longer reflects the LED lines across the
  sky, and the lamps are invisible to the camera). It uses the fixed bloom,
  which no longer puts a dark ringing halo next to bright LED lines. The camera
  and anchors are identical to v1, and so is `anchors.json`. The v1 files are
  kept in `work/evia-rebuild/work/blender/lounge/published_backup_home_v1/`.

## Re-rendering

See the header of `scripts/blender/room_lounge.py`. Renders go through the
lock wrapper (`work/evia-rebuild/tools/blender-render.sh`). Final tier:
Cycles adaptive (threshold 0.02) + OIDN on the 2-core i3.

| plate | size | spp | time |
|---|---|---|---|
| Home | 2560x1440 | 40 | ~33 min |
| phone | 1080x2340 | 40 | ~16 min |
| strip | 640x2048 | 32 | ~11 min |
