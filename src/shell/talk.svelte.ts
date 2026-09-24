/**
 * "Talk to Evia" from anywhere.
 *
 * The sidebar's Talk card and the rail's chat button live in the shell, but
 * the conversation opens on Home (the chat drawer is Home's). Asking for it
 * goes home and leaves a request here; whatever owns the drawer takes it:
 *
 *   $effect(() => { if (talk.pending && takeTalkRequest()) openDrawer(); });
 *
 * A request survives the navigation because it is state, not an event, so it
 * does not matter whether Home mounts before or after it is made.
 */

import { router } from '@/router/router.svelte.ts';

export const talk = $state({ pending: false, seq: 0 });

export function requestTalk(): void {
  talk.pending = true;
  talk.seq += 1;
  router.go('/');
}

/** Clears the request; true if there was one to take. */
export function takeTalkRequest(): boolean {
  const had = talk.pending;
  talk.pending = false;
  return had;
}
