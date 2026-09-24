/**
 * Which lines the conversation shows.
 *
 * Normally all of them: the account's stored history and this visit's lines.
 * Sample mode is the exception. An account can turn sample mode on, and the
 * pages then show the designed sample (Home greets "Destiny"), so the chat
 * beside them must not show that account's own transcript - that would put
 * two people on one screen. While it is on, only the lines said since it came
 * on are shown; the controller keeps those local (controller.ts `localOnly`),
 * so nothing shown there came from, or goes to, the account's history. The
 * stored history is still in the session, untouched, and comes back when
 * sample mode goes off.
 *
 * A guest has no stored history, so there is nothing to hide.
 */
import type { ChatMessage } from '@shared/types.ts';

export interface TranscriptScope {
  sampleOn: boolean;
  guest: boolean;
  /** When sample mode came on (ms since the epoch). */
  sampleSince: number;
}

export function visibleMessages(messages: readonly ChatMessage[], scope: TranscriptScope): readonly ChatMessage[] {
  if (!scope.sampleOn || scope.guest) return messages;
  return messages.filter((m) => {
    const at = Date.parse(m.createdAt);
    return Number.isFinite(at) && at >= scope.sampleSince;
  });
}
