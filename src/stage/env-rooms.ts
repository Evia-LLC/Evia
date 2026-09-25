/**
 * The rooms whose Blender renders are published under `public/env/<room>/`,
 * and which renders each has: `desk` is `anchors.json` (the landscape render),
 * `mobile` is `anchors-mobile.json` (the phone-portrait render).
 *
 * Room.svelte asks the server for a room's anchors only when that render is
 * listed here. A room without one then costs no request - and leaves no 404 in
 * the console on every page load - and shows its CSS stand-in at once. Add a
 * render here in the same change that publishes it
 * (`scripts/blender/*_post.py ... --publish public/env/<room>`).
 */

import type { RoomId, RoomVariant } from './room-anchors.ts';

export type PublishedRooms = Readonly<Partial<Record<RoomId, readonly RoomVariant[]>>>;

/*
 * lounge: public/env/lounge. `anchors.json` is the L1 Home plate
 * (home-{1280,1920,2560}.webp) in Room's format, with ref1's Home panel as
 * points.home_ref_tl/br and the Blender job's camera anchors under `cameras`;
 * `anchors-mobile.json` is the L2 phone-portrait plate (mobile-{720,1080}.webp).
 *
 * consult: public/env/consult, in the Blender job's own format (consult_post.py:
 * `plate`, `refFrame`, `files`), which parseAnchors reads as it is; the
 * phone-portrait set is `anchors-mobile.json` (refFrame null).
 *
 * lounge-strip-window: public/env/lounge-strip-window/anchors.json only; its
 * plates are the L3 sidebar strip in public/env/lounge (strip-window-640.webp
 * as the base, strip-window-soft-320.webp as the `blur` plate the sidebar's
 * <Room blurred> shows), referenced by absolute src.
 *
 * products-hero: public/env/products-hero (hero-{1276,2552}.webp, lossless,
 * the L5 backdrop; points.hero_ref_tl/br mark ref3's hero frame inside the
 * plate, which <Room fit="ref"> scales to the hero box).
 */
export const PUBLISHED_ROOMS: PublishedRooms = {
  lounge: ['desk', 'mobile'],
  consult: ['desk', 'mobile'],
  'lounge-strip-window': ['desk'],
  'products-hero': ['desk'],
};
