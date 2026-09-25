import { LEGAL_CONTENT } from './legal-content.ts';

export const REVIEW_VERSIONS = {
  'health-consent': LEGAL_CONTENT['health-consent'].wordingVersionId,
  'safety-lifestyle-consent': LEGAL_CONTENT['safety-lifestyle-consent'].wordingVersionId,
  'progress-photo-consent': LEGAL_CONTENT['progress-photo-consent'].wordingVersionId,
  'cookie-preferences': 'cookie-pack-v1-demo-2026-09-24.1',
  'account-controls': 'account-controls-pack-v1-demo-2026-09-24.1',
  'ai-disclosure': 'ai-disclosure-pack-v1-demo-2026-09-24.1',
} as const;
export type ReviewSurface = keyof typeof REVIEW_VERSIONS;
export const REVIEW_CHOICES = ['accepted', 'declined', 'skipped', 'saved', 'viewed', 'attempted'] as const;
export type ReviewChoice = typeof REVIEW_CHOICES[number];
export const HEALTH_REGIONS = ['WA', 'NV', 'CT', 'Other', 'Unknown'] as const;
export function healthConsentApplies(region: string): boolean {
  return ['WA', 'NV', 'CT', 'Unknown'].includes(region);
}
export const REVIEW_ACTIONS = ['review', 'withdraw_scan', 'delete_photo', 'export', 'delete_account', 'marketing', 'policy_history'] as const;
