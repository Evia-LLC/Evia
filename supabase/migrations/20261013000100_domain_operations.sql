-- RPC conventions and lock order: docs/DATA_API_ADR.md.
-- These are domain operations, never arbitrary SQL or transaction endpoints.
SET search_path = public, pg_catalog;

CREATE VIEW public.evia_current_consents WITH (security_invoker = true) AS
SELECT DISTINCT ON (user_id, consent_type) * FROM public.consent_events
ORDER BY user_id, consent_type, recorded_at DESC, event_sequence DESC;

CREATE FUNCTION public.evia_create_user(p_user jsonb, p_profile jsonb, p_preferences jsonb, p_consent jsonb)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.users SELECT * FROM jsonb_populate_record(NULL::public.users, p_user);
  IF p_consent IS NOT NULL THEN
    INSERT INTO public.consent_events
      (id, user_id, consent_type, wording_version_id, state, recorded_at, actor_type, actor_id, metadata_json, idempotency_key)
    SELECT id, user_id, consent_type, wording_version_id, state, recorded_at, actor_type, actor_id, metadata_json, idempotency_key
    FROM jsonb_populate_record(NULL::public.consent_events, p_consent);
  END IF;
  INSERT INTO public.skin_profiles SELECT * FROM jsonb_populate_record(NULL::public.skin_profiles, p_profile);
  INSERT INTO public.preferences SELECT * FROM jsonb_populate_record(NULL::public.preferences, p_preferences);
  RETURN p_user->>'id';
END;
$$;

