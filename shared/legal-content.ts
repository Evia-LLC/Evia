/**
 * Versioned legal copy. Copy is data, rather than component markup, so the
 * exact text displayed is the exact text tied to a recorded decision.
 *
 * PLACEHOLDER means precisely that: draft copy for product review. It has not
 * been approved by counsel and must never satisfy a production legal gate.
 */
export type LegalContentId =
  | 'terms'
  | 'privacy-policy'
  | 'facial-scan-consent'
  | 'health-consent'
  | 'safety-lifestyle-consent'
  | 'progress-photo-consent'
  | 'subscription-disclosure'
  | 'cancellation';

export type LegalStatus = 'placeholder' | 'approved';
export type ConsentRequirement = 'required' | 'optional' | 'informational';

export interface LegalContentRecord {
  /** Stable across every revision of the same legal surface. */
  id: LegalContentId;
  /** Immutable identifier for this exact title/body/action-label set. */
  wordingVersionId: string;
  title: string;
  body: readonly string[];
  acceptLabel?: string;
  declineLabel?: string;
  skipLabel?: string;
  status: LegalStatus;
  effectiveDate: string | null;
  effectiveDateLabel: string;
  applicability: {
    jurisdictions: readonly string[];
    audience: string;
    requirement: ConsentRequirement;
  };
}

const placeholder = (
  record: Omit<LegalContentRecord, 'status' | 'effectiveDate' | 'effectiveDateLabel'>,
): LegalContentRecord => ({
  ...record,
  status: 'placeholder',
  effectiveDate: null,
  effectiveDateLabel: 'Not yet effective',
});

export const LEGAL_CONTENT: Readonly<Record<LegalContentId, LegalContentRecord>> = {
  terms: placeholder({
    id: 'terms', wordingVersionId: 'terms-draft-2026-09-23.1', title: 'Terms of Use',
    body: ['Draft terms are being prepared for review.', 'Do not rely on this placeholder as a final agreement.'],
    applicability: { jurisdictions: ['TBD'], audience: 'All account holders', requirement: 'informational' },
  }),
  'privacy-policy': placeholder({
    id: 'privacy-policy', wordingVersionId: 'privacy-draft-2026-09-23.1', title: 'Privacy Policy',
    body: ['Draft privacy disclosures are being prepared for review.', 'This placeholder does not describe a final data-processing policy.'],
    applicability: { jurisdictions: ['TBD'], audience: 'All visitors and account holders', requirement: 'informational' },
  }),
  'facial-scan-consent': placeholder({
    id: 'facial-scan-consent', wordingVersionId: 'facial-scan-draft-2026-09-23.1', title: 'Facial Scan Consent',
    body: ['Draft consent language for facial scan processing will appear here.', 'No production facial-scan gate may be satisfied with this draft.'],
    acceptLabel: 'Accept facial scan consent', declineLabel: 'Decline facial scan consent',
    applicability: { jurisdictions: ['TBD'], audience: 'People choosing facial scan features', requirement: 'required' },
  }),
  'health-consent': placeholder({
    id: 'health-consent', wordingVersionId: 'health-draft-2026-09-23.1', title: 'Health Information Consent',
    body: ['Draft consent language for health information will appear here.', 'This review screen does not collect health information.'],
    acceptLabel: 'Accept health consent', declineLabel: 'Decline health consent',
    applicability: { jurisdictions: ['TBD'], audience: 'People choosing health-related features', requirement: 'required' },
  }),
  'safety-lifestyle-consent': placeholder({
    id: 'safety-lifestyle-consent', wordingVersionId: 'safety-lifestyle-draft-2026-09-23.1', title: 'Safety and Lifestyle Consent',
    body: ['Draft optional consent language for safety and lifestyle information will appear here.', 'You may skip this optional decision.'],
    acceptLabel: 'Accept optional consent', declineLabel: 'Decline optional consent', skipLabel: 'Skip for now',
    applicability: { jurisdictions: ['TBD'], audience: 'People offered optional personalization', requirement: 'optional' },
  }),
  'progress-photo-consent': placeholder({
    id: 'progress-photo-consent', wordingVersionId: 'progress-photo-draft-2026-09-23.1', title: 'Progress Photo Consent',
    body: ['Draft consent language for retaining progress photos will appear here.', 'Choosing not to accept must not be treated as acceptance.'],
    acceptLabel: 'Accept progress photo consent', declineLabel: 'Decline progress photo consent', skipLabel: 'Skip for now',
    applicability: { jurisdictions: ['TBD'], audience: 'People choosing progress photos', requirement: 'optional' },
  }),
  'subscription-disclosure': placeholder({
    id: 'subscription-disclosure', wordingVersionId: 'subscription-draft-2026-09-23.1', title: 'Subscription Disclosure',
    body: ['Draft subscription disclosures are being prepared for review.', 'No plan, price, checkout, renewal, or subscription is offered on this page.'],
    applicability: { jurisdictions: ['TBD'], audience: 'Future subscription customers', requirement: 'informational' },
  }),
  cancellation: placeholder({
    id: 'cancellation', wordingVersionId: 'cancellation-draft-2026-09-23.1', title: 'Cancellation',
    body: ['Draft cancellation information is being prepared for review.', 'This review page cannot cancel or change a subscription.'],
    applicability: { jurisdictions: ['TBD'], audience: 'Future subscription customers', requirement: 'informational' },
  }),
};

/** Explicit release manifests prevent a new page silently becoming a gate. */
export const LEGAL_RELEASE_REQUIREMENTS = {
  public_web: ['terms', 'privacy-policy'],
  consent_flow: ['terms', 'privacy-policy', 'facial-scan-consent', 'health-consent', 'safety-lifestyle-consent', 'progress-photo-consent'],
  subscriptions: ['terms', 'privacy-policy', 'subscription-disclosure', 'cancellation'],
} as const satisfies Record<string, readonly LegalContentId[]>;

export function unresolvedLegalContent(ids: readonly LegalContentId[]): LegalContentId[] {
  return ids.filter((id) => LEGAL_CONTENT[id].status !== 'approved');
}
