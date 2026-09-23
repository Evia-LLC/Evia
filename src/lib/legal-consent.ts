import type { LegalContentId } from '../../shared/legal-content.ts';

export type LegalDecision = 'accepted' | 'declined' | 'skipped';

/** The immutable wording version, not merely the surface name, is recorded. */
export async function submitLegalDecision(contentId: LegalContentId, decision: LegalDecision, wordingVersionId: string): Promise<void> {
  const response = await fetch('/api/legal/consents', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentId, wordingVersionId, decision }),
  });
  if (!response.ok) throw new Error('The legal decision could not be saved.');
}
