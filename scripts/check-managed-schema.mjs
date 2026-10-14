/** Isolated SQL contract check. This is not a live Supabase Auth emulator. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now(),email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}');
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,not_after timestamptz);`);
for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()) {
 try { await db.exec(await readFile('supabase/migrations/'+file,'utf8')); console.log('PASS migration '+file); }
 catch(e) { console.error('FAIL migration '+file+' '+e.message); await db.close(); process.exit(1); }
}
console.log('PASS all tracked migrations reconstruct managed Auth schema');
await db.close();
