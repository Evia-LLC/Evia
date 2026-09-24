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
