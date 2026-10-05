# Products hero backdrop (L5)

Rendered in Blender 4.5 LTS (Cycles, CPU, OpenImageDenoise, 32 spp) from
`scripts/blender/room_products_hero.py` and graded with
`scripts/blender/lounge_post.py` (look `hero`). Procedural and seeded; no
character, no text.

A high-key blush room behind the Products hero (ref3.png screen x 160..1222,
y 0..311): soft plaster wall, darker toward the top left, a pale pilaster, an
arched window with cream mullions on the right, a warm globe pendant, a rubber
plant and a small plant on a low tan sideboard. Heavy depth of field.

## Files

| file | what |
|---|---|
| `hero-2552.webp` | The plate, 2552x748, **lossless** WebP (~330 KB). Lossy WebP bands the smooth wall gradients visibly, so this plate ships lossless. |
| `hero-1276.webp` | Half size (~105 KB), for 1x screens. |
| `anchors.json` | Room format (`frame`, `plates`, `surfaces`, `points`), plus the Blender job's own anchors under `cameras.products_hero`. |

## Framing

The plate is ref3's hero frame at 2x (2124x622) plus a ~10 % safe margin on
every side. `points.hero_ref_tl` / `hero_ref_br` give that frame inside the
plate (0.0839, 0.0842) .. (0.9161, 0.9158).

- With plain `object-fit: cover` in a box of the hero's shape (1062x311), the
  whole plate shows, so the room reads about 17 % smaller than the mockup. To
  match the mockup exactly, draw the plate at `width = box.w / 0.8323`,
  `height = box.h / 0.8316`, offset by `-0.0839 * width`, `-0.0842 * height`
  (the margin then falls outside the box).
- For narrower boxes (tablet), `frame.focus` is `[0.62, 0.5]`, so cropping
  keeps the window side.

## Overlays

- `points.character`: the bottom centre of the character slot (ref3 screen
  x 640..965). No character is drawn now, and the slot is plain wall.
  `cameras.products_hero.character.bbox` has the full box.
- `surfaces.quote`: the axis-aligned box of the handwritten quote. It sits over
  the bright window, as in ref3. Rotate the text by -10 deg inside it.





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

- `hero-mask-{plants,sky,lamps}-{2552,1276}.webp` pair with `hero-{2552,1276}.webp`; `hero-depth-1276.webp`
  (0 = 0.5 m .. 1 = 12.5 m) is new.
- **Plants**: the rubber plant and the small plant on the sideboard (`plants`), both heavily out of focus, so their
  masks are as soft as the plate.
- **Sky**: the daylight backdrop seen through the arched window. The mullions and transom are excluded, including
  their lit side faces.
- **Lamps**: the pendant globe (`motion: "breathe"`); it hangs on a cord, so a very small sway also reads.
- There is no glass (the arch is open), no LED cove and no city here, so those masks are not published.
- Regenerate: `room_products_hero.py -- --passes masks --spp 256`, then `mask_post.py publish ...` (header of
  `scripts/blender/room_products_hero.py`).

## Re-rendering

See the header of `scripts/blender/room_products_hero.py`. Renders go through
the lock wrapper (`work/evia-rebuild/tools/blender-render.sh`). The final took
about 4 minutes on the 2-core i3.
