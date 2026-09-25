import { session } from '@/state/session.svelte.ts';
import { sample } from '@/sample/mode.svelte.ts';

/**
 * The account a legal review or consent choice is recorded against.
 *
 * None for a guest (main's rule: guest evidence stays in the tab), and none
 * while sample data is on either: sample mode never writes to the server
 * (BUILD-PLAN 3.1), so a signed-in account that has set itself aside for the
 * sample records its choices the way a guest does, in this tab only.
 */
export function reviewAccountId(): string | undefined {
  return session.guest || sample.on ? undefined : session.user?.id;
}
