-- Reproduce the already-approved empty-project UUID migration from the tracked baseline.
-- No identity is created/removed here. Reject legacy data rather than discarding it.
SET search_path = public, pg_catalog;
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='id' AND data_type='text') AND EXISTS (SELECT 1 FROM public.users) THEN
  RAISE EXCEPTION 'Legacy user rows need an explicit identity mapping before UUID conversion';
 END IF;
END $guard$;
DROP VIEW IF EXISTS public.evia_current_consents;
DROP TABLE IF EXISTS public.sessions;
DO $convert$
DECLARE r record;
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='id' AND data_type='text') THEN
  FOR r IN SELECT conrelid::regclass tbl,conname FROM pg_constraint WHERE contype='f' AND confrelid='public.users'::regclass LOOP
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.tbl,r.conname);
  END LOOP;
  ALTER TABLE public.users ALTER COLUMN id TYPE uuid USING id::uuid;
 END IF;
 FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c WHERE c.table_schema='public' AND c.data_type='text' AND (c.table_name,c.column_name) IN
 (VALUES ('skin_profiles','user_id'),('preferences','user_id'),('skin_scans','user_id'),('body_scans','user_id'),('products','owner_id'),('product_usage','user_id'),('product_observations','user_id'),('conversations','user_id'),('memories','user_id'),('consent_events','user_id'),('progress_photos','user_id')) LOOP
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE uuid USING %I::uuid',r.table_name,r.column_name,r.column_name);
 END LOOP;
 FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c WHERE c.table_schema='public' AND (c.table_name,c.column_name) IN
 (VALUES ('skin_profiles','user_id'),('preferences','user_id'),('skin_scans','user_id'),('body_scans','user_id'),('products','owner_id'),('product_usage','user_id'),('product_observations','user_id'),('conversations','user_id'),('memories','user_id'),('consent_events','user_id'),('progress_photos','user_id')) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=('public.'||r.table_name)::regclass AND conname=r.table_name||'_'||r.column_name||'_fkey') THEN
   EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.users(id) ON DELETE CASCADE',r.table_name,r.table_name||'_'||r.column_name||'_fkey',r.column_name);
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND confrelid='auth.users'::regclass AND contype='f') THEN
  ALTER TABLE public.users ADD CONSTRAINT users_auth_identity_fkey FOREIGN KEY(id) REFERENCES auth.users(id) ON DELETE CASCADE;
 END IF;
END $convert$;
ALTER TABLE public.users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.users DROP COLUMN IF EXISTS password_salt;
ALTER TABLE public.users ALTER COLUMN created_at TYPE timestamptz USING created_at::timestamptz;
ALTER TABLE public.users ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.users ALTER COLUMN date_of_birth TYPE date USING nullif(date_of_birth::text,'')::date;
-- Budget subjects are polymorphic ('guest:voice' or an account UUID string), not account FKs.
ALTER TABLE public.usage_ledger ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE public.budget_reservations ALTER COLUMN user_id TYPE text USING user_id::text;
COMMENT ON COLUMN public.usage_ledger.user_id IS 'Budget subject: account UUID string or non-account subject such as guest:voice. Not a user foreign key.';
COMMENT ON COLUMN public.budget_reservations.user_id IS 'Budget subject, not an account foreign key.';
CREATE VIEW public.evia_current_consents WITH(security_invoker=true) AS SELECT DISTINCT ON(user_id,consent_type) * FROM public.consent_events ORDER BY user_id,consent_type,recorded_at DESC,event_sequence DESC;
REVOKE ALL ON public.evia_current_consents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.evia_current_consents TO service_role;

