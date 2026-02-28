-- STEP 6 HARDENING: transactional mutation RPCs for admin company actions

ALTER TABLE public.admin_idempotency_keys
  ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE OR REPLACE FUNCTION public.admin_company_freeze_mutation(
  p_company_id uuid,
  p_admin_id uuid,
  p_endpoint text,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id text,
  p_freeze boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_before public.companies%ROWTYPE;
  v_company_after public.companies%ROWTYPE;
  v_wallet_status text;
  v_is_frozen boolean;
  v_payload jsonb;
  v_existing record;
BEGIN
  SELECT * INTO v_company_before
  FROM public.companies
  WHERE id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  SELECT status = 'FROZEN' INTO v_is_frozen
  FROM public.company_wallets
  WHERE company_id = p_company_id
  LIMIT 1;
  v_is_frozen := COALESCE(v_is_frozen, false);

  IF (p_freeze AND v_is_frozen) OR ((NOT p_freeze) AND (NOT v_is_frozen)) THEN
    v_payload := jsonb_build_object(
      'success', true,
      'company_id', p_company_id,
      'frozen', p_freeze,
      'already_in_state', true,
      'freeze_reason', CASE WHEN p_freeze THEN COALESCE(p_reason, v_company_before.freeze_reason, 'Frozen by admin') ELSE NULL END
    );

    BEGIN
      INSERT INTO public.admin_idempotency_keys (
        admin_id, endpoint, idempotency_key, request_hash,
        response_snapshot_json, status_code, correlation_id, created_at
      )
      VALUES (
        p_admin_id, p_endpoint, p_idempotency_key, p_request_hash,
        v_payload, 200, p_correlation_id, now()
      );
    EXCEPTION WHEN unique_violation THEN
      SELECT request_hash, response_snapshot_json, status_code
      INTO v_existing
      FROM public.admin_idempotency_keys
      WHERE admin_id = p_admin_id AND endpoint = p_endpoint AND idempotency_key = p_idempotency_key;

      IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
        RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
      END IF;
      RETURN v_existing.response_snapshot_json;
    END;

    RETURN v_payload;
  END IF;

  UPDATE public.companies
  SET freeze_reason = CASE WHEN p_freeze THEN COALESCE(NULLIF(p_reason, ''), 'Frozen by admin') ELSE NULL END,
      updated_at = now()
  WHERE id = p_company_id;

  INSERT INTO public.company_wallets (company_id, status, updated_at)
  VALUES (p_company_id, CASE WHEN p_freeze THEN 'FROZEN' ELSE 'ACTIVE' END, now())
  ON CONFLICT (company_id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;

  SELECT * INTO v_company_after
  FROM public.companies
  WHERE id = p_company_id;

  v_wallet_status := CASE WHEN p_freeze THEN 'FROZEN' ELSE 'ACTIVE' END;
  v_payload := jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'frozen', p_freeze,
    'freeze_reason', CASE WHEN p_freeze THEN COALESCE(NULLIF(p_reason, ''), 'Frozen by admin') ELSE NULL END,
    'wallet_status', v_wallet_status
  );

  INSERT INTO public.audit_logs (
    action, company_id, actor, performed_by, status,
    old_value, new_value, before_state_json, after_state_json,
    entity_type, entity_id, correlation_id, metadata, created_at
  )
  VALUES (
    CASE WHEN p_freeze THEN 'COMPANY_FREEZE' ELSE 'COMPANY_UNFREEZE' END,
    p_company_id,
    p_admin_id,
    p_admin_id,
    'success',
    to_jsonb(v_company_before),
    to_jsonb(v_company_after),
    jsonb_build_object('company', to_jsonb(v_company_before), 'wallet_status', CASE WHEN v_is_frozen THEN 'FROZEN' ELSE 'ACTIVE' END),
    jsonb_build_object('company', to_jsonb(v_company_after), 'wallet_status', v_wallet_status),
    'company',
    p_company_id::text,
    p_correlation_id,
    jsonb_build_object('endpoint', p_endpoint),
    now()
  );

  BEGIN
    INSERT INTO public.admin_idempotency_keys (
      admin_id, endpoint, idempotency_key, request_hash,
      response_snapshot_json, status_code, correlation_id, created_at
    )
    VALUES (
      p_admin_id, p_endpoint, p_idempotency_key, p_request_hash,
      v_payload, 200, p_correlation_id, now()
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT request_hash, response_snapshot_json, status_code
    INTO v_existing
    FROM public.admin_idempotency_keys
    WHERE admin_id = p_admin_id AND endpoint = p_endpoint AND idempotency_key = p_idempotency_key;

    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.response_snapshot_json;
  END;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_company_reset_trial_mutation(
  p_company_id uuid,
  p_admin_id uuid,
  p_endpoint text,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_before public.companies%ROWTYPE;
  v_company_after public.companies%ROWTYPE;
  v_trials_before jsonb;
  v_trials_after jsonb;
  v_reset_count integer;
  v_payload jsonb;
  v_existing record;
BEGIN
  SELECT * INTO v_company_before
  FROM public.companies
  WHERE id = p_company_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF lower(coalesce(v_company_before.subscription_status, '')) <> 'trial' THEN
    RAISE EXCEPTION 'INVALID_TRIAL_STATE';
  END IF;

  IF v_company_before.trial_end_date IS NOT NULL
     AND now() - v_company_before.trial_end_date > interval '30 days' THEN
    RAISE EXCEPTION 'TRIAL_RESET_WINDOW_EXCEEDED';
  END IF;

  SELECT count(*)::int INTO v_reset_count
  FROM public.trial_reset_logs
  WHERE company_id = p_company_id;

  IF v_reset_count > 0 THEN
    RAISE EXCEPTION 'TRIAL_ALREADY_RESET';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) INTO v_trials_before
  FROM public.company_trials t
  WHERE t.company_id = p_company_id;

  DELETE FROM public.company_trials
  WHERE company_id = p_company_id;

  UPDATE public.companies
  SET trial_start_date = NULL,
      trial_end_date = NULL,
      trial_activated_at = NULL,
      updated_at = now()
  WHERE id = p_company_id;

  INSERT INTO public.trial_reset_logs (company_id, reset_by, reason)
  VALUES (p_company_id, p_admin_id, p_reason);

  SELECT * INTO v_company_after
  FROM public.companies
  WHERE id = p_company_id;

  SELECT coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) INTO v_trials_after
  FROM public.company_trials t
  WHERE t.company_id = p_company_id;

  v_payload := jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'message', 'Trial reset completed'
  );

  INSERT INTO public.audit_logs (
    action, company_id, actor, performed_by, status,
    old_value, new_value, before_state_json, after_state_json,
    entity_type, entity_id, correlation_id, metadata, created_at
  )
  VALUES (
    'TRIAL_RESET',
    p_company_id,
    p_admin_id,
    p_admin_id,
    'success',
    to_jsonb(v_company_before),
    to_jsonb(v_company_after),
    jsonb_build_object('company', to_jsonb(v_company_before), 'company_trials', v_trials_before),
    jsonb_build_object('company', to_jsonb(v_company_after), 'company_trials', v_trials_after),
    'company',
    p_company_id::text,
    p_correlation_id,
    jsonb_build_object('endpoint', p_endpoint, 'reason', p_reason),
    now()
  );

  BEGIN
    INSERT INTO public.admin_idempotency_keys (
      admin_id, endpoint, idempotency_key, request_hash,
      response_snapshot_json, status_code, correlation_id, created_at
    )
    VALUES (
      p_admin_id, p_endpoint, p_idempotency_key, p_request_hash,
      v_payload, 200, p_correlation_id, now()
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT request_hash, response_snapshot_json, status_code
    INTO v_existing
    FROM public.admin_idempotency_keys
    WHERE admin_id = p_admin_id AND endpoint = p_endpoint AND idempotency_key = p_idempotency_key;

    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.response_snapshot_json;
  END;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_company_soft_delete_mutation(
  p_company_id uuid,
  p_admin_id uuid,
  p_endpoint text,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_before public.companies%ROWTYPE;
  v_company_after public.companies%ROWTYPE;
  v_active_count integer;
  v_payload jsonb;
  v_existing record;
BEGIN
  SELECT * INTO v_company_before
  FROM public.companies
  WHERE id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company_before.deleted_at IS NOT NULL THEN
    v_payload := jsonb_build_object(
      'success', true,
      'company_id', p_company_id,
      'already_deleted', true,
      'deleted_at', v_company_before.deleted_at
    );

    BEGIN
      INSERT INTO public.admin_idempotency_keys (
        admin_id, endpoint, idempotency_key, request_hash,
        response_snapshot_json, status_code, correlation_id, created_at
      )
      VALUES (
        p_admin_id, p_endpoint, p_idempotency_key, p_request_hash,
        v_payload, 200, p_correlation_id, now()
      );
    EXCEPTION WHEN unique_violation THEN
      SELECT request_hash, response_snapshot_json, status_code
      INTO v_existing
      FROM public.admin_idempotency_keys
      WHERE admin_id = p_admin_id AND endpoint = p_endpoint AND idempotency_key = p_idempotency_key;
      IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
        RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
      END IF;
      RETURN v_existing.response_snapshot_json;
    END;

    RETURN v_payload;
  END IF;

  SELECT count(*)::int INTO v_active_count
  FROM public.company_subscriptions
  WHERE company_id = p_company_id
    AND lower(coalesce(status, '')) IN ('active', 'trial', 'grace');

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_EXISTS';
  END IF;

  UPDATE public.companies
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_company_id;

  SELECT * INTO v_company_after
  FROM public.companies
  WHERE id = p_company_id;

  v_payload := jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'deleted_at', v_company_after.deleted_at
  );

  INSERT INTO public.audit_logs (
    action, company_id, actor, performed_by, status,
    old_value, new_value, before_state_json, after_state_json,
    entity_type, entity_id, correlation_id, metadata, created_at
  )
  VALUES (
    'COMPANY_SOFT_DELETE',
    p_company_id,
    p_admin_id,
    p_admin_id,
    'success',
    to_jsonb(v_company_before),
    to_jsonb(v_company_after),
    to_jsonb(v_company_before),
    to_jsonb(v_company_after),
    'company',
    p_company_id::text,
    p_correlation_id,
    jsonb_build_object('endpoint', p_endpoint),
    now()
  );

  BEGIN
    INSERT INTO public.admin_idempotency_keys (
      admin_id, endpoint, idempotency_key, request_hash,
      response_snapshot_json, status_code, correlation_id, created_at
    )
    VALUES (
      p_admin_id, p_endpoint, p_idempotency_key, p_request_hash,
      v_payload, 200, p_correlation_id, now()
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT request_hash, response_snapshot_json, status_code
    INTO v_existing
    FROM public.admin_idempotency_keys
    WHERE admin_id = p_admin_id AND endpoint = p_endpoint AND idempotency_key = p_idempotency_key;
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.response_snapshot_json;
  END;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_company_bonus_quota_mutation(
  p_company_id uuid,
  p_admin_id uuid,
  p_endpoint text,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id text,
  p_unit_bonus integer,
  p_box_bonus integer,
  p_carton_bonus integer,
  p_pallet_bonus integer,
  p_hard_max integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_exists boolean;
  v_before jsonb;
  v_after jsonb;
  v_inserted public.company_bonus_quota%ROWTYPE;
  v_payload jsonb;
  v_existing record;
BEGIN
  IF p_unit_bonus IS NULL OR p_box_bonus IS NULL OR p_carton_bonus IS NULL OR p_pallet_bonus IS NULL THEN
    RAISE EXCEPTION 'INVALID_QUOTA_TYPE';
  END IF;
  IF p_unit_bonus < 0 OR p_box_bonus < 0 OR p_carton_bonus < 0 OR p_pallet_bonus < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_QUOTA_NOT_ALLOWED';
  END IF;
  IF p_unit_bonus > p_hard_max OR p_box_bonus > p_hard_max OR p_carton_bonus > p_hard_max OR p_pallet_bonus > p_hard_max THEN
    RAISE EXCEPTION 'QUOTA_HARD_MAX_EXCEEDED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.companies WHERE id = p_company_id AND deleted_at IS NULL
  ) INTO v_company_exists;
  IF NOT v_company_exists THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  SELECT jsonb_build_object(
    'rows', coalesce(jsonb_agg(to_jsonb(cbq.*)), '[]'::jsonb),
    'totals', jsonb_build_object(
      'unit_bonus', coalesce(sum(cbq.unit_bonus), 0),
      'box_bonus', coalesce(sum(cbq.box_bonus), 0),
      'carton_bonus', coalesce(sum(cbq.carton_bonus), 0),
      'pallet_bonus', coalesce(sum(cbq.pallet_bonus), 0)
    )
  )
  INTO v_before
  FROM public.company_bonus_quota cbq
  WHERE cbq.company_id = p_company_id;

  INSERT INTO public.company_bonus_quota (
    company_id, unit_bonus, box_bonus, carton_bonus, pallet_bonus, allocated_by, created_at
  )
  VALUES (
    p_company_id, p_unit_bonus, p_box_bonus, p_carton_bonus, p_pallet_bonus, p_admin_id, now()
  )
  RETURNING * INTO v_inserted;

  SELECT jsonb_build_object(
    'rows', coalesce(jsonb_agg(to_jsonb(cbq.*)), '[]'::jsonb),
    'totals', jsonb_build_object(
      'unit_bonus', coalesce(sum(cbq.unit_bonus), 0),
      'box_bonus', coalesce(sum(cbq.box_bonus), 0),
      'carton_bonus', coalesce(sum(cbq.carton_bonus), 0),
      'pallet_bonus', coalesce(sum(cbq.pallet_bonus), 0)
    )
  )
  INTO v_after
  FROM public.company_bonus_quota cbq
  WHERE cbq.company_id = p_company_id;

  v_payload := jsonb_build_object(
    'success', true,
    'allocation', to_jsonb(v_inserted)
  );

  INSERT INTO public.audit_logs (
    action, company_id, actor, performed_by, status,
    old_value, new_value, before_state_json, after_state_json,
    entity_type, entity_id, correlation_id, metadata, created_at
  )
  VALUES (
    'COMPANY_BONUS_QUOTA_ALLOCATED',
    p_company_id,
    p_admin_id,
    p_admin_id,
    'success',
    v_before,
    v_after,
    v_before,
    v_after,
    'company_bonus_quota',
    v_inserted.id::text,
    p_correlation_id,
    jsonb_build_object('endpoint', p_endpoint),
    now()
  );

  BEGIN
    INSERT INTO public.admin_idempotency_keys (
      admin_id, endpoint, idempotency_key, request_hash,
      response_snapshot_json, status_code, correlation_id, created_at
    )
    VALUES (
      p_admin_id, p_endpoint, p_idempotency_key, p_request_hash,
      v_payload, 200, p_correlation_id, now()
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT request_hash, response_snapshot_json, status_code
    INTO v_existing
    FROM public.admin_idempotency_keys
    WHERE admin_id = p_admin_id AND endpoint = p_endpoint AND idempotency_key = p_idempotency_key;
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing.response_snapshot_json;
  END;

  RETURN v_payload;
END;
$$;
