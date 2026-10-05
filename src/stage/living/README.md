# src/stage/living: the rooms, alive

The room plates are still Blender renders. This folder gives them a little life - a luxury hotel at dusk,
not a video game - from the data maps each render publishes beside its plate (`masks`, `lights`, `strips`,
`plants` in `public/env/<room>/anchors*.json`; channel layout in the room READMEs, "Living-room masks").

| what | how | where it shows |
|---|---|---|
| Candle-lit globe | layered slow noise (0.3 / 0.53 / 0.95 Hz: a shift every 2-4 s) + a rare draught sag, within +-3 % (home.md s9), slew-limited | lounge (Home, gate, phone) |
| Globe lamps, pendant | smoother slow noise (0.4 / 0.66 Hz), within +-3 %, every 2-4 s | lounge, sidebar strip, Products hero |
| LED coves | the glow layer (plate - dim) breathes: emission 0.9 <-> 1.0 over 7 s (home.md s9), and a faint bead (8 % of the LEDs' light) travels along each strip at 0.3 m/s (a whole number of beads on closed rings) | lounge, strip |
| Consult LEDs | the neon, under-glow and emitter boost layers breathe +-5 % of their light over 8 s (scan.md s9; each layer's boost strength divided out), with a 5 % bead on the neon | Scan |
| Consult glass rings | three soft glints turn round the emitter rim and the inlaid glass rings, one turn in 45 s; nothing pulses (the hologram above has its own 3 s pulse) | Scan |
| Plants, trees | the sampling point follows a smooth wind field (two travelling waves + noise + a gust front crossing the room every ~30 s) weighted by the sway mask (0 at the pot, 1 at the tips, feathered past the silhouette); amplitude 0.55-0.6 of the mask's `featherPx`, so edges never tear | every room |
| City windows | a lit window id goes dark for 3-15 s now and then (fades 0.45 s): 3 % of the ids a minute in the lounge, 4 % in the consult room ("a few % per minute"); distant lights shimmer | lounge, strip, consult |
| Sky | dusk: thin cloud bands drifting; night: haze wisps over the glass; day: light swelling as high cloud passes | lounge + strip / consult / Products |
| Aircraft | a red anti-collision beacon (0.74 Hz) and a faint white light crossing the open sky (2 min, every ~3.5 min), hidden by anything that is not sky | lounge, strip, consult |
| Traffic | none, on purpose: no camera sees street level (the lounge skyline stops at the window's bottom rail, the consult city behind the tier wall), so car-light streaks would have to run over buildings | - |
| Parallax | pointer (desktop) or tilt (phone): `depth` shifts every pixel by the depth map (the nearest 2.75 px, the far side the other way, so layers part by 4 px at most: home.md s9 "2-4 px") and RoomSurface text moves with its wall; `glass` (consult) shifts only the view outside, so the hologram, character and wall text the Scan page places stay put | lounge, Products (depth), consult (glass) |

Files:

- `envelope.ts` - every motion as a pure function of time (tested: `test/living-envelope.test.ts`, bounds,
  per-frame change, WCAG 2.3.1 flash counts).
- `schedule.ts` - fps (30 on phones / low power, else 60; the ambient motion at the room's own rate, 30 or 15
  for the sidebar strip), DPR and pixel caps (1.0 on low-power desktops; never above the plate's own density),
  the idle slow-down (12 fps after 2 min without input) and stop (after 10 min; the next input resumes it),
  still / paused / live, the room clock (live time only; effects ease in over 2.5 s).
- `scene.ts` - the plan for a room: textures and widths (masks at their smallest published width), features,
  the aircraft lane (read from the sky mask), the depth under a wall's text.
- `tuning.ts` - how alive each room is (one place to turn a room up or down).
- `shader.ts` - the fragment shader, compiled per room with only the features it has.
- `input.ts` - pointer and tilt, shared by every room. Tilt never raises a permission prompt by itself: on iOS
  it starts only from Profile's "Tilt the room" switch (`requestTilt()` inside the tap; a refusal is not asked
  again this visit and the room simply keeps still); elsewhere it starts on the first touch, and the same
  switch turns it off (`stopTilt()`; the switch rests, with a note, under reduced motion - the app's or the
  system's - and after a refusal). A grant outlives the rooms mounting and unmounting. Tilt is read in screen
  terms (`screen.orientation.angle`, iOS `window.orientation`), so both landscapes move the room the right way
  (`test/living-input.test.ts`).
- `controller.ts` - `mountLiving()`: the WebGL2 canvas, loading, the shared animation loop, visibility,
  reduced motion, context loss. Loaded with a dynamic import by `Room.svelte` once the plate is on screen.

Rules it keeps:

- Reduced motion (system or the app's `data-reduced-motion`) = the plate exactly as rendered; nothing loads.
- Paused while the tab is hidden or the room is off screen; the clock stands still, so it resumes without a jump.
  The pointer/tilt listeners are held only while a room is live.
- Drawn only when due: a scroll or resize that moves nothing draws nothing (rooms that fit their clips are not
  even measured on scroll); a change of size draws at once. Clips are watched (ResizeObserver, transitions) and
  re-measured once a second while live, so a clip that moved without an event never leaves a stale canvas.
- No wrap shows: the noise lattices repeat every 256 cells and every drift is wrapped there; the twinkle's
  slots and the shimmer's cycles repeat on the shader clock's 2 h wrap. The dither pattern is fixed.
- The first frame is the plate exactly and every effect eases in, so the canvas fades in over the picture
  without a seam; the `<img>` stays under it (no layout shift, instant fallback).
- Without WebGL2 (or while a context is lost) Room shows the CSS fallback: the glow layer breathing over the
  plate (`plus-lighter`, about a tenth of the LEDs' light over 8 s) and warm halos at the lamps. A context the
  browser restores (`webglcontextrestored`) brings the room back to life.
- Data saver on: no masks are fetched.

Development: `window.__eviaLiving` (dev builds only) - `at(seconds)` freezes every room at a moment (frame
captures), `pointer(x, y)` fakes the viewer, `quiet(true)` draws every effect at zero (check the canvas against
the picture), `bench(n)` times n frames, `rooms()` lists them.
