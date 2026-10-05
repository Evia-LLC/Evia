import * as users from '../db/users.ts';
import * as products from '../db/products.ts';
import * as scans from '../db/scans.ts';
import * as bodyScans from '../db/body-scans.ts';
import * as progressPhotos from '../db/progress-photos.ts';
import { shredBlob } from '../lib/crypto.ts';
import { log } from '../lib/log.ts';
import { transaction } from '../db/index.ts';

export interface DeleteAccountResult {
  ok: true;
  blobsShredded: number;
  blobsFailed: number;
}

export interface DeleteAccountDependencies {
  skinBlobRefs: (userId: string) => Promise<string[]>;
  bodyBlobRefs: (userId: string) => Promise<string[]>;
  progressPhotoRefs: (userId: string) => Promise<string[]>;
  shred: (ref: string) => Promise<void>;
  deleteOwnedProducts?: (userId: string) => Promise<number>;
  deleteUser: (userId: string) => Promise<void>;
}

const defaults: DeleteAccountDependencies = {
  skinBlobRefs: scans.allBlobRefs,
  bodyBlobRefs: bodyScans.allBodyBlobRefs,
  progressPhotoRefs: progressPhotos.allProgressPhotoRefs,
  shred: shredBlob,
  deleteOwnedProducts: products.deleteOwnedProducts,
  deleteUser: users.deleteUser,
};

/** Shreds every discoverable blob, then relies on the user FK cascades. */
export async function deleteAccount(
  userId: string,
  dependencies: DeleteAccountDependencies = defaults,
): Promise<DeleteAccountResult> {
  // The production path keeps discovery rows and encrypted blobs in one
  // Postgres transaction.  The injected path below remains intentionally
  // compatible with service-level tests and callers that provide storage
  // adapters.
  if (dependencies === defaults) return deleteAccountAtomically(userId);
  const refs = [
    ...(await dependencies.skinBlobRefs(userId)),
    ...(await dependencies.bodyBlobRefs(userId)),
    ...(await dependencies.progressPhotoRefs(userId)),
  ];
  let blobsShredded = 0;
  let blobsFailed = 0;
  for (const ref of refs) {
    try {
      await dependencies.shred(ref);
      blobsShredded += 1;
    } catch (err) {
      blobsFailed += 1;
      log.error('privacy', 'blob shred failed', { error: (err as Error).message });
    }
  }
  // Owned products go first and explicitly: only rows with this owner are
  // matched, so shared catalogue rows (owner_id NULL) always survive. Their
  // usage rows go with them through products(id); the caller's remaining
  // usage goes with the users(id) cascade below. product_usage references
  // both users(id) and products(id) ON DELETE CASCADE (see 001_init.sql), so
  // either order leaves no orphan — explicit first keeps the intent readable.
  // Optional so older injected dependency sets keep compiling.
  if (dependencies.deleteOwnedProducts) await dependencies.deleteOwnedProducts(userId);
  // Preserve the existing privacy behavior: a failed/orphaned encrypted blob
  // must not prevent account rows and sessions from being cascade-deleted.
  await dependencies.deleteUser(userId);
  log.info('privacy', 'account and all relational data deleted', {
    blobsShredded,
    blobsFailed,
  });
  return { ok: true, blobsShredded, blobsFailed };
}

async function deleteAccountAtomically(userId: string): Promise<DeleteAccountResult> {
  return transaction(async (tx) => {
    const owner = await tx.row<{ id: string }>(
      'SELECT id FROM users WHERE id = ? FOR UPDATE',
      userId,
    );
    // DELETE is idempotent: a second request sees no account and has no work.
    if (!owner) return { ok: true, blobsShredded: 0, blobsFailed: 0 };

    const refs = await tx.rows<{ ref: string }>(
      `SELECT image_ref AS ref FROM skin_scans WHERE user_id = ? AND image_ref IS NOT NULL
       UNION ALL SELECT thumb_ref AS ref FROM skin_scans WHERE user_id = ? AND thumb_ref IS NOT NULL
       UNION ALL SELECT image_ref AS ref FROM body_scans WHERE user_id = ? AND image_ref IS NOT NULL
       UNION ALL SELECT profile_image_ref AS ref FROM body_scans WHERE user_id = ? AND profile_image_ref IS NOT NULL
       UNION ALL SELECT blob_ref AS ref FROM progress_photos WHERE user_id = ? AND blob_ref IS NOT NULL`,
      userId, userId, userId, userId, userId,
    );
    const uniqueRefs = [...new Set(refs.map((entry) => entry.ref))];
    let blobsShredded = 0;
    if (uniqueRefs.length) {
      blobsShredded = await tx.run(
        `DELETE FROM blobs WHERE ref IN (${uniqueRefs.map(() => '?').join(',')})`,
        ...uniqueRefs,
      );
    }
    // Explicitly remove owned catalogue rows before the user cascade; shared
    // rows (owner_id NULL) remain untouched.
    await tx.run('DELETE FROM products WHERE owner_id = ?', userId);
    await tx.run('DELETE FROM users WHERE id = ?', userId);
    log.info('privacy', 'account and all relational data deleted atomically', {
      blobsShredded,
      blobsFailed: 0,
    });
    return { ok: true, blobsShredded, blobsFailed: 0 };
  });
}
