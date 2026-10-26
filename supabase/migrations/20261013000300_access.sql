-- RLS denies direct anonymous access. Application authorization remains server-side.
CREATE FUNCTION public.evia_data_api_status() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['users', 'sessions', 'skin_profiles', 'preferences', 'skin_scans', 'products', 'product_usage', 'product_observations', 'conversations', 'messages', 'memories', 'body_scans', 'blobs', 'usage_ledger', 'voice_lines', 'catalogue_products', 'catalogue_syncs', 'consent_events', 'rate_limit_buckets', 'progress_photos', 'budget_reservations'] LOOP
    IF to_regclass('public.' || name) IS NULL OR NOT (
      has_table_privilege(current_user, 'public.' || name, 'SELECT') AND
      has_table_privilege(current_user, 'public.' || name, 'INSERT') AND
      has_table_privilege(current_user, 'public.' || name, 'UPDATE') AND
      has_table_privilege(current_user, 'public.' || name, 'DELETE')) THEN
      RAISE EXCEPTION USING ERRCODE = 'EV003', MESSAGE = 'Data API table contract is unavailable.';
    END IF;
  END LOOP;
FOREACH name IN ARRAY ARRAY['evia_create_user', 'evia_insert_skin_scan', 'evia_insert_body_scan', 'evia_delete_skin_scan', 'evia_delete_body_scan', 'evia_create_progress_photo', 'evia_delete_progress_photo', 'evia_delete_account', 'evia_upsert_memory', 'evia_find_product_match', 'evia_search_products', 'evia_find_catalogue_match', 'evia_consume_rate_bucket', 'evia_sweep_rate_buckets', 'evia_touch_voice_line', 'evia_prune_voice_lines', 'evia_purge_voice_lines', 'evia_budget_usage', 'evia_budget_allowance', 'evia_budget_reserve', 'evia_budget_transition', 'evia_data_api_status'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = name AND has_function_privilege(current_user, p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION USING ERRCODE = 'EV003', MESSAGE = 'Data API function contract is unavailable.';
    END IF;
  END LOOP;
  PERFORM id FROM public.users LIMIT 1;
  PERFORM user_id FROM public.evia_current_consents LIMIT 1;
  RETURN jsonb_build_object('contract', 'evia-data-api-v1');
END;
$$;

GRANT USAGE ON SCHEMA public, evia_private TO service_role;
REVOKE ALL ON SCHEMA evia_private FROM PUBLIC, anon, authenticated;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.users TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;
ALTER TABLE public.skin_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.skin_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.skin_profiles TO service_role;
ALTER TABLE public.preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preferences FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.preferences TO service_role;
ALTER TABLE public.skin_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.skin_scans FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.skin_scans TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.products TO service_role;
ALTER TABLE public.product_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.product_usage TO service_role;
ALTER TABLE public.product_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_observations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.product_observations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.messages TO service_role;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.memories FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.memories TO service_role;
ALTER TABLE public.body_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.body_scans FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.body_scans TO service_role;
ALTER TABLE public.blobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.blobs TO service_role;
ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.usage_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.usage_ledger TO service_role;
ALTER TABLE public.voice_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.voice_lines FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.voice_lines TO service_role;
ALTER TABLE public.catalogue_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogue_products FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.catalogue_products TO service_role;
ALTER TABLE public.catalogue_syncs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogue_syncs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.catalogue_syncs TO service_role;
ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.consent_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.consent_events TO service_role;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_buckets TO service_role;
ALTER TABLE public.progress_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.progress_photos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.progress_photos TO service_role;
ALTER TABLE public.budget_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.budget_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.budget_reservations TO service_role;
REVOKE ALL ON TABLE public.evia_current_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.evia_current_consents TO service_role;
REVOKE ALL ON SEQUENCE public.consent_events_event_sequence_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.consent_events_event_sequence_seq TO service_role;

-- Defaults apply to this migration's object creator; explicit grants cover existing objects.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA evia_private REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'evia_private' OR (n.nspname = 'public' AND
      (p.proname LIKE 'evia_%' OR p.proname = 'prevent_consent_event_update'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
  END LOOP;
END;
$$;
NOTIFY pgrst, 'reload schema';
