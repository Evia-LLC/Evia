import { HEALTH_COPY, SAFETY_COPY, PHOTO_COPY } from './legal-screen-copy.ts';
import { CONSENT_KEYS } from './consent-keys.ts';
import type { ConsentSummary } from './types.ts';

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
  checkbox?: string;
  footer?: string;
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
    id: 'facial-scan-consent', wordingVersionId: 'facial-scan-pack-v1-demo-2026-09-24.1',
    title: "Before your first scan",
    body: [
      "To analyse your skin, Evia uses your camera to capture images of your face and creates facial landmark data from them. This is biometric and health-related data, so we need your permission first.",
      "What we collect: images of your face captured during the scan, facial landmark data derived from them, and the analysis results.",
      "What we use it for: analysing your skin, showing you the holographic visualisation, and personalising your routine and product suggestions.",
      "Who processes it: Evia and our facial analysis provider. Your facial photographs are not sent to our conversational AI providers.",
      "How long we keep it: your scan images and landmark data are deleted after your analysis and consultation session, and in any event within 24 hours. Your analysis results stay in your account so your skin history works, until you delete them or your account.",
      "What we never do: we never use your face to identify you, never infer your race, ethnicity, age or gender from it, and never sell or share it with brands or advertisers."
    ],
    acceptLabel: 'Agree and continue', declineLabel: 'Not now',
    applicability: { jurisdictions: ['All'], audience: 'People choosing facial scan features', requirement: 'required' },
  }),
  'health-consent': placeholder({
    id: 'health-consent', wordingVersionId: 'health-consent-pack-v1-demo-2026-09-24.1', title: HEALTH_COPY.title,
    body: [HEALTH_COPY.body], checkbox: HEALTH_COPY.checkbox,
    footer: HEALTH_COPY.footer,
    acceptLabel: 'Agree and continue', declineLabel: 'Not now',
    applicability: { jurisdictions: ['WA', 'NV', 'CT'], audience: 'Sample-data consent review', requirement: 'required' },
  }),
  'safety-lifestyle-consent': placeholder({
    id: 'safety-lifestyle-consent', wordingVersionId: 'safety-lifestyle-consent-pack-v1-demo-2026-09-24.1', title: SAFETY_COPY.title,
    body: [SAFETY_COPY.body], checkbox: SAFETY_COPY.checkbox,

    acceptLabel: 'Agree and continue', declineLabel: 'Not now', skipLabel: SAFETY_COPY.skip,
    applicability: { jurisdictions: ['All'], audience: 'Sample-data consent review', requirement: 'optional' },
  }),
  'progress-photo-consent': placeholder({
    id: 'progress-photo-consent', wordingVersionId: 'progress-photo-consent-pack-v1-demo-2026-09-24.1', title: PHOTO_COPY.title,
    body: [PHOTO_COPY.body], checkbox: PHOTO_COPY.checkbox,

    acceptLabel: 'Agree and continue', declineLabel: 'Not now',
    applicability: { jurisdictions: ['All'], audience: 'Sample-data consent review', requirement: 'optional' },
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

export interface ConsentWordingVersion {
  id: string;
  consentType: string;
  status: LegalStatus;
  effectiveDate: string | null;
  text: string;
}

/** Verbatim Consent Wording Pack §1; demo review does not imply counsel approval. */
export const FACIAL_SCAN_COPY = {
  "checkbox": "I have read the Biometric Data Policy and I give Evia my consent to capture and process my facial images and facial landmark data for skin analysis as described.",
  "guardianCheckbox": "I am the parent or legal guardian of this user and, as their legally authorised representative, I give Evia my consent to capture and process their facial images and facial landmark data for skin analysis as described.",
  "footer": "You can withdraw this consent at any time in Settings, and we will delete the related data.",
  "links": [
    "Biometric Data Policy",
    "Privacy Policy",
    "Consumer Health Data Privacy Policy"
  ]
} as const;

/** Versions used by the consent event API; draft text cannot authorize a grant. */
export const CONSENT_WORDING_VERSIONS: readonly ConsentWordingVersion[] = [
  {
    id: LEGAL_CONTENT['facial-scan-consent'].wordingVersionId,
    consentType: CONSENT_KEYS.FACIAL_SCAN,
    status: LEGAL_CONTENT['facial-scan-consent'].status,
    effectiveDate: null,
    text: [LEGAL_CONTENT['facial-scan-consent'].title, ...LEGAL_CONTENT['facial-scan-consent'].body, FACIAL_SCAN_COPY.checkbox, FACIAL_SCAN_COPY.guardianCheckbox, 'Agree and continue', 'Not now', FACIAL_SCAN_COPY.links.join(' | '), FACIAL_SCAN_COPY.footer].join('\n'),
  },
  {
    id: 'image-storage-v1',
    consentType: CONSENT_KEYS.IMAGE_STORAGE,
    status: 'placeholder',
    effectiveDate: null,
    text: 'Draft image storage wording awaiting legal review.',
  },
  {
    id: 'cloud-reasoning-v1',
    consentType: CONSENT_KEYS.CLOUD_REASONING,
    status: 'placeholder',
    effectiveDate: null,
    text: 'Draft cloud reasoning wording awaiting legal review.',
  },
  {
    id: LEGAL_CONTENT['progress-photo-consent'].wordingVersionId,
    consentType: CONSENT_KEYS.PROGRESS_PHOTOS,
    status: LEGAL_CONTENT['progress-photo-consent'].status,
    effectiveDate: LEGAL_CONTENT['progress-photo-consent'].effectiveDate,
    text: [LEGAL_CONTENT['progress-photo-consent'].title, ...LEGAL_CONTENT['progress-photo-consent'].body, PHOTO_COPY.checkbox].join('\n'),
  },
];

export function consentWordingVersion(id: string): ConsentWordingVersion | undefined {
  return CONSENT_WORDING_VERSIONS.find((version) => version.id === id);
}

export function approvedConsent(consent: ConsentSummary | null | undefined): boolean {
  return consent?.state === 'granted' && consentWordingVersion(consent.wordingVersionId)?.status === 'approved';
}
