import { database, result } from '../lib/data-api.ts';
import { createAdminClient } from '../lib/supabase.ts';
import { log } from '../lib/log.ts';

export interface DeleteAccountResult { ok:true; blobsShredded:number; blobsFailed:number; }
export interface DeleteAccountDependencies { erase:(userId:string)=>Promise<DeleteAccountResult>; }
export class DeletionUncertainError extends Error {
  readonly rollbackConfirmed = false;
  constructor() { super('Deletion status could not be verified. Reload before retrying.'); }
}
const defaults:DeleteAccountDependencies = {
  async erase(userId) {
    // The only mutation is the supported Auth API. The DB trigger removes encrypted
    // blobs, and the auth.users FK cascades profiles/data in this same transaction.
    // A network timeout is reconciled using a transactionally committed receipt.
    const admin=createAdminClient();
    let error:unknown;
    try { ({error}=await admin.auth.admin.deleteUser(userId)); } catch(cause) { error=cause; }
    try {
      const receipt=await result<DeleteAccountResult|null>(database().rpc('evia_deletion_receipt',{p_user_id:userId}));
      if (receipt?.ok === true && Number.isInteger(receipt.blobsShredded) && receipt.blobsFailed===0) return receipt;
    } catch { /* A missing reconciliation answer must not become a success claim. */ }
    if (error) {
      try {
        const existing=await admin.auth.admin.getUserById(userId);
        if (!existing.error && existing.data.user?.id===userId) {
          throw Object.assign(new Error('The deletion did not complete. Please try again.'),{rollbackConfirmed:true});
        }
      } catch(cause) {
        if (cause instanceof Error && 'rollbackConfirmed' in cause) throw cause;
      }
    }
    throw new DeletionUncertainError();
  },
};
export async function deleteAccount(userId:string,dependencies:DeleteAccountDependencies=defaults):Promise<DeleteAccountResult> {
  const erased=await dependencies.erase(userId);
  log.info('privacy','managed identity and account data deletion confirmed',{blobsShredded:erased.blobsShredded,blobsFailed:erased.blobsFailed});
  return erased;
}
