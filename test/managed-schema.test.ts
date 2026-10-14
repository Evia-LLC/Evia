/** Real PostgreSQL execution in isolated PGlite. The synthetic auth schema is NOT a hosted Auth-service test. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
let db:PGlite;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const scalar=async<T=unknown>(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,T>>(sql,args)).rows[0]??{})[0];
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now(),email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}');
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,not_after timestamptz);`);
 for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{await db.exec('BEGIN');});
afterEach(async()=>{await db.exec('ROLLBACK');});
async function intent(email:string) {
 const token=randomBytes(32).toString('hex');
 await db.query('select public.evia_prepare_registration($1,$2,$3,$4,$5,$6)',[hash(token),email,'Sample','2000-01-01','test-terms',{demoOnly:true,source:'registration',documentVersions:{terms:'test-terms'}}]);
 return token;
}
async function authFixture(email='sample@example.test',confirmed=true) {
 const id=randomUUID(); const token=await intent(email);
 await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,email,{evia_registration_token:token,display_name:'Forged',date_of_birth:'2020-01-01'}]);
 if(confirmed)await db.query('update auth.users set email_confirmed_at=now() where id=$1',[id]);
 const sid=randomUUID();await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,id]);
 return {id,sid,token};
}
async function addScan(userId:string,blob='blob-'+randomUUID()) {
 const id=randomUUID();
 await db.query("insert into public.blobs(ref,data,bytes,created_at) values($1,'\\x0102',2,'2026-01-01')",[blob]);
 await db.query("select public.evia_insert_skin_scan($1)",[{id,user_id:userId,captured_at:'2026-01-01',image_ref:blob,metrics_json:'{}',regions_json:'{}',capture_quality_json:'{}',observations_json:'[]',confidence:.8,model_version:'test'}]);
 return{id,blob};
}
describe('managed identity database contract',()=>{
 it('reconstructs UUID ownership without custom password/session storage',async()=>{
  expect(await scalar("select data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='id'")).toBe('uuid');
  expect(await scalar("select count(*)::int from information_schema.columns where table_schema='public' and column_name in ('password_hash','password_salt')")).toBe(0);
  expect(await scalar("select to_regclass('public.sessions')")).toBeNull();
  expect(await scalar("select count(*)::int from pg_constraint where conrelid='public.users'::regclass and confrelid='auth.users'::regclass and contype='f'")).toBe(1);
 });
 it('creates identity-linked profile, preferences, and server-derived consent in one transaction',async()=>{
  const {id,token}=await authFixture();
  const user=(await db.query('select *,date_of_birth::text as date_of_birth from public.users where id=$1',[id])).rows[0];
  expect(user).toMatchObject({display_name:'Sample',date_of_birth:'2000-01-01'});
  expect(await scalar('select count(*)::int from public.skin_profiles where user_id=$1',[id])).toBe(1);
  expect(await scalar('select voice_enabled from public.preferences where user_id=$1',[id])).toBe(0);
  const consent=(await db.query('select * from public.consent_events where user_id=$1',[id])).rows[0];
  expect(consent).toMatchObject({actor_id:id,wording_version_id:'test-terms',consent_type:'registration_terms',state:'granted'});
  expect(await scalar('select count(*)::int from evia_private.registration_intents where token_hash=$1',[hash(token)])).toBe(0);
 });
 it('rejects direct signup metadata without a server-issued intent',async()=>{
  await expect(db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[randomUUID(),'bypass@example.test',{date_of_birth:'2000-01-01',termsAccepted:true}])).rejects.toThrow('Registration must start through Evia');
 });
 it('rejects expired or wrong-email registration capabilities',async()=>{
  const token=await intent('owner@example.test');
  await expect(db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[randomUUID(),'other@example.test',{evia_registration_token:token}])).rejects.toThrow('Registration authorization expired or was used');
 });
 it('rolls Auth insertion and profile creation back when consent insertion fails',async()=>{
  const token=await intent('rollback@example.test');const id=randomUUID();
  await db.exec(`CREATE FUNCTION public.test_consent_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'forced consent failure'; END$$;
  CREATE TRIGGER test_consent_failure BEFORE INSERT ON public.consent_events FOR EACH ROW EXECUTE FUNCTION public.test_consent_failure(); SAVEPOINT probe;`);
  await expect(db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,'rollback@example.test',{evia_registration_token:token}])).rejects.toThrow('forced consent failure');
  await db.exec('ROLLBACK TO probe');
  expect(await scalar('select count(*)::int from auth.users where id=$1',[id])).toBe(0);
  expect(await scalar('select count(*)::int from public.users where id=$1',[id])).toBe(0);
  expect(await scalar('select count(*)::int from evia_private.registration_intents where token_hash=$1',[hash(token)])).toBe(1);
 });
 it('rejects unconfirmed, cross-account, expired and revoked sessions',async()=>{
  const a=await authFixture('a@example.test',false);const b=await authFixture('b@example.test');
  expect(await scalar('select public.evia_auth_session_active($1,$2)',[a.id,a.sid])).toBe(false);
  expect(await scalar('select public.evia_auth_session_active($1,$2)',[b.id,b.sid])).toBe(true);
  expect(await scalar('select public.evia_auth_session_active($1,$2)',[a.id,b.sid])).toBe(false);
  await db.query('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[b.sid]);
  expect(await scalar('select public.evia_auth_session_active($1,$2)',[b.id,b.sid])).toBe(false);
  await db.query('delete from auth.sessions where id=$1',[b.sid]);
  expect(await scalar('select public.evia_auth_session_active($1,$2)',[b.id,b.sid])).toBe(false);
 });
 it('binds password recovery grants to one user and one session and consumes once',async()=>{
  const a=await authFixture();const digest=hash('recovery');
  await db.query('select public.evia_prepare_recovery($1,$2,$3)',[digest,a.id,a.sid]);
  expect(await scalar('select public.evia_consume_recovery($1,$2,$3)',[digest,a.id,randomUUID()])).toBe(false);
  expect(await scalar('select public.evia_consume_recovery($1,$2,$3)',[digest,a.id,a.sid])).toBe(true);
  expect(await scalar('select public.evia_consume_recovery($1,$2,$3)',[digest,a.id,a.sid])).toBe(false);
 });
 it('cascades owned rows and encrypted blobs on Auth deletion, without touching another account',async()=>{
  const a=await authFixture('delete@example.test');const b=await authFixture('keep@example.test');
  const photo=await addScan(a.id);const keep=await addScan(b.id);
  await db.query('delete from auth.users where id=$1',[a.id]);
  expect(await scalar('select count(*)::int from public.users where id=$1',[a.id])).toBe(0);
  expect(await scalar('select count(*)::int from auth.sessions where user_id=$1',[a.id])).toBe(0);
  expect(await scalar('select count(*)::int from public.consent_events where user_id=$1',[a.id])).toBe(0);
  expect(await scalar('select count(*)::int from public.blobs where ref=$1',[photo.blob])).toBe(0);
  expect(await scalar('select count(*)::int from public.blobs where ref=$1',[keep.blob])).toBe(1);
  expect(await scalar('select public.evia_deletion_receipt($1)',[a.id])).toMatchObject({ok:true,blobsShredded:1,blobsFailed:0});
 });
 it('rolls cleanup back when any later Auth deletion trigger fails',async()=>{
  const a=await authFixture();const photo=await addScan(a.id);
  await db.exec(`CREATE FUNCTION public.test_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'forced deletion failure'; END$$;
  CREATE TRIGGER z_test_delete_failure BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.test_delete_failure(); SAVEPOINT erase;`);
  await expect(db.query('delete from auth.users where id=$1',[a.id])).rejects.toThrow('forced deletion failure');
  await db.exec('ROLLBACK TO erase');
  expect(await scalar('select count(*)::int from public.users where id=$1',[a.id])).toBe(1);
  expect(await scalar('select count(*)::int from public.blobs where ref=$1',[photo.blob])).toBe(1);
  expect(await scalar('select public.evia_deletion_receipt($1)',[a.id])).toBeNull();
 });
 it('runs UUID-safe scan deletion and prevents cross-user deletion',async()=>{
  const a=await authFixture('a@example.test');const b=await authFixture('b@example.test');const scan=await addScan(a.id);
  expect(await scalar('select public.evia_delete_skin_scan($1,$2)',[b.id,scan.id])).toEqual([]);
  expect(await scalar('select count(*)::int from public.skin_scans where id=$1',[scan.id])).toBe(1);
  expect(await scalar('select public.evia_delete_skin_scan($1,$2)',[a.id,scan.id])).toEqual([scan.blob]);
 });
 it('preserves non-account budget subjects and atomic reservation accounting',async()=>{
  const op=randomUUID();const input={operationId:op,userId:'guest:voice',day:'2026-10-14',provider:'test',unit:'tts-chars',estimatedUnits:5};
  expect(await scalar('select public.evia_budget_reserve($1,10,100,1000)',[input])).toMatchObject({ok:true,duplicate:false});
  expect(await scalar("select public.evia_budget_transition($1,'settled',5,null,0,0)",[op])).toMatchObject({ok:true,duplicate:false});
  expect(await scalar("select public.evia_budget_transition($1,'settled',5,null,0,0)",[op])).toMatchObject({ok:true,duplicate:true});
  expect(await scalar("select turns from public.usage_ledger where user_id='guest:voice'")).toBe(1);
 });
 it('starts a visible product only once and preserves ownership',async()=>{
  const a=await authFixture('usage@example.test');const pid=randomUUID();
  await db.query('insert into public.products(id,name,created_at,owner_id) values($1,$2,$3,$4)',[pid,'Fixture','2026-10-14',a.id]);
  const start=()=>scalar('select public.evia_start_product_usage($1,$2,$3,$4,$5)',[a.id,pid,'2026-10-14',null,null]);
  const first=await start();expect(await start()).toBe(first);
  expect(await scalar('select count(*)::int from public.product_usage where user_id=$1',[a.id])).toBe(1);
 });
 it('readiness validates permissions/schema without requiring any users',async()=>{
  expect(await scalar('select public.evia_data_api_status()')).toMatchObject({contract:'evia-managed-auth-v2'});
  await db.exec('SET LOCAL ROLE service_role');
  expect(await scalar('select public.evia_data_api_status()')).toMatchObject({contract:'evia-managed-auth-v2'});
 });
 it('denies both anonymous and authenticated browser roles direct data/RPC access',async()=>{
  expect(await scalar("select has_table_privilege('anon','public.users','SELECT')")).toBe(false);
  expect(await scalar("select has_table_privilege('authenticated','public.users','SELECT')")).toBe(false);
  expect(await scalar("select has_function_privilege('authenticated','public.evia_auth_session_active(uuid,uuid)','EXECUTE')")).toBe(false);
  expect(await scalar("select has_function_privilege('anon','public.evia_prepare_registration(text,text,text,date,text,jsonb)','EXECUTE')")).toBe(false);
  expect(await scalar("select has_function_privilege('service_role','public.evia_auth_session_active(uuid,uuid)','EXECUTE')")).toBe(true);
 });
});
