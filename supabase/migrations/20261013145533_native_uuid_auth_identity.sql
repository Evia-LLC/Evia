DO $m$
DECLARE fk record;
BEGIN
 IF EXISTS(SELECT 1 FROM auth.users LIMIT 1) OR EXISTS(SELECT 1 FROM public.users LIMIT 1) THEN RAISE EXCEPTION 'Nonempty identity tables'; END IF;
 FOR fk IN SELECT conrelid::regclass tbl,conname FROM pg_constraint WHERE contype='f' AND confrelid='public.users'::regclass
 LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',fk.tbl,fk.conname); END LOOP;
END $m$;
DROP VIEW public.evia_current_consents;
DROP TABLE public.sessions;
ALTER TABLE public.users ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE public.users ADD CONSTRAINT users_auth_identity_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.users DROP COLUMN password_hash;
ALTER TABLE public.users DROP COLUMN password_salt;
DO $m$
DECLARE r record;
BEGIN
 FOR r IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND
 (column_name='user_id' OR (table_name='products' AND column_name='owner_id'))
 LOOP EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE uuid USING %I::uuid',r.table_name,r.column_name,r.column_name); END LOOP;
 FOR r IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND
 (table_name,column_name) IN (VALUES ('memories','user_id'),('body_scans','user_id'),('consent_events','user_id'),
 ('skin_profiles','user_id'),('preferences','user_id'),('skin_scans','user_id'),('products','owner_id'),
 ('product_usage','user_id'),('product_observations','user_id'),('conversations','user_id'),('progress_photos','user_id'))
 LOOP EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.users(id) ON DELETE CASCADE',r.table_name,r.table_name||'_'||r.column_name||'_fkey',r.column_name); END LOOP;
END $m$;
CREATE VIEW public.evia_current_consents WITH (security_invoker=true) AS
SELECT DISTINCT ON (user_id,consent_type) id,event_sequence,user_id,consent_type,wording_version_id,state,recorded_at,actor_type,actor_id,metadata_json,idempotency_key FROM public.consent_events ORDER BY user_id,consent_type,recorded_at DESC,event_sequence DESC;
CREATE OR REPLACE FUNCTION public.evia_auth_user_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ts text := coalesce(new.created_at::text,now()::text);
BEGIN
 INSERT INTO public.users(id,email,display_name,created_at,date_of_birth)
 VALUES(new.id,coalesce(new.email,''),coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''),'friend'),ts,new.raw_user_meta_data->>'date_of_birth');
 INSERT INTO public.skin_profiles(user_id,updated_at) VALUES(new.id,ts);
 INSERT INTO public.preferences(user_id,voice_enabled,updated_at) VALUES(new.id,0,ts);
 RETURN new;
END $$;
