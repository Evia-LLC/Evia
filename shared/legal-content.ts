import { CONSENT_KEYS } from './consent-keys.ts';

export type LegalContentStatus = 'placeholder' | 'approved';

export interface ConsentWordingVersion {
  id: string;
  consentType: string;
  status: LegalContentStatus;
  effectiveDate: string;
  text: string;
}

/**
 * Versioned, exact consent copy. IDs are permanent once used by a decision.
 * `legacy-v1` is migration-only and cannot be submitted through the API.
 */
export const CONSENT_WORDING_VERSIONS = [
  {
    id: 'image-storage-v1',
    consentType: CONSENT_KEYS.IMAGE_STORAGE,
    status: 'approved',
    effectiveDate: '2026-09-23',
    text: 'Keep my scan photos, encrypted, so I can look back at them.',
  },
  {
    id: 'cloud-reasoning-v1',
    consentType: CONSENT_KEYS.CLOUD_REASONING,
    status: 'approved',
    effectiveDate: '2026-09-23',
    text: 'Send my messages, profile, memories, scan history, and optional captures to cloud providers for reasoning, vision, and voice.',
  },
  {
    id: 'progress-photos-v1',
    consentType: CONSENT_KEYS.PROGRESS_PHOTOS,
    status: 'placeholder',
    effectiveDate: '2026-09-23',
    text: 'Keep progress photos for comparison over time.',
  },
] as const satisfies readonly ConsentWordingVersion[];

export function consentWordingVersion(id: string): ConsentWordingVersion | undefined {
  return CONSENT_WORDING_VERSIONS.find((version) => version.id === id);
}

/** Central registry for consent text. A version is immutable once released. */
export const LEGAL_CONTENT = {
  progress_photos: {
    version: 'progress-photos-v1',
    title: 'Keep progress photos',
    wording:
      'Allow encrypted progress-photo storage. This enables the feature, but no capture is saved unless you separately choose “Save this as a progress photo” after that scan.',
  },
} as const;