-- Additive managed-Auth hardening for the existing UUID staging schema.
-- Identity creation/deletion continues exclusively through Supabase Auth APIs.
CREATE SCHEMA IF NOT EXISTS evia_private;
CREATE TABLE evia_private.registration_intents (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 email text NOT NULL, display_name text NOT NULL, date_of_birth date NOT NULL,
 terms_version text NOT NULL, evidence jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes')
);
ALTER TABLE evia_private.registration_intents ENABLE ROW LEVEL SECURITY;
CREATE INDEX registration_intents_expiry ON evia_private.registration_intents(expires_at);
REVOKE ALL ON evia_private.registration_intents FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON evia_private.registration_intents TO service_role;
CREATE FUNCTION public.evia_prepare_registration(p_hash text,p_email text,p_display_name text,p_date_of_birth date,p_terms_version text,p_evidence jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_email <> lower(btrim(p_email)) OR length(p_email)>254 OR p_email NOT LIKE '%@%' OR p_terms_version IS NULL OR length(p_terms_version)=0 OR p_date_of_birth > (current_date-interval '18 years')::date OR p_date_of_birth < (current_date-interval '120 years')::date OR coalesce((p_evidence->>'demoOnly')::boolean,false) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='EV004',MESSAGE='Invalid registration evidence';
 END IF;
 DELETE FROM evia_private.registration_intents WHERE token_hash IN (SELECT token_hash FROM evia_private.registration_intents WHERE expires_at<now() LIMIT 100);
 INSERT INTO evia_private.registration_intents(token_hash,email,display_name,date_of_birth,terms_version,evidence)
 VALUES(p_hash,p_email,left(coalesce(nullif(btrim(p_display_name),''),'friend'),100),p_date_of_birth,p_terms_version,p_evidence);
END $$;
CREATE FUNCTION public.evia_discard_registration(p_hash text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 DELETE FROM evia_private.registration_intents WHERE token_hash=p_hash;
$$;
CREATE FUNCTION evia_private.provision_auth_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE intent evia_private.registration_intents; token text := new.raw_user_meta_data->>'evia_registration_token'; ts text := evia_private.now_iso();
BEGIN
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='EV004',MESSAGE='Registration must start through Evia'; END IF;
 DELETE FROM evia_private.registration_intents WHERE token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') AND email=lower(btrim(new.email)) AND expires_at>now() RETURNING * INTO intent;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='EV004',MESSAGE='Registration authorization expired or was used'; END IF;
 INSERT INTO public.users(id,email,display_name,created_at,date_of_birth) VALUES(new.id,lower(btrim(new.email)),intent.display_name,coalesce(new.created_at,now()),intent.date_of_birth);
 INSERT INTO public.skin_profiles(user_id,updated_at) VALUES(new.id,ts);
 INSERT INTO public.preferences(user_id,voice_enabled,updated_at) VALUES(new.id,0,ts);
 INSERT INTO public.consent_events(id,user_id,consent_type,wording_version_id,state,recorded_at,actor_type,actor_id,metadata_json,idempotency_key)
 VALUES(gen_random_uuid()::text,new.id,'registration_terms',intent.terms_version,'granted',ts,'account',new.id::text,intent.evidence||jsonb_build_object('choice','accepted','source','registration','demoOnly',true),'registration:'||new.id::text);
 RETURN new;
END $$;
-- Replace only the application's own provisioning trigger, not Supabase-managed triggers.
CREATE OR REPLACE TRIGGER evia_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION evia_private.provision_auth_user();
CREATE FUNCTION evia_private.sync_auth_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.email IS DISTINCT FROM old.email THEN UPDATE public.users SET email=lower(btrim(new.email)) WHERE id=new.id; END IF;
 RETURN new;
END $$;
CREATE TRIGGER evia_auth_email_updated AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION evia_private.sync_auth_email();
CREATE FUNCTION evia_private.auth_session_active(p_user_id uuid,p_session_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM auth.sessions s JOIN auth.users a ON a.id=s.user_id JOIN public.users u ON u.id=a.id
 WHERE s.id=p_session_id AND s.user_id=p_user_id AND a.email_confirmed_at IS NOT NULL AND (s.not_after IS NULL OR s.not_after>now())
 AND EXISTS (SELECT 1 FROM public.consent_events c WHERE c.user_id=u.id AND c.consent_type='registration_terms' AND c.state='granted'));
$$;
CREATE FUNCTION public.evia_auth_session_active(p_user_id uuid,p_session_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT evia_private.auth_session_active(p_user_id,p_session_id);
$$;
CREATE TABLE evia_private.recovery_grants (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes')
);
ALTER TABLE evia_private.recovery_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON evia_private.recovery_grants FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON evia_private.recovery_grants TO service_role;
CREATE FUNCTION public.evia_prepare_recovery(p_hash text,p_user_id uuid,p_session_id uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT evia_private.auth_session_active(p_user_id,p_session_id) THEN RAISE EXCEPTION 'Session unavailable'; END IF;
 DELETE FROM evia_private.recovery_grants WHERE expires_at<now() OR user_id=p_user_id;
 INSERT INTO evia_private.recovery_grants(token_hash,user_id,session_id) VALUES(p_hash,p_user_id,p_session_id);
END $$;
CREATE FUNCTION public.evia_consume_recovery(p_hash text,p_user_id uuid,p_session_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 DELETE FROM evia_private.recovery_grants WHERE token_hash=p_hash AND user_id=p_user_id AND session_id=p_session_id AND expires_at>now();
 RETURN FOUND;
END $$;

-- Auth Admin deletion owns the transaction. Cascading data cleanup is an Auth lifecycle trigger.
-- A rollback restores identities, application rows, blobs, and the receipt together.
CREATE TABLE evia_private.deletion_receipts (
 subject_hash text PRIMARY KEY,
 blobs_shredded integer NOT NULL CHECK(blobs_shredded>=0),
 completed_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT(now()+interval '1 day')
);
ALTER TABLE evia_private.deletion_receipts ENABLE ROW LEVEL SECURITY;
CREATE INDEX deletion_receipts_expiry ON evia_private.deletion_receipts(expires_at);
REVOKE ALL ON evia_private.deletion_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON evia_private.deletion_receipts TO service_role;
CREATE FUNCTION evia_private.cleanup_deleted_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE shredded integer := 0;
BEGIN
 PERFORM id FROM public.users WHERE id=old.id FOR UPDATE;
 DELETE FROM public.blobs WHERE ref IN (
   SELECT image_ref FROM public.skin_scans WHERE user_id=old.id
   UNION SELECT thumb_ref FROM public.skin_scans WHERE user_id=old.id
   UNION SELECT image_ref FROM public.body_scans WHERE user_id=old.id
   UNION SELECT profile_image_ref FROM public.body_scans WHERE user_id=old.id
   UNION SELECT blob_ref FROM public.progress_photos WHERE user_id=old.id
 );
 GET DIAGNOSTICS shredded=ROW_COUNT;
 DELETE FROM evia_private.deletion_receipts WHERE subject_hash IN (SELECT subject_hash FROM evia_private.deletion_receipts WHERE expires_at<now() LIMIT 100);
 INSERT INTO evia_private.deletion_receipts(subject_hash,blobs_shredded)
 VALUES(encode(sha256(convert_to(old.id::text,'UTF8')),'hex'),shredded)
 ON CONFLICT(subject_hash) DO UPDATE SET blobs_shredded=excluded.blobs_shredded,completed_at=now(),expires_at=now()+interval '1 day';
 RETURN old;
END $$;
CREATE TRIGGER evia_auth_identity_cleanup BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION evia_private.cleanup_deleted_identity();
CREATE FUNCTION public.evia_deletion_receipt(p_user_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('ok',true,'blobsShredded',blobs_shredded,'blobsFailed',0) FROM evia_private.deletion_receipts
 WHERE subject_hash=encode(sha256(convert_to(p_user_id::text,'UTF8')),'hex') AND expires_at>now();
$$;

CREATE OR REPLACE FUNCTION public.evia_insert_skin_scan(p_row jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.users WHERE id = (p_row->>'user_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'EV002', MESSAGE = 'Account no longer exists.'; END IF;
  INSERT INTO public.skin_scans SELECT * FROM jsonb_populate_record(NULL::public.skin_scans, p_row);
END;
$$;
CREATE OR REPLACE FUNCTION public.evia_insert_body_scan(p_row jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.users WHERE id = (p_row->>'user_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'EV002', MESSAGE = 'Account no longer exists.'; END IF;
  INSERT INTO public.body_scans SELECT * FROM jsonb_populate_record(NULL::public.body_scans, p_row);
END;
$$;
CREATE OR REPLACE FUNCTION public.evia_delete_skin_scan(p_user_id text, p_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.skin_scans; refs text[];
BEGIN
  PERFORM id FROM public.users WHERE id = p_user_id::uuid FOR UPDATE;
  SELECT * INTO r FROM public.skin_scans WHERE id = p_id AND user_id = p_user_id::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  refs := array_remove(ARRAY[r.image_ref, r.thumb_ref], NULL);
  DELETE FROM public.skin_scans WHERE id = p_id AND user_id = p_user_id::uuid;
  DELETE FROM public.blobs WHERE ref = ANY(refs);
  RETURN to_jsonb(refs);
END;
$$;
CREATE OR REPLACE FUNCTION public.evia_delete_body_scan(p_user_id text, p_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.body_scans; refs text[];
BEGIN
  PERFORM id FROM public.users WHERE id = p_user_id::uuid FOR UPDATE;
  SELECT * INTO r FROM public.body_scans WHERE id = p_id AND user_id = p_user_id::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  refs := array_remove(ARRAY[r.image_ref, r.profile_image_ref], NULL);
  DELETE FROM public.body_scans WHERE id = p_id AND user_id = p_user_id::uuid;
  DELETE FROM public.blobs WHERE ref = ANY(refs);
  RETURN to_jsonb(refs);
END;
$$;
CREATE OR REPLACE FUNCTION public.evia_create_progress_photo(p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.progress_photos;
BEGIN
  PERFORM id FROM public.users WHERE id = (p_row->>'user_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'EV002', MESSAGE = 'Account no longer exists.'; END IF;
  SELECT * INTO r FROM public.progress_photos
    WHERE user_id = (p_row->>'user_id')::uuid AND skin_scan_id = p_row->>'skin_scan_id' FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('photo', to_jsonb(r), 'created', false); END IF;
  INSERT INTO public.progress_photos SELECT * FROM jsonb_populate_record(NULL::public.progress_photos, p_row)
    ON CONFLICT (user_id, skin_scan_id) DO NOTHING RETURNING * INTO r;
  IF FOUND THEN RETURN jsonb_build_object('photo', to_jsonb(r), 'created', true); END IF;
  SELECT * INTO r FROM public.progress_photos
    WHERE user_id = (p_row->>'user_id')::uuid AND skin_scan_id = p_row->>'skin_scan_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'progress photo idempotency conflict could not be resolved'; END IF;
  RETURN jsonb_build_object('photo', to_jsonb(r), 'created', false);
END;
$$;
CREATE OR REPLACE FUNCTION public.evia_delete_progress_photo(p_user_id text, p_id text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE blob text;
BEGIN
  PERFORM id FROM public.users WHERE id = p_user_id::uuid FOR UPDATE;
  SELECT blob_ref INTO blob FROM public.progress_photos WHERE id = p_id AND user_id = p_user_id::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  DELETE FROM public.progress_photos WHERE id = p_id AND user_id = p_user_id::uuid;
  DELETE FROM public.blobs WHERE ref = blob;
  RETURN blob;
END;
$$;
CREATE OR REPLACE FUNCTION public.evia_find_product_match(p_name text, p_brand text, p_owner_id text)
RETURNS SETOF public.products LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.products WHERE lower(name) = lower(p_name)
    AND coalesce(lower(brand), '') = coalesce(lower(p_brand), '')
    AND owner_id IS NOT DISTINCT FROM p_owner_id::uuid LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.evia_search_products(p_query text, p_user_id text, p_limit integer)
RETURNS SETOF public.products LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.products WHERE (name ILIKE '%' || p_query || '%' OR brand ILIKE '%' || p_query || '%')
    AND (owner_id IS NULL OR owner_id = p_user_id::uuid) ORDER BY name LIMIT p_limit;
$$;
-- Retire old app-only account creation/deletion entry points. Auth API is authoritative.
DROP FUNCTION IF EXISTS public.evia_create_user(jsonb,jsonb,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.evia_delete_account(text);
DROP FUNCTION IF EXISTS public.evia_auth_user_created();

CREATE UNIQUE INDEX product_usage_one_active ON public.product_usage(user_id,product_id) WHERE ended_at IS NULL;
CREATE FUNCTION public.evia_start_product_usage(p_user_id uuid,p_product_id text,p_started_at text,p_frequency text,p_notes text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE usage_id text;
BEGIN
 PERFORM id FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='EV404',MESSAGE='Account unavailable'; END IF;
 PERFORM id FROM public.products WHERE id=p_product_id AND (owner_id=p_user_id OR owner_id IS NULL) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='EV404',MESSAGE='Product unavailable'; END IF;
 SELECT id INTO usage_id FROM public.product_usage WHERE user_id=p_user_id AND product_id=p_product_id AND ended_at IS NULL LIMIT 1;
 IF FOUND THEN RETURN usage_id; END IF;
 usage_id := gen_random_uuid()::text;
 INSERT INTO public.product_usage(id,user_id,product_id,started_at,frequency,notes) VALUES(usage_id,p_user_id,p_product_id,p_started_at,p_frequency,p_notes);
 RETURN usage_id;
END $$;

DO $acl$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','evia_private') AND (p.proname LIKE 'evia_%' OR n.nspname='evia_private') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 END LOOP;
END $acl$;
REVOKE ALL ON SCHEMA evia_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA evia_private TO service_role;
CREATE OR REPLACE FUNCTION public.evia_data_api_status() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['users', 'skin_profiles', 'preferences', 'skin_scans', 'products', 'product_usage', 'product_observations', 'conversations', 'messages', 'memories', 'body_scans', 'blobs', 'usage_ledger', 'voice_lines', 'catalogue_products', 'catalogue_syncs', 'consent_events', 'rate_limit_buckets', 'progress_photos', 'budget_reservations'] LOOP
    IF to_regclass('public.' || name) IS NULL OR NOT (
      has_table_privilege(current_user, 'public.' || name, 'SELECT') AND
      has_table_privilege(current_user, 'public.' || name, 'INSERT') AND
      has_table_privilege(current_user, 'public.' || name, 'UPDATE') AND
      has_table_privilege(current_user, 'public.' || name, 'DELETE')) THEN
      RAISE EXCEPTION USING ERRCODE = 'EV003', MESSAGE = 'Data API table contract is unavailable.';
    END IF;
  END LOOP;
FOREACH name IN ARRAY ARRAY['evia_insert_skin_scan', 'evia_insert_body_scan', 'evia_delete_skin_scan', 'evia_delete_body_scan', 'evia_create_progress_photo', 'evia_delete_progress_photo', 'evia_upsert_memory', 'evia_find_product_match', 'evia_search_products', 'evia_find_catalogue_match', 'evia_consume_rate_bucket', 'evia_sweep_rate_buckets', 'evia_touch_voice_line', 'evia_prune_voice_lines', 'evia_purge_voice_lines', 'evia_budget_usage', 'evia_budget_allowance', 'evia_budget_reserve', 'evia_budget_transition', 'evia_prepare_registration','evia_discard_registration','evia_auth_session_active','evia_prepare_recovery','evia_consume_recovery','evia_deletion_receipt','evia_start_product_usage','evia_data_api_status'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = name AND has_function_privilege(current_user, p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION USING ERRCODE = 'EV003', MESSAGE = 'Data API function contract is unavailable.';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='id' AND data_type='uuid') THEN
    RAISE EXCEPTION USING ERRCODE='EV003',MESSAGE='Managed identity schema is incompatible.';
  END IF;
  PERFORM id FROM public.users LIMIT 1;
  PERFORM user_id FROM public.evia_current_consents LIMIT 1;
  RETURN jsonb_build_object('contract', 'evia-managed-auth-v2');
END;
$$;
REVOKE ALL ON FUNCTION public.evia_data_api_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.evia_data_api_status() TO service_role;
NOTIFY pgrst,'reload schema';
