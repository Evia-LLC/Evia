import { REVIEW_VERSIONS, type ReviewSurface, type ReviewChoice } from '../../shared/legal-review.ts';

/** Guest choices are review evidence in this tab, not account consent. */
export const guestLegalReviews: Record<string, unknown>[] = [];
let guestId: string | undefined;
export async function recordLegalReview(surface: ReviewSurface, choice: ReviewChoice, accountId?: string,
  details: { action?: string; jurisdiction?: string; preferences?: Record<string, boolean>; targetId?: string } = {}) {
  const wordingVersionId = REVIEW_VERSIONS[surface];
  if (!accountId) {
    guestId ??= crypto.randomUUID();
    guestLegalReviews.push({ accountId: null, actorId: guestId, recordedAt: new Date().toISOString(),
      surface, choice, wordingVersionId, ...details, demoOnly: true, approved: false });
    return;
  }
  const response = await fetch('/api/analysis/legal-review', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surface, choice, wordingVersionId, idempotencyKey: crypto.randomUUID(), ...details }),
  });
  if (!response.ok) throw new Error(response.status === 403
    ? 'Sample review is unavailable on this server. Your choice was not recorded.'
    : 'Your review choice could not be recorded. Please try again.');
}
