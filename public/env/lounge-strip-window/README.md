# lounge-strip-window (sidebar backdrop, L3)

This folder holds only `anchors.json`, in Room.svelte's format for room id
`lounge-strip-window`. The pictures are in `../lounge/`, referenced by absolute
src:

- `base`: `/env/lounge/strip-window-640.webp`, the clean 640x2048 strip (ref2's
  320x1024 sidebar at 2x).
- `blur`: `/env/lounge/strip-window-soft-320.webp`, a lightly softened copy.
  This is what the sidebar's `<Room blurred>` shows.

The dark rose-brown glass is CSS (`--sidebar-glass` + `--sidebar-insurance`).
The strip has no overlays. See `../lounge/README.md` for how it was made and
tuned.

## Living-room masks

`anchors.json` also lists the strip's living-room masks (`masks`, `lights`, `strips`, `plants`): data maps for
animating the strip (plants swaying, lit windows twinkling, the soffit cove and plinth LEDs breathing), rendered
from the same camera. The files are in `../lounge/` (`strip-window-mask-*-{640,320}.webp`,
`strip-window-depth-320.webp`), referenced by absolute src, with the new breathing layers
`strip-window-{dim,glow}-{640,320}.webp` (listed as `masks.glow` / `masks.dim`; pictures, not data maps). The 320
masks fit the soft plate too. Channel layout and suggested use: `../lounge/README.md`, section "Living-room masks".
