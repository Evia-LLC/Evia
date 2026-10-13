import { database, result } from '../lib/data-api.ts';
import { log } from '../lib/log.ts';

export interface DeleteAccountResult {
  ok: true;
  blobsShredded: number;
  blobsFailed: number;
}

/** Tests substitute the same atomic operation, never a second deletion algorithm. */
export interface DeleteAccountDependencies {
  erase: (userId: string) => Promise<DeleteAccountResult>;
}

const defaults: DeleteAccountDependencies = {
  erase: (userId) => result<DeleteAccountResult>(database().rpc('evia_delete_account', { p_user_id: userId })),
};

export async function deleteAccount(
  userId: string,
  dependencies: DeleteAccountDependencies = defaults,
): Promise<DeleteAccountResult> {
  const erased = await dependencies.erase(userId);
  log.info('privacy', 'account and all relational data deleted atomically', {
    blobsShredded: erased.blobsShredded, blobsFailed: erased.blobsFailed,
  });
  return erased;
}
