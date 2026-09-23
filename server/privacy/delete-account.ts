import * as users from '../db/users.ts';
import * as scans from '../db/scans.ts';
import * as bodyScans from '../db/body-scans.ts';
import { shredBlob } from '../lib/crypto.ts';
import { log } from '../lib/log.ts';

export interface DeleteAccountResult {
  ok: true;
  blobsShredded: number;
  blobsFailed: number;
}

export interface DeleteAccountDependencies {
  skinBlobRefs: (userId: string) => Promise<string[]>;
  bodyBlobRefs: (userId: string) => Promise<string[]>;
  shred: (ref: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
}

const defaults: DeleteAccountDependencies = {
  skinBlobRefs: scans.allBlobRefs,
  bodyBlobRefs: bodyScans.allBodyBlobRefs,
  shred: shredBlob,
  deleteUser: users.deleteUser,
};

/** Shreds every discoverable blob, then relies on the user FK cascades. */
export async function deleteAccount(
  userId: string,
  dependencies: DeleteAccountDependencies = defaults,
): Promise<DeleteAccountResult> {
  const refs = [
    ...(await dependencies.skinBlobRefs(userId)),
    ...(await dependencies.bodyBlobRefs(userId)),
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
  // Preserve the existing privacy behavior: a failed/orphaned encrypted blob
  // must not prevent account rows and sessions from being cascade-deleted.
  await dependencies.deleteUser(userId);
  log.info('privacy', 'account and all relational data deleted', {
    blobsShredded,
    blobsFailed,
  });
  return { ok: true, blobsShredded, blobsFailed };
}
