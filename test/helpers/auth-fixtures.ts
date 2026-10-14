/** Disposable local Supabase only. Hosted accounts must never be auto-confirmed by fixtures. */
import { createAdminClient, createRequestClient, resolveSupabaseConfig } from '../../server/lib/supabase.ts';
import { prepareRegistration, discardRegistration } from '../../server/db/registration.ts';
const passwords=new Map<string,{email:string;password:string}>();
function localOnly():void {
  const config=resolveSupabaseConfig();
  if (process.env.ELOHIM_DATA_API_LANE!=='1' || !config.url || !['localhost','127.0.0.1','[::1]'].includes(new URL(config.url).hostname)) throw new Error('Auth fixtures require the owned disposable local Supabase stack.');
}
export async function createUser(email:string,password:string,displayName:string,registration?:{dateOfBirth:string;ip?:string}):Promise<string> {
 localOnly();const normalized=email.trim().toLowerCase();
 const token=await prepareRegistration({email:normalized,displayName,dateOfBirth:registration?.dateOfBirth??'2000-01-01',ip:registration?.ip});
 try {
  const {data,error}=await createAdminClient().auth.admin.createUser({email:normalized,password,email_confirm:true,user_metadata:{evia_registration_token:token},app_metadata:{evia_synthetic:true}});
  if (error || !data.user) throw new Error('Local fixture Auth creation failed.');
  passwords.set(data.user.id,{email:normalized,password});return data.user.id;
 } finally {await discardRegistration(token);}
}
export async function createSession(userId:string):Promise<string> {
 localOnly();const account=passwords.get(userId);if(!account)throw new Error('Unknown fixture account.');
 const {data,error}=await createRequestClient().auth.signInWithPassword(account);
 if(error || !data.session)throw new Error('Local fixture sign-in failed.');
 return data.session.access_token;
}
export async function cleanFixtureIdentities():Promise<void> {
 localOnly();const admin=createAdminClient();
 // Local test runner owns the entire database. Delete via Auth API, not direct SQL.
 for (;;) {
   const {data,error}=await admin.auth.admin.listUsers({page:1,perPage:1000});
   if(error)throw error;if(!data.users.length)break;
   for(const user of data.users){const result=await admin.auth.admin.deleteUser(user.id);if(result.error)throw result.error;}
 }
 passwords.clear();
}
