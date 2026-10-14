import { createHash, randomBytes } from 'node:crypto';
import { database, result } from '../lib/data-api.ts';
import { REGISTRATION_DOCUMENT_VERSIONS, REGISTRATION_TERMS_VERSION } from '../../shared/age-flow.ts';
export const tokenHash = (value:string) => createHash('sha256').update(value).digest('hex');
/** One-use capability issued only after server-side age/terms checks; metadata is never authorization. */
export async function prepareRegistration(input:{email:string; displayName:string; dateOfBirth:string; ip?:string}):Promise<string> {
  const token=randomBytes(32).toString('hex');
  await result(database().rpc('evia_prepare_registration', { p_hash:tokenHash(token), p_email:input.email, p_display_name:input.displayName, p_date_of_birth:input.dateOfBirth, p_terms_version:REGISTRATION_TERMS_VERSION, p_evidence: {documentVersions:REGISTRATION_DOCUMENT_VERSIONS,demoOnly:true,wordingStatus:'placeholder',source:'registration',ip:input.ip ?? null} }));
  return token;
}
export async function discardRegistration(token:string):Promise<void> { await result(database().rpc('evia_discard_registration',{p_hash:tokenHash(token)})); }
