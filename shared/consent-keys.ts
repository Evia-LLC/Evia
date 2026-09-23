/** Application-known consent identifiers. Storage intentionally accepts any string. */
export const CONSENT_KEYS = {
  IMAGE_STORAGE: 'image_storage',
  CLOUD_REASONING: 'cloud_reasoning',
  PROGRESS_PHOTOS: 'progress_photos',
} as const;

export type WellKnownConsentType = (typeof CONSENT_KEYS)[keyof typeof CONSENT_KEYS];

