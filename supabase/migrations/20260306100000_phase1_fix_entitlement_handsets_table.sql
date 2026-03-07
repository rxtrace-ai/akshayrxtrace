-- ============================================================
-- PHASE 1: Stabilize entitlement snapshot (handsets schema fix)
-- ============================================================
-- Goal:
-- - Fix runtime crash: get_company_entitlement_snapshot referenced public.handset(h.company_id)
-- - Correct table is public.handsets (company devices) with columns (company_id, status, ...)
-- - Keep JSON output structure unchanged.
--
-- Note:
-- - public.handset is a legacy user-level device table (no company_id) and must NOT be used.
-- - Function must never crash even if tables are missing (defensive checks).

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

  -- Fix: use public.handsets (company devices). Never touch legacy public.handset (user-level).
  IF to_regclass('public.handsets') IS NOT NULL THEN
    BEGIN
      EXECUTE $sql$
        SELECT count(*)::int
        FROM public.handsets h
        WHERE h.company_id = $1
          AND lower(coalesce(h.status, 'active')) = 'active'
      $sql$
      INTO v_active_handset
      USING p_company_id;
    EXCEPTION WHEN others THEN
      v_active_handset := 0;
    END;
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

