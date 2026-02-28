-- Fix freeze mutation audit insert for environments where audit_logs.company_id is NOT NULL.
-- Ensures audit company_id is always resolved from locked company row.

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
  v_audit_company_id uuid;
BEGIN
  SELECT * INTO v_company_before
  FROM public.companies
  WHERE id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  v_audit_company_id := COALESCE(v_company_before.id, p_company_id);
  IF v_audit_company_id IS NULL THEN
    RAISE EXCEPTION 'AUDIT_COMPANY_ID_NULL';
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

  v_audit_company_id := COALESCE(v_company_after.id, v_audit_company_id);
  IF v_audit_company_id IS NULL THEN
    RAISE EXCEPTION 'AUDIT_COMPANY_ID_NULL';
  END IF;

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
    v_audit_company_id,
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
