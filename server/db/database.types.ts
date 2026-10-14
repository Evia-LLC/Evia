/** Schema contract for the out-of-band Supabase migrations. No browser imports. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
    users: {
      Row: { id: string; email: string; display_name: string; created_at: string; date_of_birth: string | null };
      Insert: { id: string; email: string; display_name: string; created_at: string; date_of_birth?: string | null };
      Update: Partial<Database['public']['Tables']['users']['Insert']>;
      Relationships: [{ foreignKeyName: 'users_auth_identity_fkey'; columns: ['id']; isOneToOne: true; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    skin_profiles: {
      Row: { user_id: string; skin_type: string; fitzpatrick: number | null; concerns_json: string; sensitivities_json: string; updated_at: string; pregnancy_status: string };
      Insert: { user_id: string; skin_type?: string; fitzpatrick?: number | null; concerns_json?: string; sensitivities_json?: string; updated_at: string; pregnancy_status?: string };
      Update: Partial<Database['public']['Tables']['skin_profiles']['Insert']>;
      Relationships: [{ foreignKeyName: 'skin_profiles_user_id_fkey'; columns: ['user_id']; isOneToOne: true; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    preferences: {
      Row: { user_id: string; explanation_style: string; voice_enabled: number; reduced_motion: number; quality_tier: string; locale: string; voice_uri: string | null; updated_at: string };
      Insert: { user_id: string; explanation_style?: string; voice_enabled?: number; reduced_motion?: number; quality_tier?: string; locale?: string; voice_uri?: string | null; updated_at: string };
      Update: Partial<Database['public']['Tables']['preferences']['Insert']>;
      Relationships: [{ foreignKeyName: 'preferences_user_id_fkey'; columns: ['user_id']; isOneToOne: true; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    skin_scans: {
      Row: { id: string; user_id: string; captured_at: string; image_ref: string | null; thumb_ref: string | null; metrics_json: string; regions_json: string; capture_quality_json: string; observations_json: string; confidence: number; model_version: string; notes: string | null };
      Insert: { id: string; user_id: string; captured_at: string; image_ref?: string | null; thumb_ref?: string | null; metrics_json: string; regions_json?: string; capture_quality_json?: string; observations_json?: string; confidence?: number; model_version: string; notes?: string | null };
      Update: Partial<Database['public']['Tables']['skin_scans']['Insert']>;
      Relationships: [{ foreignKeyName: 'skin_scans_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    products: {
      Row: { id: string; name: string; brand: string | null; category: string | null; ingredients_json: string; source: string; created_at: string; owner_id: string | null };
      Insert: { id: string; name: string; brand?: string | null; category?: string | null; ingredients_json?: string; source?: string; created_at: string; owner_id?: string | null };
      Update: Partial<Database['public']['Tables']['products']['Insert']>;
      Relationships: [{ foreignKeyName: 'products_owner_id_fkey'; columns: ['owner_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    product_usage: {
      Row: { id: string; user_id: string; product_id: string; started_at: string; ended_at: string | null; frequency: string | null; notes: string | null };
      Insert: { id: string; user_id: string; product_id: string; started_at: string; ended_at?: string | null; frequency?: string | null; notes?: string | null };
      Update: Partial<Database['public']['Tables']['product_usage']['Insert']>;
      Relationships: [{ foreignKeyName: 'product_usage_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }, { foreignKeyName: 'product_usage_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] }];
    };
    product_observations: {
      Row: { id: string; user_id: string; product_id: string; verdict: string; note: string | null; created_at: string };
      Insert: { id: string; user_id: string; product_id: string; verdict: string; note?: string | null; created_at: string };
      Update: Partial<Database['public']['Tables']['product_observations']['Insert']>;
      Relationships: [{ foreignKeyName: 'product_observations_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }, { foreignKeyName: 'product_observations_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] }];
    };
    conversations: {
      Row: { id: string; user_id: string; started_at: string; last_active_at: string; title: string | null };
      Insert: { id: string; user_id: string; started_at: string; last_active_at: string; title?: string | null };
      Update: Partial<Database['public']['Tables']['conversations']['Insert']>;
      Relationships: [{ foreignKeyName: 'conversations_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    messages: {
      Row: { id: string; conversation_id: string; role: string; content: string; emotion: string | null; intent: string | null; directive_json: string | null; demo: number; created_at: string };
      Insert: { id: string; conversation_id: string; role: string; content: string; emotion?: string | null; intent?: string | null; directive_json?: string | null; demo?: number; created_at: string };
      Update: Partial<Database['public']['Tables']['messages']['Insert']>;
      Relationships: [{ foreignKeyName: 'messages_conversation_id_fkey'; columns: ['conversation_id']; isOneToOne: false; referencedRelation: 'conversations'; referencedColumns: ['id'] }];
    };
    memories: {
      Row: { id: string; user_id: string; kind: string; key: string; value: string; confidence: number; source_message_id: string | null; updated_at: string };
      Insert: { id: string; user_id: string; kind: string; key: string; value: string; confidence?: number; source_message_id?: string | null; updated_at: string };
      Update: Partial<Database['public']['Tables']['memories']['Insert']>;
      Relationships: [{ foreignKeyName: 'memories_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    body_scans: {
      Row: { id: string; user_id: string; captured_at: string; image_ref: string | null; profile_image_ref: string | null; metrics_json: string; waist_source: string; profile_json: string | null; profile_detail_json: string | null; landmarks_json: string; confidence: number; model_version: string; profile_model_version: string | null };
      Insert: { id: string; user_id: string; captured_at: string; image_ref?: string | null; profile_image_ref?: string | null; metrics_json: string; waist_source?: string; profile_json?: string | null; profile_detail_json?: string | null; landmarks_json?: string; confidence?: number; model_version: string; profile_model_version?: string | null };
      Update: Partial<Database['public']['Tables']['body_scans']['Insert']>;
      Relationships: [{ foreignKeyName: 'body_scans_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    blobs: {
      Row: { ref: string; data: string; bytes: number; created_at: string };
      Insert: { ref: string; data: string; bytes: number; created_at: string };
      Update: Partial<Database['public']['Tables']['blobs']['Insert']>;
      Relationships: [];
    };
    usage_ledger: {
      Row: { day: string; user_id: string; turns: number; input_tokens: number; output_tokens: number; updated_at: string };
      Insert: { day: string; user_id: string; turns?: number; input_tokens?: number; output_tokens?: number; updated_at: string };
      Update: Partial<Database['public']['Tables']['usage_ledger']['Insert']>;
      Relationships: [];
    };
    voice_lines: {
      Row: { key: string; voice_id: string; model_id: string; text: string; audio: string; content_type: string; words_json: string; duration: number; hits: number; created_at: string };
      Insert: { key: string; voice_id: string; model_id: string; text: string; audio: string; content_type: string; words_json: string; duration: number; hits?: number; created_at: string };
      Update: Partial<Database['public']['Tables']['voice_lines']['Insert']>;
      Relationships: [];
    };
    catalogue_products: {
      Row: { id: string; source: string; external_id: string | null; sku: string | null; name: string; brand: string | null; category: string | null; description: string; ingredients_json: string; tags_json: string; price_cents: number | null; currency: string; url: string; image_url: string | null; in_stock: number; updated_at: string };
      Insert: { id: string; source: string; external_id?: string | null; sku?: string | null; name: string; brand?: string | null; category?: string | null; description?: string; ingredients_json?: string; tags_json?: string; price_cents?: number | null; currency?: string; url: string; image_url?: string | null; in_stock?: number; updated_at: string };
      Update: Partial<Database['public']['Tables']['catalogue_products']['Insert']>;
      Relationships: [];
    };
    catalogue_syncs: {
      Row: { id: string; source: string; store_url: string | null; imported: number; removed: number; error: string | null; started_at: string; finished_at: string | null };
      Insert: { id: string; source: string; store_url?: string | null; imported?: number; removed?: number; error?: string | null; started_at: string; finished_at?: string | null };
      Update: Partial<Database['public']['Tables']['catalogue_syncs']['Insert']>;
      Relationships: [];
    };
    consent_events: {
      Row: { id: string; event_sequence: number; user_id: string; consent_type: string; wording_version_id: string; state: string; recorded_at: string; actor_type: string | null; actor_id: string | null; metadata_json: Json | null; idempotency_key: string };
      Insert: { id: string; event_sequence?: number; user_id: string; consent_type: string; wording_version_id: string; state: string; recorded_at: string; actor_type?: string | null; actor_id?: string | null; metadata_json?: Json | null; idempotency_key: string };
      Update: Partial<Database['public']['Tables']['consent_events']['Insert']>;
      Relationships: [{ foreignKeyName: 'consent_events_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }];
    };
    rate_limit_buckets: {
      Row: { key_hash: string; count: number; reset_at: string };
      Insert: { key_hash: string; count: number; reset_at: string };
      Update: Partial<Database['public']['Tables']['rate_limit_buckets']['Insert']>;
      Relationships: [];
    };
    progress_photos: {
      Row: { id: string; user_id: string; skin_scan_id: string | null; blob_ref: string; created_at: string; captured_at: string; consent_event_id: string; presentation_json: string | null };
      Insert: { id: string; user_id: string; skin_scan_id?: string | null; blob_ref: string; created_at: string; captured_at: string; consent_event_id: string; presentation_json?: string | null };
      Update: Partial<Database['public']['Tables']['progress_photos']['Insert']>;
      Relationships: [{ foreignKeyName: 'progress_photos_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }, { foreignKeyName: 'progress_photos_skin_scan_id_fkey'; columns: ['skin_scan_id']; isOneToOne: false; referencedRelation: 'skin_scans'; referencedColumns: ['id'] }, { foreignKeyName: 'progress_photos_consent_event_id_fkey'; columns: ['consent_event_id']; isOneToOne: false; referencedRelation: 'consent_events'; referencedColumns: ['id'] }];
    };
    budget_reservations: {
      Row: { operation_id: string; user_id: string; day: string; provider: string; unit: string; estimated_units: number; status: string; actual_units: number | null; fail_reason: string | null; created_at: string; settled_at: string | null };
      Insert: { operation_id: string; user_id: string; day: string; provider: string; unit: string; estimated_units: number; status?: string; actual_units?: number | null; fail_reason?: string | null; created_at: string; settled_at?: string | null };
      Update: Partial<Database['public']['Tables']['budget_reservations']['Insert']>;
      Relationships: [];
    };
    };
    Views: {
      evia_current_consents: { Row: Database['public']['Tables']['consent_events']['Row']; Relationships: [] };
    };
    Functions: {
    evia_start_product_usage: { Args: { p_user_id: string; p_product_id: string; p_started_at: string; p_frequency: string | null; p_notes: string | null }; Returns: string };
    evia_prepare_registration: { Args: { p_hash: string; p_email: string; p_display_name: string; p_date_of_birth: string; p_terms_version: string; p_evidence: Json }; Returns: undefined };
    evia_discard_registration: { Args: { p_hash: string }; Returns: undefined };
    evia_auth_session_active: { Args: { p_user_id: string; p_session_id: string }; Returns: boolean };
    evia_prepare_recovery: { Args: { p_hash: string; p_user_id: string; p_session_id: string }; Returns: undefined };
    evia_consume_recovery: { Args: { p_hash: string; p_user_id: string; p_session_id: string }; Returns: boolean };
    evia_deletion_receipt: { Args: { p_user_id: string }; Returns: Json };

      evia_search_products: { Args: { p_query: string; p_user_id: string | null; p_limit: number }; Returns: Database['public']['Tables']['products']['Row'][] };

      evia_insert_skin_scan: { Args: { p_row: Json }; Returns: Json };
      evia_insert_body_scan: { Args: { p_row: Json }; Returns: Json };
      evia_delete_skin_scan: { Args: { p_user_id: string; p_id: string }; Returns: Json };
      evia_delete_body_scan: { Args: { p_user_id: string; p_id: string }; Returns: Json };
      evia_create_progress_photo: { Args: { p_row: Json }; Returns: Json };
      evia_delete_progress_photo: { Args: { p_user_id: string; p_id: string }; Returns: Json };

      evia_upsert_memory: { Args: { p_row: Json }; Returns: Json };
      evia_find_product_match: { Args: { p_name: string; p_brand: string | null; p_owner_id: string | null }; Returns: Database['public']['Tables']['products']['Row'][] };
      evia_find_catalogue_match: { Args: { p_source: string; p_name: string; p_brand: string | null }; Returns: Database['public']['Tables']['catalogue_products']['Row'][] };
      evia_consume_rate_bucket: { Args: { p_key_hash: string; p_now: string; p_expires: string }; Returns: Json };
      evia_sweep_rate_buckets: { Args: { p_now: string }; Returns: Json };
      evia_touch_voice_line: { Args: { p_key: string }; Returns: Json };
      evia_prune_voice_lines: { Args: { p_max_rows: number }; Returns: Json };
      evia_purge_voice_lines: { Args: { p_allowlist: string[]; p_apply: boolean }; Returns: Json };
      evia_budget_usage: { Args: { p_day: string; p_user_id: string }; Returns: Json };
      evia_budget_allowance: { Args: { p_day: string; p_user_id: string; p_user_cap: number; p_turn_cap: number; p_token_cap: number }; Returns: Json };
      evia_budget_reserve: { Args: { p_input: Json; p_user_cap: number; p_turn_cap: number; p_token_cap: number }; Returns: Json };
      evia_budget_transition: { Args: { p_operation_id: string; p_status: string; p_actual_units: number | null; p_fail_reason: string | null; p_input_tokens: number; p_output_tokens: number }; Returns: Json };
      evia_data_api_status: { Args: Record<string, never>; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
