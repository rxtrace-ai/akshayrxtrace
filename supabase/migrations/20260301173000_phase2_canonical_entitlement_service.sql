-- Phase 2: Canonical entitlement service (single-source read/write contract)
-- Adds:
-- - get_company_entitlement_snapshot(company_id, at_time)
-- - consume_entitlement(company_id, metric, qty, request_id)
-- - refund_entitlement(company_id, metric, qty, request_id)
-- - apply_cycle_reset(company_id, new_period_start, new_period_end)

CREATE TABLE IF NOT EXISTS public.entitlement_operation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('consume', 'refund', 'cycle_reset')),
  request_id text NOT NULL,
  metric public.entitlement_key_enum,
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, operation, request_id)
);

CREATE INDEX IF NOT EXISTS entitlement_operation_log_company_created_idx
  ON public.entitlement_operation_log (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_type text NOT NULL CHECK (metric_type IN ('UNIT', 'BOX', 'CARTON', 'SSCC', 'API')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  used_quantity integer NOT NULL DEFAULT 0 CHECK (used_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, metric_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_company_period
  ON public.usage_counters (company_id, period_start DESC, metric_type);

CREATE OR REPLACE FUNCTION public.get_company_entitlement_snapshot(
  p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company record;
  v_subscription record;
  v_plan record;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_trial_active boolean := false;
  v_trial_expired boolean := false;
  v_state text := 'NO_ACTIVE_SUBSCRIPTION';
  v_base_unit int := 0;
  v_base_box int := 0;
  v_base_carton int := 0;
  v_base_pallet int := 0;
  v_base_seat int := 0;
  v_base_plant int := 0;
  v_base_handset int := 0;
  v_addon_seat int := 0;
  v_addon_plant int := 0;
  v_addon_handset int := 0;
  v_usage_unit int := 0;
  v_usage_box int := 0;
  v_usage_carton int := 0;
  v_usage_pallet int := 0;
  v_active_seat int := 0;
  v_active_plant int := 0;
  v_active_handset int := 0;
  v_topup_unit bigint := 0;
  v_topup_box bigint := 0;
  v_topup_carton bigint := 0;
  v_topup_pallet bigint := 0;
  v_limits jsonb;
  v_usage jsonb;
  v_topups jsonb;
  v_remaining jsonb;
BEGIN
  SELECT
    c.id,
    c.deleted_at,
    c.trial_started_at,
    c.trial_expires_at
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'state', 'COMPANY_DELETED',
      'trial_active', false,
      'trial_expires_at', null,
      'period_start', null,
      'period_end', null,
      'limits', jsonb_build_object('unit', 0, 'box', 0, 'carton', 0, 'pallet', 0, 'seat', 0, 'plant', 0, 'handset', 0),
      'usage', jsonb_build_object('unit', 0, 'box', 0, 'carton', 0, 'pallet', 0, 'seat', 0, 'plant', 0, 'handset', 0),
      'topups', jsonb_build_object('unit', 0, 'box', 0, 'carton', 0, 'pallet', 0),
      'remaining', jsonb_build_object('unit', 0, 'box', 0, 'carton', 0, 'pallet', 0, 'seat', 0, 'plant', 0, 'handset', 0),
      'blocked', true,
      'reason', 'COMPANY_DELETED'
    );
  END IF;

  v_trial_active := (
    v_company.trial_started_at IS NOT NULL
    AND v_company.trial_expires_at IS NOT NULL
    AND p_at >= v_company.trial_started_at
    AND p_at <= v_company.trial_expires_at
  );

  v_trial_expired := (
    v_company.trial_started_at IS NOT NULL
    AND v_company.trial_expires_at IS NOT NULL
    AND p_at > v_company.trial_expires_at
  );

  SELECT cs.*
  INTO v_subscription
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id
    AND lower(coalesce(cs.status::text, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due')
  ORDER BY cs.updated_at DESC NULLS LAST, cs.created_at DESC
  LIMIT 1;

  IF v_trial_active THEN
    v_state := 'TRIAL_ACTIVE';
    v_period_start := v_company.trial_started_at;
    v_period_end := v_company.trial_expires_at;
    v_base_unit := 5000;
    v_base_box := 500;
    v_base_carton := 100;
    v_base_pallet := 25;
    v_base_seat := 5;
    v_base_plant := 2;
    v_base_handset := 0;
  ELSIF v_subscription.id IS NOT NULL THEN
    v_state := 'PAID_ACTIVE';
    v_period_start := COALESCE(v_subscription.current_period_start, date_trunc('month', p_at));
    v_period_end := COALESCE(v_subscription.current_period_end, date_trunc('month', p_at) + interval '1 month');

    IF v_subscription.plan_version_id IS NOT NULL THEN
      SELECT
        spv.unit_limit,
        spv.box_limit,
        spv.carton_limit,
        spv.pallet_limit,
        spv.seat_limit,
        spv.plant_limit,
        spv.handset_limit
      INTO v_plan
      FROM public.subscription_plan_versions spv
      WHERE spv.id = v_subscription.plan_version_id;
    END IF;

    v_base_unit := coalesce(v_plan.unit_limit, 0);
    v_base_box := coalesce(v_plan.box_limit, 0);
    v_base_carton := coalesce(v_plan.carton_limit, 0);
    v_base_pallet := coalesce(v_plan.pallet_limit, 0);
    v_base_seat := coalesce(v_plan.seat_limit, 0);
    v_base_plant := coalesce(v_plan.plant_limit, 0);
    v_base_handset := coalesce(v_plan.handset_limit, 0);
  ELSIF v_trial_expired THEN
    v_state := 'TRIAL_EXPIRED';
    v_period_start := v_company.trial_started_at;
    v_period_end := v_company.trial_expires_at;
  ELSE
    v_state := 'NO_ACTIVE_SUBSCRIPTION';
    v_period_start := date_trunc('month', p_at);
    v_period_end := date_trunc('month', p_at) + interval '1 month';
  END IF;

  SELECT
    coalesce(sum(CASE WHEN ao.entitlement_key = 'seat' THEN cas.quantity ELSE 0 END), 0)::int,
    coalesce(sum(CASE WHEN ao.entitlement_key = 'plant' THEN cas.quantity ELSE 0 END), 0)::int,
    coalesce(sum(CASE WHEN ao.entitlement_key = 'handset' THEN cas.quantity ELSE 0 END), 0)::int
  INTO v_addon_seat, v_addon_plant, v_addon_handset
  FROM public.company_addon_subscriptions cas
  JOIN public.add_ons ao ON ao.id = cas.addon_id
  WHERE cas.company_id = p_company_id
    AND cas.status = 'active'
    AND ao.addon_kind = 'structural'
    AND ao.billing_mode = 'recurring';

  IF to_regclass('public.usage_events') IS NOT NULL THEN
    SELECT
      coalesce(sum(CASE WHEN ue.metric_type = 'UNIT' THEN ue.quantity ELSE 0 END), 0)::int,
      coalesce(sum(CASE WHEN ue.metric_type = 'BOX' THEN ue.quantity ELSE 0 END), 0)::int,
      coalesce(sum(CASE WHEN ue.metric_type = 'CARTON' THEN ue.quantity ELSE 0 END), 0)::int,
      coalesce(sum(CASE WHEN ue.metric_type = 'SSCC' THEN ue.quantity ELSE 0 END), 0)::int
    INTO v_usage_unit, v_usage_box, v_usage_carton, v_usage_pallet
    FROM public.usage_events ue
    WHERE ue.company_id = p_company_id
      AND ue.created_at >= v_period_start
      AND ue.created_at < v_period_end;
  ELSE
    SELECT
      coalesce(sum(CASE WHEN uc.metric_type = 'UNIT' THEN uc.used_quantity ELSE 0 END), 0)::int,
      coalesce(sum(CASE WHEN uc.metric_type = 'BOX' THEN uc.used_quantity ELSE 0 END), 0)::int,
      coalesce(sum(CASE WHEN uc.metric_type = 'CARTON' THEN uc.used_quantity ELSE 0 END), 0)::int,
      coalesce(sum(CASE WHEN uc.metric_type = 'SSCC' THEN uc.used_quantity ELSE 0 END), 0)::int
    INTO v_usage_unit, v_usage_box, v_usage_carton, v_usage_pallet
    FROM public.usage_counters uc
    WHERE uc.company_id = p_company_id
      AND uc.period_start >= v_period_start::date
      AND uc.period_start <= v_period_end::date;
  END IF;

  SELECT count(*)::int INTO v_active_seat
  FROM public.seats s
  WHERE s.company_id = p_company_id
    AND s.status = 'active'
    AND coalesce(s.active, false) = true;

  SELECT count(*)::int INTO v_active_plant
  FROM public.plants p
  WHERE p.company_id = p_company_id
    AND p.status = 'active';

  IF to_regclass('public.handset') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT count(*)::int
      FROM public.handset h
      WHERE h.company_id = $1
        AND lower(coalesce(h.status, 'active')) = 'active'
    $sql$
    INTO v_active_handset
    USING p_company_id;
  ELSE
    v_active_handset := 0;
  END IF;

  SELECT
    coalesce(sum(CASE WHEN cat.entitlement_key = 'unit' THEN greatest(cat.purchased_quantity - cat.consumed_quantity, 0) ELSE 0 END), 0),
    coalesce(sum(CASE WHEN cat.entitlement_key = 'box' THEN greatest(cat.purchased_quantity - cat.consumed_quantity, 0) ELSE 0 END), 0),
    coalesce(sum(CASE WHEN cat.entitlement_key = 'carton' THEN greatest(cat.purchased_quantity - cat.consumed_quantity, 0) ELSE 0 END), 0),
    coalesce(sum(CASE WHEN cat.entitlement_key = 'pallet' THEN greatest(cat.purchased_quantity - cat.consumed_quantity, 0) ELSE 0 END), 0)
  INTO v_topup_unit, v_topup_box, v_topup_carton, v_topup_pallet
  FROM public.company_addon_topups cat
  WHERE cat.company_id = p_company_id
    AND cat.status IN ('paid', 'consumed');

  v_limits := jsonb_build_object(
    'unit', greatest(v_base_unit, 0),
    'box', greatest(v_base_box, 0),
    'carton', greatest(v_base_carton, 0),
    'pallet', greatest(v_base_pallet, 0),
    'seat', greatest(v_base_seat + v_addon_seat, 0),
    'plant', greatest(v_base_plant + v_addon_plant, 0),
    'handset', greatest(v_base_handset + v_addon_handset, 0)
  );

  v_usage := jsonb_build_object(
    'unit', greatest(v_usage_unit, 0),
    'box', greatest(v_usage_box, 0),
    'carton', greatest(v_usage_carton, 0),
    'pallet', greatest(v_usage_pallet, 0),
    'seat', greatest(v_active_seat, 0),
    'plant', greatest(v_active_plant, 0),
    'handset', greatest(v_active_handset, 0)
  );

  v_topups := jsonb_build_object(
    'unit', greatest(v_topup_unit, 0),
    'box', greatest(v_topup_box, 0),
    'carton', greatest(v_topup_carton, 0),
    'pallet', greatest(v_topup_pallet, 0)
  );

  v_remaining := jsonb_build_object(
    'unit', greatest(v_base_unit - v_usage_unit, 0) + greatest(v_topup_unit, 0),
    'box', greatest(v_base_box - v_usage_box, 0) + greatest(v_topup_box, 0),
    'carton', greatest(v_base_carton - v_usage_carton, 0) + greatest(v_topup_carton, 0),
    'pallet', greatest(v_base_pallet - v_usage_pallet, 0) + greatest(v_topup_pallet, 0),
    'seat', greatest((v_base_seat + v_addon_seat) - v_active_seat, 0),
    'plant', greatest((v_base_plant + v_addon_plant) - v_active_plant, 0),
    'handset', greatest((v_base_handset + v_addon_handset) - v_active_handset, 0)
  );

  RETURN jsonb_build_object(
    'state', v_state,
    'trial_active', v_trial_active,
    'trial_expires_at', v_company.trial_expires_at,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'limits', v_limits,
    'usage', v_usage,
    'topups', v_topups,
    'remaining', v_remaining,
    'blocked', (v_state IN ('TRIAL_EXPIRED', 'NO_ACTIVE_SUBSCRIPTION'))
  );
END;
$$;

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
  v_existing jsonb;
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

  SELECT response_json INTO v_existing
  FROM public.entitlement_operation_log e
  WHERE e.company_id = p_company_id
    AND e.operation = 'consume'
    AND e.request_id = p_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  PERFORM 1 FROM public.companies c WHERE c.id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  SELECT response_json INTO v_existing
  FROM public.entitlement_operation_log e
  WHERE e.company_id = p_company_id
    AND e.operation = 'consume'
    AND e.request_id = p_request_id;

  IF FOUND THEN
    RETURN v_existing;
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
  );

  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_entitlement(
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
  v_existing jsonb;
  v_snapshot jsonb;
  v_metric_type text;
  v_period_start date;
  v_period_used int;
  v_to_reduce int;
  v_left bigint;
  v_topup_row record;
  v_remaining_after bigint;
  v_response jsonb;
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

  SELECT response_json INTO v_existing
  FROM public.entitlement_operation_log e
  WHERE e.company_id = p_company_id
    AND e.operation = 'refund'
    AND e.request_id = p_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  PERFORM 1 FROM public.companies c WHERE c.id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  SELECT response_json INTO v_existing
  FROM public.entitlement_operation_log e
  WHERE e.company_id = p_company_id
    AND e.operation = 'refund'
    AND e.request_id = p_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_snapshot := public.get_company_entitlement_snapshot(p_company_id, now());

  v_metric_type := CASE
    WHEN p_metric = 'unit' THEN 'UNIT'
    WHEN p_metric = 'box' THEN 'BOX'
    WHEN p_metric = 'carton' THEN 'CARTON'
    WHEN p_metric = 'pallet' THEN 'SSCC'
  END;
  v_period_start := coalesce((v_snapshot->>'period_start')::date, current_date);

  SELECT coalesce(used_quantity, 0)
  INTO v_period_used
  FROM public.usage_counters
  WHERE company_id = p_company_id
    AND metric_type = v_metric_type
    AND period_start = v_period_start
  FOR UPDATE;

  v_to_reduce := least(coalesce(v_period_used, 0), p_qty);

  IF v_to_reduce > 0 THEN
    UPDATE public.usage_counters
    SET used_quantity = greatest(0, used_quantity - v_to_reduce),
        updated_at = now()
    WHERE company_id = p_company_id
      AND metric_type = v_metric_type
      AND period_start = v_period_start;
  END IF;

  v_left := p_qty - v_to_reduce;
  IF v_left > 0 THEN
    FOR v_topup_row IN
      SELECT cat.id, cat.consumed_quantity
      FROM public.company_addon_topups cat
      WHERE cat.company_id = p_company_id
        AND cat.entitlement_key = p_metric
        AND cat.consumed_quantity > 0
      ORDER BY cat.created_at DESC, cat.id DESC
      FOR UPDATE
    LOOP
      EXIT WHEN v_left <= 0;
      UPDATE public.company_addon_topups
      SET
        consumed_quantity = greatest(0, consumed_quantity - least(v_left, consumed_quantity)),
        status = CASE
          WHEN greatest(0, consumed_quantity - least(v_left, consumed_quantity)) < purchased_quantity THEN 'paid'
          ELSE status
        END,
        updated_at = now()
      WHERE id = v_topup_row.id;

      v_left := v_left - least(v_left, v_topup_row.consumed_quantity);
    END LOOP;
  END IF;

  v_snapshot := public.get_company_entitlement_snapshot(p_company_id, now());
  v_remaining_after := coalesce((v_snapshot #>> ARRAY['remaining', p_metric::text])::bigint, 0);

  v_response := jsonb_build_object(
    'ok', true,
    'metric', p_metric,
    'refunded', p_qty,
    'remaining', greatest(v_remaining_after, 0),
    'base_refunded', v_to_reduce,
    'topup_refunded', greatest(p_qty - v_to_reduce, 0)
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
    'refund',
    p_request_id,
    p_metric,
    p_qty,
    v_response
  );

  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_cycle_reset(
  p_company_id uuid,
  p_new_period_start timestamptz,
  p_new_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id text;
  v_existing jsonb;
  v_response jsonb;
  v_metric text;
BEGIN
  IF p_new_period_start IS NULL OR p_new_period_end IS NULL OR p_new_period_end <= p_new_period_start THEN
    RAISE EXCEPTION 'INVALID_CYCLE_PERIOD';
  END IF;

  v_request_id := 'cycle:' || p_company_id::text || ':' || p_new_period_start::text || ':' || p_new_period_end::text;

  SELECT response_json INTO v_existing
  FROM public.entitlement_operation_log e
  WHERE e.company_id = p_company_id
    AND e.operation = 'cycle_reset'
    AND e.request_id = v_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  PERFORM 1 FROM public.companies c WHERE c.id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  SELECT response_json INTO v_existing
  FROM public.entitlement_operation_log e
  WHERE e.company_id = p_company_id
    AND e.operation = 'cycle_reset'
    AND e.request_id = v_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  UPDATE public.company_subscriptions
  SET
    current_period_start = p_new_period_start,
    current_period_end = p_new_period_end,
    next_billing_at = p_new_period_end,
    updated_at = now()
  WHERE company_id = p_company_id
    AND lower(coalesce(status::text, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due');

  FOREACH v_metric IN ARRAY ARRAY['UNIT', 'BOX', 'CARTON', 'SSCC']
  LOOP
    INSERT INTO public.usage_counters (
      company_id,
      metric_type,
      period_start,
      period_end,
      used_quantity
    )
    VALUES (
      p_company_id,
      v_metric,
      p_new_period_start::date,
      p_new_period_end::date,
      0
    )
    ON CONFLICT (company_id, metric_type, period_start)
    DO UPDATE
      SET used_quantity = 0,
          period_end = EXCLUDED.period_end,
          updated_at = now();
  END LOOP;

  v_response := jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'period_start', p_new_period_start,
    'period_end', p_new_period_end
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
    'cycle_reset',
    v_request_id,
    null,
    0,
    v_response
  );

  RETURN v_response;
END;
$$;

-- Keep existing plant/seat activation RPC contracts but source limits from canonical snapshot
CREATE OR REPLACE FUNCTION public.get_plant_entitlement(
  p_company_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  allocated integer,
  active integer,
  remaining integer,
  blocked boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_state text;
  v_alloc int;
  v_active int;
  v_remaining int;
BEGIN
  v_snapshot := public.get_company_entitlement_snapshot(p_company_id, p_now);
  v_state := coalesce(v_snapshot->>'state', 'NO_ACTIVE_SUBSCRIPTION');
  v_alloc := coalesce((v_snapshot #>> '{limits,plant}')::int, 0);
  v_active := coalesce((v_snapshot #>> '{usage,plant}')::int, 0);
  v_remaining := coalesce((v_snapshot #>> '{remaining,plant}')::int, 0);

  RETURN QUERY
  SELECT
    greatest(v_alloc, 0),
    greatest(v_active, 0),
    greatest(v_remaining, 0),
    (v_state IN ('TRIAL_EXPIRED', 'NO_ACTIVE_SUBSCRIPTION') OR v_remaining <= 0),
    CASE
      WHEN v_state = 'TRIAL_EXPIRED' THEN 'trial_expired'
      WHEN v_remaining <= 0 THEN 'quota_exceeded'
      ELSE NULL
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seat_entitlement(
  p_company_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  allocated integer,
  active integer,
  remaining integer,
  blocked boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_state text;
  v_alloc int;
  v_active int;
  v_remaining int;
BEGIN
  v_snapshot := public.get_company_entitlement_snapshot(p_company_id, p_now);
  v_state := coalesce(v_snapshot->>'state', 'NO_ACTIVE_SUBSCRIPTION');
  v_alloc := coalesce((v_snapshot #>> '{limits,seat}')::int, 0);
  v_active := coalesce((v_snapshot #>> '{usage,seat}')::int, 0);
  v_remaining := coalesce((v_snapshot #>> '{remaining,seat}')::int, 0);

  RETURN QUERY
  SELECT
    greatest(v_alloc, 0),
    greatest(v_active, 0),
    greatest(v_remaining, 0),
    (v_state IN ('TRIAL_EXPIRED', 'NO_ACTIVE_SUBSCRIPTION') OR v_remaining <= 0),
    CASE
      WHEN v_state = 'TRIAL_EXPIRED' THEN 'trial_expired'
      WHEN v_remaining <= 0 THEN 'quota_exceeded'
      ELSE NULL
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_entitlement_snapshot(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_entitlement(uuid, public.entitlement_key_enum, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_entitlement(uuid, public.entitlement_key_enum, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cycle_reset(uuid, timestamptz, timestamptz) TO authenticated;
