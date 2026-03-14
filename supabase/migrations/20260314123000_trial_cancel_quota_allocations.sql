-- Trial cancel support + ledger-aligned entitlement snapshot
-- - Adds status to company_trials
-- - Adds cancel_company_trial RPC (mark cancelled + remove trial quota allocations)
-- - Updates entitlement snapshot to respect trial status

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_trials'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'company_trials' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.company_trials
      ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled'));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'company_trials' AND column_name = 'status'
  ) THEN
    UPDATE public.company_trials
    SET status = 'active'
    WHERE status IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_trials'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_company_trials_company_status
      ON public.company_trials(company_id, status);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_company_trial(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_trials
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE company_id = p_company_id
    AND status = 'active';

  DELETE FROM public.quota_allocations
  WHERE company_id = p_company_id
    AND source = 'trial';
END;
$$;

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
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_trial_start timestamptz;
  v_trial_end timestamptz;
  v_trial_status text;
  v_trial_active boolean := false;
  v_trial_expired boolean := false;
  v_state text := 'NO_ACTIVE_SUBSCRIPTION';

  v_total_unit int := 0;
  v_total_box int := 0;
  v_total_carton int := 0;
  v_total_pallet int := 0;
  v_total_seat int := 0;
  v_total_plant int := 0;
  v_total_handset int := 0;

  v_topup_unit int := 0;
  v_topup_box int := 0;
  v_topup_carton int := 0;
  v_topup_pallet int := 0;

  v_usage_unit int := 0;
  v_usage_box int := 0;
  v_usage_carton int := 0;
  v_usage_pallet int := 0;
  v_active_seat int := 0;
  v_active_plant int := 0;
  v_active_handset int := 0;

  v_limits jsonb;
  v_usage jsonb;
  v_topups jsonb;
  v_remaining jsonb;
BEGIN
  SELECT c.id, c.deleted_at
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

  -- Trial window from company_trials (latest)
  SELECT t.trial_start, t.trial_end, t.status
  INTO v_trial_start, v_trial_end, v_trial_status
  FROM public.company_trials t
  WHERE t.company_id = p_company_id
  ORDER BY t.created_at DESC
  LIMIT 1;

  v_trial_active := (
    v_trial_status = 'active'
    AND v_trial_start IS NOT NULL
    AND v_trial_end IS NOT NULL
    AND p_at >= v_trial_start
    AND p_at <= v_trial_end
  );

  v_trial_expired := (
    v_trial_status = 'active'
    AND v_trial_start IS NOT NULL
    AND v_trial_end IS NOT NULL
    AND p_at > v_trial_end
  );

  -- Paid subscription snapshot (active/authenticated/pending/paused/past_due are treated as "present")
  SELECT cs.*
  INTO v_subscription
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id
    AND lower(coalesce(cs.status::text, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due')
  ORDER BY cs.updated_at DESC NULLS LAST, cs.created_at DESC
  LIMIT 1;

  IF v_subscription.id IS NOT NULL THEN
    v_state := 'PAID_ACTIVE';
    v_period_start := COALESCE(v_subscription.current_period_start, date_trunc('month', p_at));
    v_period_end := COALESCE(v_subscription.current_period_end, date_trunc('month', p_at) + interval '1 month');
  ELSIF v_trial_status = 'cancelled' THEN
    v_state := 'TRIAL_CANCELLED';
    v_period_start := v_trial_start;
    v_period_end := v_trial_end;
  ELSIF v_trial_active THEN
    v_state := 'TRIAL_ACTIVE';
    v_period_start := v_trial_start;
    v_period_end := v_trial_end;
  ELSIF v_trial_expired THEN
    v_state := 'TRIAL_EXPIRED';
    v_period_start := v_trial_start;
    v_period_end := v_trial_end;
  ELSE
    v_state := 'NO_ACTIVE_SUBSCRIPTION';
    v_period_start := date_trunc('month', p_at);
    v_period_end := date_trunc('month', p_at) + interval '1 month';
  END IF;

  -- Quota totals from ledger (single source of truth)
  SELECT
    coalesce(sum(amount) FILTER (WHERE resource = 'unit'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'box'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'carton'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'pallet'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'seats'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'plants'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'handsets'), 0)::int
  INTO
    v_total_unit,
    v_total_box,
    v_total_carton,
    v_total_pallet,
    v_total_seat,
    v_total_plant,
    v_total_handset
  FROM public.quota_allocations
  WHERE company_id = p_company_id
    AND expires_at > p_at;

  -- Optional: isolate add-on topups for variable quotas (kept for UI compatibility)
  SELECT
    coalesce(sum(amount) FILTER (WHERE resource = 'unit'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'box'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'carton'), 0)::int,
    coalesce(sum(amount) FILTER (WHERE resource = 'pallet'), 0)::int
  INTO
    v_topup_unit,
    v_topup_box,
    v_topup_carton,
    v_topup_pallet
  FROM public.quota_allocations
  WHERE company_id = p_company_id
    AND expires_at > p_at
    AND source = 'addon'
    AND quota_type = 'variable';

  -- Usage within the entitlement window
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

  v_limits := jsonb_build_object(
    'unit', greatest(v_total_unit, 0),
    'box', greatest(v_total_box, 0),
    'carton', greatest(v_total_carton, 0),
    'pallet', greatest(v_total_pallet, 0),
    'seat', greatest(v_total_seat, 0),
    'plant', greatest(v_total_plant, 0),
    'handset', greatest(v_total_handset, 0)
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
    'unit', greatest(v_total_unit - v_usage_unit, 0),
    'box', greatest(v_total_box - v_usage_box, 0),
    'carton', greatest(v_total_carton - v_usage_carton, 0),
    'pallet', greatest(v_total_pallet - v_usage_pallet, 0),
    'seat', greatest(v_total_seat - v_active_seat, 0),
    'plant', greatest(v_total_plant - v_active_plant, 0),
    'handset', greatest(v_total_handset - v_active_handset, 0)
  );

  RETURN jsonb_build_object(
    'state', v_state,
    'trial_active', v_trial_active,
    'trial_expires_at', v_trial_end,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'limits', v_limits,
    'usage', v_usage,
    'topups', v_topups,
    'remaining', v_remaining,
    'blocked', (v_state IN ('TRIAL_EXPIRED', 'NO_ACTIVE_SUBSCRIPTION', 'TRIAL_CANCELLED'))
  );
END;
$$;
