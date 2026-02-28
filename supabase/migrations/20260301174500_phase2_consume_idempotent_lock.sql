-- Phase 2 hardening patch:
-- - enforce global idempotency key uniqueness per company
-- - refactor consume_entitlement for strict lock + replay safety

DO $$
BEGIN
  IF to_regclass('public.entitlement_operation_log') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entitlement_operation_log_company_id_operation_request_id_key'
      AND conrelid = 'public.entitlement_operation_log'::regclass
  ) THEN
    ALTER TABLE public.entitlement_operation_log
      DROP CONSTRAINT entitlement_operation_log_company_id_operation_request_id_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entitlement_operation_log_company_id_request_id_key'
      AND conrelid = 'public.entitlement_operation_log'::regclass
  ) THEN
    ALTER TABLE public.entitlement_operation_log
      ADD CONSTRAINT entitlement_operation_log_company_id_request_id_key
      UNIQUE (company_id, request_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.consume_entitlement(
  p_company_id uuid,
  p_metric public.entitlement_key_enum,
  p_qty integer,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_snapshot jsonb;
  v_state text;
  v_remaining_before bigint;
  v_remaining_after bigint;
  v_base_limit int;
  v_base_used int;
  v_topup_to_consume bigint;
  v_base_to_consume int;
  v_metric_type text;
  v_period_start date;
  v_period_end date;
  v_left bigint;
  v_topup_row record;
  v_response jsonb;
  v_rowcount int := 0;
BEGIN
  IF p_request_id IS NULL OR btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'MISSING_REQUEST_ID';
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  IF p_metric NOT IN ('unit', 'box', 'carton', 'pallet') THEN
    RAISE EXCEPTION 'UNSUPPORTED_METRIC';
  END IF;

  -- Fast idempotency replay path.
  SELECT operation, response_json
  INTO v_existing
  FROM public.entitlement_operation_log e
  WHERE e.company_id = p_company_id
    AND e.request_id = p_request_id
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.operation = 'consume' THEN
      RETURN v_existing.response_json;
    END IF;
    RAISE EXCEPTION 'REQUEST_ID_ALREADY_USED';
  END IF;

  -- Company-scope lock to serialize parallel consumption safely.
  PERFORM 1
  FROM public.companies c
  WHERE c.id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  -- Also lock current active subscription row when present.
  PERFORM 1
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id
    AND lower(coalesce(cs.status::text, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due')
  FOR UPDATE;

  -- Re-check idempotency after lock to prevent race gap.
  SELECT operation, response_json
  INTO v_existing
  FROM public.entitlement_operation_log e
  WHERE e.company_id = p_company_id
    AND e.request_id = p_request_id
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.operation = 'consume' THEN
      RETURN v_existing.response_json;
    END IF;
    RAISE EXCEPTION 'REQUEST_ID_ALREADY_USED';
  END IF;

  v_snapshot := public.get_company_entitlement_snapshot(p_company_id, now());
  v_state := coalesce(v_snapshot->>'state', 'NO_ACTIVE_SUBSCRIPTION');

  IF v_state = 'TRIAL_EXPIRED' THEN
    RAISE EXCEPTION 'TRIAL_EXPIRED';
  END IF;
  IF v_state = 'NO_ACTIVE_SUBSCRIPTION' THEN
    RAISE EXCEPTION 'NO_ACTIVE_SUBSCRIPTION';
  END IF;

  v_remaining_before := coalesce((v_snapshot #>> ARRAY['remaining', p_metric::text])::bigint, 0);
  IF v_remaining_before < p_qty THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED';
  END IF;

  v_base_limit := coalesce((v_snapshot #>> ARRAY['limits', p_metric::text])::int, 0);
  v_base_used := coalesce((v_snapshot #>> ARRAY['usage', p_metric::text])::int, 0);
  v_base_to_consume := least(greatest(v_base_limit - v_base_used, 0), p_qty);
  v_topup_to_consume := p_qty - v_base_to_consume;

  v_metric_type := CASE
    WHEN p_metric = 'unit' THEN 'UNIT'
    WHEN p_metric = 'box' THEN 'BOX'
    WHEN p_metric = 'carton' THEN 'CARTON'
    WHEN p_metric = 'pallet' THEN 'SSCC'
  END;

  v_period_start := coalesce((v_snapshot->>'period_start')::date, current_date);
  v_period_end := coalesce((v_snapshot->>'period_end')::date, current_date);

  IF v_base_to_consume > 0 THEN
    INSERT INTO public.usage_counters (
      company_id,
      metric_type,
      period_start,
      period_end,
      used_quantity
    )
    VALUES (
      p_company_id,
      v_metric_type,
      v_period_start,
      v_period_end,
      v_base_to_consume
    )
    ON CONFLICT (company_id, metric_type, period_start)
    DO UPDATE
      SET used_quantity = public.usage_counters.used_quantity + EXCLUDED.used_quantity,
          period_end = EXCLUDED.period_end,
          updated_at = now();
  END IF;

  v_left := v_topup_to_consume;
  IF v_left > 0 THEN
    FOR v_topup_row IN
      SELECT cat.id, cat.purchased_quantity, cat.consumed_quantity
      FROM public.company_addon_topups cat
      WHERE cat.company_id = p_company_id
        AND cat.entitlement_key = p_metric
        AND cat.status IN ('paid', 'consumed')
        AND cat.purchased_quantity > cat.consumed_quantity
      ORDER BY cat.created_at, cat.id
      FOR UPDATE
    LOOP
      EXIT WHEN v_left <= 0;
      UPDATE public.company_addon_topups
      SET
        consumed_quantity = consumed_quantity + least(v_left, purchased_quantity - consumed_quantity),
        status = CASE
          WHEN consumed_quantity + least(v_left, purchased_quantity - consumed_quantity) >= purchased_quantity THEN 'consumed'
          ELSE status
        END,
        updated_at = now()
      WHERE id = v_topup_row.id;

      v_left := v_left - least(v_left, v_topup_row.purchased_quantity - v_topup_row.consumed_quantity);
    END LOOP;

    IF v_left > 0 THEN
      RAISE EXCEPTION 'QUOTA_EXCEEDED';
    END IF;
  END IF;

  v_remaining_after := v_remaining_before - p_qty;
  v_response := jsonb_build_object(
    'ok', true,
    'metric', p_metric,
    'consumed', p_qty,
    'remaining', greatest(v_remaining_after, 0),
    'base_consumed', v_base_to_consume,
    'topup_consumed', v_topup_to_consume
  );

  INSERT INTO public.entitlement_operation_log (
    company_id,
    operation,
    request_id,
    metric,
    quantity,
    response_json
  )
  VALUES (
    p_company_id,
    'consume',
    p_request_id,
    p_metric,
    p_qty,
    v_response
  )
  ON CONFLICT (company_id, request_id) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount = 0 THEN
    SELECT operation, response_json
    INTO v_existing
    FROM public.entitlement_operation_log e
    WHERE e.company_id = p_company_id
      AND e.request_id = p_request_id
    LIMIT 1;

    IF FOUND AND v_existing.operation = 'consume' THEN
      RETURN v_existing.response_json;
    END IF;
    RAISE EXCEPTION 'REQUEST_ID_ALREADY_USED';
  END IF;

  RETURN v_response;
END;
$$;
