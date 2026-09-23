/** Central registry for consent text. A version is immutable once released. */
export const LEGAL_CONTENT = {
  progress_photos: {
    version: 'progress-photos-v1',
    title: 'Keep progress photos',
    wording:
      'Allow encrypted progress-photo storage. This enables the feature, but no capture is saved unless you separately choose “Save this as a progress photo” after that scan.',
  },
} as const;

