-- Recreates the bonus quota RPC with the order expected by schema cache lookups.

CREATE OR REPLACE FUNCTION public.admin_company_bonus_quota_mutation(
  p_admin_id uuid,
  p_box_bonus integer,
  p_carton_bonus integer,
  p_company_id uuid,
  p_correlation_id text,
  p_endpoint text,
  p_hard_max integer,
  p_idempotency_key text,
  p_pallet_bonus integer,
  p_request_hash text,
  p_unit_bonus integer
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