CREATE FUNCTION public.evia_insert_skin_scan(p_row jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.users WHERE id = p_row->>'user_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'EV002', MESSAGE = 'Account no longer exists.'; END IF;
  INSERT INTO public.skin_scans SELECT * FROM jsonb_populate_record(NULL::public.skin_scans, p_row);
END;
$$;

CREATE FUNCTION public.evia_insert_body_scan(p_row jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.users WHERE id = p_row->>'user_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'EV002', MESSAGE = 'Account no longer exists.'; END IF;
  INSERT INTO public.body_scans SELECT * FROM jsonb_populate_record(NULL::public.body_scans, p_row);
END;
$$;

CREATE FUNCTION public.evia_delete_skin_scan(p_user_id text, p_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.skin_scans; refs text[];
BEGIN
  PERFORM id FROM public.users WHERE id = p_user_id FOR UPDATE;
  SELECT * INTO r FROM public.skin_scans WHERE id = p_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  refs := array_remove(ARRAY[r.image_ref, r.thumb_ref], NULL);
  DELETE FROM public.skin_scans WHERE id = p_id AND user_id = p_user_id;
  DELETE FROM public.blobs WHERE ref = ANY(refs);
  RETURN to_jsonb(refs);
END;
$$;

CREATE FUNCTION public.evia_delete_body_scan(p_user_id text, p_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.body_scans; refs text[];
BEGIN
  PERFORM id FROM public.users WHERE id = p_user_id FOR UPDATE;
  SELECT * INTO r FROM public.body_scans WHERE id = p_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  refs := array_remove(ARRAY[r.image_ref, r.profile_image_ref], NULL);
  DELETE FROM public.body_scans WHERE id = p_id AND user_id = p_user_id;
  DELETE FROM public.blobs WHERE ref = ANY(refs);
  RETURN to_jsonb(refs);
END;
$$;

CREATE FUNCTION public.evia_create_progress_photo(p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.progress_photos;
BEGIN
  PERFORM id FROM public.users WHERE id = p_row->>'user_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'EV002', MESSAGE = 'Account no longer exists.'; END IF;
  SELECT * INTO r FROM public.progress_photos
    WHERE user_id = p_row->>'user_id' AND skin_scan_id = p_row->>'skin_scan_id' FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('photo', to_jsonb(r), 'created', false); END IF;
  INSERT INTO public.progress_photos SELECT * FROM jsonb_populate_record(NULL::public.progress_photos, p_row)
    ON CONFLICT (user_id, skin_scan_id) DO NOTHING RETURNING * INTO r;
  IF FOUND THEN RETURN jsonb_build_object('photo', to_jsonb(r), 'created', true); END IF;
  SELECT * INTO r FROM public.progress_photos
    WHERE user_id = p_row->>'user_id' AND skin_scan_id = p_row->>'skin_scan_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'progress photo idempotency conflict could not be resolved'; END IF;
  RETURN jsonb_build_object('photo', to_jsonb(r), 'created', false);
END;
$$;

CREATE FUNCTION public.evia_delete_progress_photo(p_user_id text, p_id text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE blob text;
BEGIN
  PERFORM id FROM public.users WHERE id = p_user_id FOR UPDATE;
  SELECT blob_ref INTO blob FROM public.progress_photos WHERE id = p_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  DELETE FROM public.progress_photos WHERE id = p_id AND user_id = p_user_id;
  DELETE FROM public.blobs WHERE ref = blob;
  RETURN blob;
END;
$$;

CREATE FUNCTION public.evia_delete_account(p_user_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE shredded integer;
BEGIN
  -- Account fence first. Budget identities deliberately have no users FK.
  PERFORM id FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'blobsShredded', 0, 'blobsFailed', 0); END IF;
  DELETE FROM public.blobs WHERE ref IN (
    SELECT image_ref FROM public.skin_scans WHERE user_id = p_user_id
    UNION SELECT thumb_ref FROM public.skin_scans WHERE user_id = p_user_id
    UNION SELECT image_ref FROM public.body_scans WHERE user_id = p_user_id
    UNION SELECT profile_image_ref FROM public.body_scans WHERE user_id = p_user_id
    UNION SELECT blob_ref FROM public.progress_photos WHERE user_id = p_user_id
  );
  GET DIAGNOSTICS shredded = ROW_COUNT;
  DELETE FROM public.products WHERE owner_id = p_user_id;
  DELETE FROM public.users WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'blobsShredded', shredded, 'blobsFailed', 0);
END;
$$;

CREATE FUNCTION public.evia_upsert_memory(p_row jsonb) RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  INSERT INTO public.memories SELECT * FROM jsonb_populate_record(NULL::public.memories, p_row)
  ON CONFLICT (user_id, kind, key) DO UPDATE SET value = excluded.value,
    confidence = greatest(memories.confidence, excluded.confidence),
    source_message_id = excluded.source_message_id, updated_at = excluded.updated_at;
$$;

-- Lookup remains distinct from mutation. No new uniqueness or atomic-upsert rule.
CREATE FUNCTION public.evia_find_product_match(p_name text, p_brand text, p_owner_id text)
RETURNS SETOF public.products LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.products WHERE lower(name) = lower(p_name)
    AND coalesce(lower(brand), '') = coalesce(lower(p_brand), '')
    AND owner_id IS NOT DISTINCT FROM p_owner_id LIMIT 1;
$$;

-- Search patterns stay SQL parameters: PostgREST's '*' alias and filter grammar
-- would otherwise change matching for arbitrary user-entered product names.
CREATE FUNCTION public.evia_search_products(p_query text, p_user_id text, p_limit integer)
RETURNS SETOF public.products LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.products WHERE (name ILIKE '%' || p_query || '%' OR brand ILIKE '%' || p_query || '%')
    AND (owner_id IS NULL OR owner_id = p_user_id) ORDER BY name LIMIT p_limit;
$$;

CREATE FUNCTION public.evia_find_catalogue_match(p_source text, p_name text, p_brand text)
RETURNS SETOF public.catalogue_products LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.catalogue_products WHERE source = p_source AND lower(name) = lower(p_name)
    AND coalesce(brand, '') = coalesce(p_brand, '') LIMIT 1;
$$;

CREATE FUNCTION public.evia_consume_rate_bucket(p_key_hash text, p_now timestamptz, p_expires timestamptz)
RETURNS TABLE(count integer, reset_at timestamptz) LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  INSERT INTO public.rate_limit_buckets AS b (key_hash, count, reset_at) VALUES (p_key_hash, 1, p_expires)
  ON CONFLICT (key_hash) DO UPDATE SET count = CASE WHEN b.reset_at <= p_now THEN 1 ELSE b.count + 1 END,
    reset_at = CASE WHEN b.reset_at <= p_now THEN p_expires ELSE b.reset_at END
  RETURNING count, reset_at;
$$;

CREATE FUNCTION public.evia_sweep_rate_buckets(p_now timestamptz) RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  DELETE FROM public.rate_limit_buckets WHERE key_hash IN
    (SELECT key_hash FROM public.rate_limit_buckets WHERE reset_at <= p_now LIMIT 100);
$$;

CREATE FUNCTION public.evia_touch_voice_line(p_key text) RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.voice_lines SET hits = hits + 1 WHERE key = p_key;
$$;

CREATE FUNCTION public.evia_prune_voice_lines(p_max_rows integer) RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  DELETE FROM public.voice_lines WHERE key NOT IN
    (SELECT key FROM public.voice_lines ORDER BY created_at DESC, key DESC LIMIT p_max_rows);
$$;

CREATE FUNCTION public.evia_purge_voice_lines(p_allowlist text[], p_apply boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE preserved bigint; condemned bigint; deleted bigint := 0;
BEGIN
  SELECT count(*) INTO preserved FROM public.voice_lines WHERE text = ANY(p_allowlist);
  SELECT count(*) INTO condemned FROM public.voice_lines WHERE NOT (text = ANY(p_allowlist));
  IF p_apply THEN
    DELETE FROM public.voice_lines WHERE NOT (text = ANY(p_allowlist));
    GET DIAGNOSTICS deleted = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('dryRun', NOT p_apply, 'preserved', preserved, 'condemned', condemned, 'deleted', deleted);
END;
$$;
