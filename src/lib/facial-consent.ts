import { LEGAL_CONTENT } from '../../shared/legal-content.ts';

/** Guest demo evidence is intentionally memory-only; it cannot grant account consent. */
export const guestFacialDecisions: Array<{ actorId: string; recordedAt: string; wordingVersionId: string; choice: string }> = [];
let guestId: string | undefined;
export async function recordFacialChoice(choice: 'accepted' | 'declined', accountId?: string): Promise<void> {
  const wordingVersionId = LEGAL_CONTENT['facial-scan-consent'].wordingVersionId;
  if (!accountId) {
    guestId ??= `guest-${crypto.randomUUID()}`;
    guestFacialDecisions.push({ actorId: guestId, recordedAt: new Date().toISOString(), wordingVersionId, choice });
    return;
  }
  const response = await fetch('/api/analysis/consent', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice, wordingVersionId, idempotencyKey: crypto.randomUUID() }),
  });
  if (!response.ok) {
    throw new Error(response.status === 403 ? 'This wording is awaiting approval. The server must enable the sample-data demo before continuing.' : 'Your choice could not be saved. Please try again.');
  }
}
