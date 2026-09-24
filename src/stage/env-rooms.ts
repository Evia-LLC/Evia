/**
 * The rooms whose Blender renders are published under `public/env/<room>/`.
 *
 * Room.svelte asks the server for a room's `anchors.json` only when the room is
 * listed here. A room without a render then costs no request - and leaves no
 * 404 in the console on every page load - and shows its CSS stand-in at once.
 * Add a room's id here in the same change that publishes its render
 * (`scripts/blender/*_post.py ... --publish public/env/<room>`).
 */

import type { RoomId } from './room-anchors.ts';

/*
 * lounge: public/env/lounge (home-2560.webp, the Blender job's final Home
 * plate). Its anchors.json is in Room's format, with the Blender job's own
 * camera anchors kept alongside under `cameras`.
 *
 * lounge-strip-window: public/env/lounge-strip-window/anchors.json only; its
 * plates are the L3 sidebar strip in public/env/lounge (strip-window-640.webp
 * as the base, strip-window-soft-320.webp as the `blur` plate the sidebar's
 * <Room blurred> shows), referenced by absolute src.
 *
 * products-hero: public/env/products-hero (hero-2552.webp, lossless, the L5
 * backdrop; points.hero_ref_tl/br mark ref3's hero frame inside the plate).
 */
export const PUBLISHED_ROOMS: readonly RoomId[] = ['lounge', 'lounge-strip-window', 'products-hero'];
