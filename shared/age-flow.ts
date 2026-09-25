import { LEGAL_CONTENT } from './legal-content.ts';
/** Verbatim guide §5–7. Sample-only review; no wording approval is implied. */
export const AGE_FLOW_VERSION = 'age-guardian-pack-v1-demo-2026-09-24.1';
export const REGISTRATION_TERMS_VERSION = 'registration-terms-pack-v1-demo-2026-09-24.1';
export const AGE_FLOW_COPY = {
  "fields": "email, password or Google or Apple sign-in, date of birth",
  "eligibility": "Evia is for people aged 16 and over.",
  "under16": "Sorry, Evia is only available to people aged 16 and over.",
  "debitNotice": "One more quick check. Because your card could belong to someone under 18, we need to confirm your age before you can scan. This uses your email address, not your face.",
  "guardianHeading": "We need a parent or guardian to approve this.",
  "guardianBody": "Because you are under 18, a parent or legal guardian has to confirm who they are and agree before you can use the camera. Enter their email address and we will send them the details. Your account will be deleted if they have not approved it within 14 days.",
  "emailSubject": "Your approval is needed for Evia.",
  "emailBody": "[User's first name] has asked to use Evia, an AI skincare app that scans the face to analyse skin and suggest routines and products. Because they are under 18, Evia needs a parent or legal guardian to confirm who they are and approve before any scan. Evia is a wellness app, not a medical service. We never sell your child's data, never use it for advertising and never use their face to identify them.",
  "reviewButton": "Review and approve.",
  "emailExpiry": "This link expires in 72 hours. If you did not expect this email, you can ignore it and the account will be deleted.",
  "guardianNameLabel": "Guardian full name",
  "relationship": "I confirm I am the parent or legal guardian of this user.",
  "guardianTerms": "I accept the Terms of Service on my own behalf and on behalf of this user.",
  "minorProtection": "Accounts of users under 18 are never used for advertising, never included in marketing audiences and never sent marketing messages.",
  "approve": "Approve.",
  "recordFields": "user account ID, Guardian name+email, relationship declaration, verification method+result, card type, last4, fingerprint token, Illinois ID result where applicable, wording version of every doc shown, date, time, IP address.",
  "unlock": "Your parent or guardian has approved your account. You can now scan. They can see the data stored in your account and can delete your account at any time. You can also contact privacy@meetevia.com about your data.",
  "domainNote": "@helloevia.com",
  "controls": "view stored data, download it, withdraw consent, delete account, manage subscription.",
  "turning18": "You are now 18. To keep using Evia, please accept the Terms and give your scan consent in your own name. The camera stays locked until they do.",
  "terms": "I have read and agree to the Terms of Service, and I have read the Privacy Policy, the Health, Wellness and AI Disclaimer and the Cookie Policy.",
  "checkout": "You are subscribing to Evia. 20.99 US dollars for the first month, then 40 US dollars per month until you cancel. Charged to your payment method each month. Cancel any time in Settings or through the Stripe customer portal.",
  "withdrawal": "I ask Evia to start the service immediately, and I understand that I lose my 14-day right of withdrawal once the service has been fully performed.",
  "subscribe": "Subscribe and pay 20.99 US dollars",
  "guardianCheckout": "You are subscribing on behalf of [user's first name]."
} as const;

/** Calendar DOB validation; never infer age from a photograph. */
export function ageOnDate(dob: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [year, month, day] = dob.split('-').map(Number);
  const date = new Date(`${dob}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || date > now) return null;
  const birthdayPending = now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  return now.getUTCFullYear() - year - Number(birthdayPending);
}

export type FundingType = 'credit' | 'debit' | 'prepaid';
export function adultCardBranch(type: FundingType): 'scan-consent' | 'email-age-check' {
  return type === 'credit' ? 'scan-consent' : 'email-age-check';
}

/** Preview records deliberately cannot grant account/camera access. */
export function guardianReviewRecord(input: {
  accountId: string | null; guardianName: string; guardianEmail: string;
  relationship: boolean; cardType: FundingType; illinois: boolean;
  wordingVersions: Record<string, string>; ipAddress?: string | null;
}) {
  const timestamp = new Date().toISOString();
  return { ...input, verificationMethod: 'unavailable', verificationResult: 'not_verified',
    last4: null, fingerprintToken: null, illinoisIdResult: input.illinois ? 'not_verified' : 'not_applicable',
    date: timestamp.slice(0, 10), time: timestamp.slice(11), timestamp,
    ipAddress: input.ipAddress ?? null, approved: false, cameraUnlocked: false, demoOnly: true } as const;
}

/** Full notice documents are not published yet; record this without invented approvals. */
export const REGISTRATION_DOCUMENT_VERSIONS = {
  terms: LEGAL_CONTENT.terms.wordingVersionId,
  privacy: LEGAL_CONTENT['privacy-policy'].wordingVersionId,
  disclaimer: 'publication-pending-health-wellness-ai-disclaimer',
  cookies: 'publication-pending-cookie-policy',
  registration: REGISTRATION_TERMS_VERSION,
  facial: LEGAL_CONTENT['facial-scan-consent'].wordingVersionId,
  ageFlow: AGE_FLOW_VERSION,
};

export const AGE_REVIEW_ACTIONS = ['registration_terms_review', 'adult_scan', 'withdrawal_rights', 'adult_card', 'age_check', 'guardian_invite', 'guardian_relationship', 'guardian_verification', 'guardian_terms', 'guardian_scan', 'guardian_approve', 'guardian_control', 'turning18_terms', 'turning18_scan', 'subscription_attempt'] as const;
