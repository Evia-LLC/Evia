import * as users from '../db/users.ts';
import * as scans from '../db/scans.ts';
import * as bodyScans from '../db/body-scans.ts';
import * as chat from '../db/chat.ts';
import * as products from '../db/products.ts';
import type { Product } from '../../shared/types.ts';
import * as consents from '../db/consents.ts';
import * as progressPhotos from '../db/progress-photos.ts';

export const DATA_EXPORT_VERSION = '1.1';

export interface DataExportRepositories {
  account: typeof users.getUserSummary;
  consentHistory: typeof consents.consentHistory;
  skinScans: typeof scans.exportScans;
  progressPhotos: typeof progressPhotos.listProgressPhotos;
  bodyScans: typeof bodyScans.exportBodyScans;
  routine: typeof products.listUsage;
  ownedProducts?: (userId: string) => Promise<Product[]>;
  memories: typeof chat.exportMemories;
  transcripts: typeof chat.exportTranscripts;
}

const repositories: DataExportRepositories = {
  account: users.getUserSummary,
  consentHistory: consents.consentHistory,
  skinScans: scans.exportScans,
  progressPhotos: progressPhotos.listProgressPhotos,
  bodyScans: bodyScans.exportBodyScans,
  routine: products.listUsage,
  ownedProducts: products.listOwnedProducts,
  memories: chat.exportMemories,
  transcripts: chat.exportTranscripts,
};

/**
 * Builds the portable JSON document exclusively through domain repositories.
 * Photo binaries are intentionally excluded; a future binary export must be a
 * streamed archive, never base64 folded into this document.
 */
export async function assembleDataExport(userId: string, repos: DataExportRepositories = repositories) {
  const [account, consentHistory, skin, photos, body, routine, memories, transcripts] = await Promise.all([
    repos.account(userId),
    repos.consentHistory(userId),
    repos.skinScans(userId),
    repos.progressPhotos(userId),
    repos.bodyScans(userId),
    repos.routine(userId),
    repos.memories(userId),
    repos.transcripts(userId),
  ]);
  // Owned (private) products only — scoped to the caller by the repository,
  // so no other user's rows can appear here. Optional so older injected
  // repository sets keep compiling; the default set always includes it.
  const ownedProducts = repos.ownedProducts ? await repos.ownedProducts(userId) : [];
  if (!account) throw new Error('Cannot export a missing account.');

  return {
    metadata: {
      format: 'elohim-user-data',
      version: DATA_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      photoBinariesIncluded: false,
    },
    account: {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      createdAt: account.createdAt,
      dateOfBirth: account.dateOfBirth ?? null,
      profile: account.profile,
    },
    preferences: account.preferences,
    consentHistory,
    scans: { skin, body, progressPhotos: photos },
    routine: { products: routine, ownedProducts },
    memories,
    transcripts,
  };
}
