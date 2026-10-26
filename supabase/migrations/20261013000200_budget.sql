-- Budget is one state machine: ledger fence -> GLOBAL day lock -> reservation.
-- Never join this family to users, and never hold a transaction across provider I/O.
CREATE SCHEMA evia_private;

CREATE FUNCTION evia_private.now_iso() RETURNS text
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

CREATE FUNCTION evia_private.budget_usage(p_day text, p_user_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE ledger_turns numeric; ledger_tokens numeric; mine numeric;
  pending_all numeric; pending_tokens numeric; pending_mine numeric;
BEGIN
  SELECT coalesce(sum(turns), 0), coalesce(sum(input_tokens + output_tokens), 0)
    INTO ledger_turns, ledger_tokens FROM public.usage_ledger WHERE day = p_day;
  SELECT coalesce(turns, 0) INTO mine FROM public.usage_ledger WHERE day = p_day AND user_id = p_user_id;
  SELECT count(*), coalesce(sum(CASE WHEN unit = 'chat-tokens' THEN estimated_units ELSE 0 END), 0)
    INTO pending_all, pending_tokens FROM public.budget_reservations WHERE day = p_day AND status = 'pending';
  SELECT count(*) INTO pending_mine FROM public.budget_reservations
    WHERE day = p_day AND user_id = p_user_id AND status = 'pending';
  RETURN jsonb_build_object('userLedgerTurns', coalesce(mine, 0), 'userPendingTurns', pending_mine,
    'globalLedgerTurns', ledger_turns, 'globalPendingTurns', pending_all,
    'globalLedgerTokens', ledger_tokens, 'globalPendingTokenEstimates', pending_tokens);
END;
$$;

CREATE FUNCTION evia_private.budget_reason(p_usage jsonb, p_estimate bigint, p_unit text,
  p_user_cap numeric, p_turn_cap numeric, p_token_cap numeric) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN (p_usage->>'userLedgerTurns')::numeric + (p_usage->>'userPendingTurns')::numeric >= p_user_cap THEN 'user_turns'
    WHEN (p_usage->>'globalLedgerTurns')::numeric + (p_usage->>'globalPendingTurns')::numeric >= p_turn_cap THEN 'global_turns'
    WHEN (p_usage->>'globalLedgerTokens')::numeric + (p_usage->>'globalPendingTokenEstimates')::numeric
      + CASE WHEN p_unit = 'chat-tokens' THEN p_estimate ELSE 0 END > p_token_cap THEN 'global_tokens'
    ELSE '' END;
$$;

CREATE FUNCTION evia_private.assert_budget_replay(r public.budget_reservations, p_input jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF r.user_id IS DISTINCT FROM p_input->>'userId' OR r.day IS DISTINCT FROM p_input->>'day'
    OR r.provider IS DISTINCT FROM p_input->>'provider' OR r.unit IS DISTINCT FROM p_input->>'unit'
    OR r.estimated_units IS DISTINCT FROM (p_input->>'estimatedUnits')::bigint THEN
    RAISE EXCEPTION USING ERRCODE = 'EV001', MESSAGE = 'operationId is already reserved for different operation parameters.';
  END IF;
END;
$$;

CREATE FUNCTION public.evia_budget_usage(p_day text, p_user_id text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT evia_private.budget_usage(p_day, p_user_id);
$$;

CREATE FUNCTION public.evia_budget_allowance(p_day text, p_user_id text,
  p_user_cap numeric, p_turn_cap numeric, p_token_cap numeric) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE reason text;
BEGIN
  reason := evia_private.budget_reason(evia_private.budget_usage(p_day, p_user_id), 0, 'chat-tokens',
    p_user_cap, p_turn_cap, p_token_cap);
  RETURN jsonb_build_object('ok', reason = '', 'reason', reason);
END;
$$;

CREATE FUNCTION public.evia_budget_reserve(p_input jsonb, p_user_cap numeric, p_turn_cap numeric, p_token_cap numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.budget_reservations; reason text; inserted boolean;
  op text := p_input->>'operationId'; usr text := p_input->>'userId'; day_key text := p_input->>'day';
BEGIN
  SELECT * INTO r FROM public.budget_reservations WHERE operation_id = op;
  IF FOUND THEN
    PERFORM evia_private.assert_budget_replay(r, p_input);
    RETURN jsonb_build_object('ok', true, 'reservation', to_jsonb(r), 'duplicate', true);
  END IF;
  INSERT INTO public.usage_ledger (day, user_id, turns, input_tokens, output_tokens, updated_at)
    VALUES (day_key, usr, 0, 0, 0, evia_private.now_iso()) ON CONFLICT (day, user_id) DO NOTHING;
  PERFORM turns FROM public.usage_ledger WHERE day = day_key AND user_id = usr FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtext('budget-reservation:' || day_key));
  -- Fresh statement snapshot AFTER waiting, not a lock/read CTE snapshot.
  SELECT * INTO r FROM public.budget_reservations WHERE operation_id = op;
  IF FOUND THEN
    PERFORM evia_private.assert_budget_replay(r, p_input);
    RETURN jsonb_build_object('ok', true, 'reservation', to_jsonb(r), 'duplicate', true);
  END IF;
  reason := evia_private.budget_reason(evia_private.budget_usage(day_key, usr),
    (p_input->>'estimatedUnits')::bigint, p_input->>'unit', p_user_cap, p_turn_cap, p_token_cap);
  IF reason <> '' THEN RETURN jsonb_build_object('ok', false, 'reason', reason); END IF;
  INSERT INTO public.budget_reservations (operation_id, user_id, day, provider, unit, estimated_units, status, created_at)
    VALUES (op, usr, day_key, p_input->>'provider', p_input->>'unit', (p_input->>'estimatedUnits')::bigint,
      'pending', evia_private.now_iso()) ON CONFLICT (operation_id) DO NOTHING;
  inserted := FOUND;
  SELECT * INTO r FROM public.budget_reservations WHERE operation_id = op;
  PERFORM evia_private.assert_budget_replay(r, p_input);
  RETURN jsonb_build_object('ok', true, 'reservation', to_jsonb(r), 'duplicate', NOT inserted);
END;
$$;

CREATE FUNCTION public.evia_budget_transition(p_operation_id text, p_status text, p_actual_units bigint,
  p_fail_reason text, p_input_tokens bigint, p_output_tokens bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.budget_reservations; settled text;
BEGIN
  SELECT * INTO r FROM public.budget_reservations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown_operation'); END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'reservation', to_jsonb(r), 'duplicate', true);
  END IF;
  IF p_status NOT IN ('settled', 'refunded', 'failed') THEN RAISE EXCEPTION 'Invalid reservation transition'; END IF;
  INSERT INTO public.usage_ledger (day, user_id, turns, input_tokens, output_tokens, updated_at)
    VALUES (r.day, r.user_id, 0, 0, 0, evia_private.now_iso()) ON CONFLICT (day, user_id) DO NOTHING;
  PERFORM turns FROM public.usage_ledger WHERE day = r.day AND user_id = r.user_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtext('budget-reservation:' || r.day));
  SELECT * INTO r FROM public.budget_reservations WHERE operation_id = p_operation_id FOR UPDATE;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'reservation', to_jsonb(r), 'duplicate', true);
  END IF;
  settled := evia_private.now_iso();
  UPDATE public.budget_reservations SET status = p_status, actual_units = p_actual_units,
    fail_reason = p_fail_reason, settled_at = settled WHERE operation_id = p_operation_id AND status = 'pending';
  IF p_status = 'settled' THEN
    UPDATE public.usage_ledger SET turns = turns + 1, input_tokens = input_tokens + p_input_tokens,
      output_tokens = output_tokens + p_output_tokens, updated_at = settled WHERE day = r.day AND user_id = r.user_id;
  END IF;
  SELECT * INTO r FROM public.budget_reservations WHERE operation_id = p_operation_id;
  RETURN jsonb_build_object('ok', true, 'reservation', to_jsonb(r), 'duplicate', false);
END;
$$;
