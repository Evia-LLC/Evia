export interface LegalContentEntry {
  id: string;
  text: string;
  placeholder: boolean;
}

// These IDs intentionally cannot be mistaken for a future approved version.
// Processor propagation, backup handling, and final legal wording are open.
export const DATA_EXPORT_NOTICE_PLACEHOLDER: LegalContentEntry = {
  id: 'data-export-notice-placeholder-v0',
  placeholder: true,
  text: 'Your download contains the account data currently held by Elohim. Stored photo files are not included in this JSON export.',
};

export const ACCOUNT_DELETION_NOTICE_PLACEHOLDER: LegalContentEntry = {
  id: 'account-deletion-notice-placeholder-v0',
  placeholder: true,
  text: 'Deleting your account removes its active records and shreds discoverable encrypted image blobs. Processor propagation, backup handling, and final wording remain unresolved.',
};
