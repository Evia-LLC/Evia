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

export const PUBLISHED_ROOMS: readonly RoomId[] = [];
