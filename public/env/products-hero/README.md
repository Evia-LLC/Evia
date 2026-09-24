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

## Re-rendering

See the header of `scripts/blender/room_products_hero.py`. Renders go through
the lock wrapper (`work/evia-rebuild/tools/blender-render.sh`). The final took
about 4 minutes on the 2-core i3.
