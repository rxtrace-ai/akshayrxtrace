-- Universal quota period lifecycle.
-- FREE uses the same plan/version/allocation model as paid subscriptions.
-- Paid periods are allocated only after a verified provider payment event.

ALTER TABLE public.quota_allocations
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES public.company_subscriptions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS allocation_key text,
  ADD COLUMN IF NOT EXISTS period_start timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quota_allocations_period_resource
  ON public.quota_allocations (company_id, allocation_key, resource)
  WHERE allocation_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.subscription_quota_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.company_subscriptions(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('free_monthly', 'paid_monthly', 'paid_yearly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_quota_periods_valid_window CHECK (period_end > period_start),
  CONSTRAINT subscription_quota_periods_once UNIQUE (subscription_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_subscription_quota_periods_company
  ON public.subscription_quota_periods(company_id, period_start DESC);

ALTER TABLE public.subscription_quota_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_quota_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.subscription_quota_periods TO service_role;

-- Create one paid period's code quota after a verified payment. Plan values are
-- taken from the immutable original quote snapshot; capacities are not copied.
CREATE OR REPLACE FUNCTION public.allocate_paid_subscription_period(
  p_subscription_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
  v_template_name text;
  v_cycle text;
  v_quote_id uuid;
  v_quote public.quotes%ROWTYPE;
  v_key text;
  v_source text;
  v_inserted boolean := false;
  v_existing_count integer := 0;
BEGIN
  IF p_subscription_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL
     OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_PERIOD';
  END IF;

  SELECT * INTO v_sub
  FROM public.company_subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;

  SELECT upper(coalesce(t.name, '')), lower(coalesce(v_sub.billing_cycle, t.billing_cycle, 'monthly'))
  INTO v_template_name, v_cycle
  FROM public.subscription_plan_templates t
  WHERE t.id = v_sub.plan_template_id;

  IF v_template_name IS NULL THEN RAISE EXCEPTION 'PLAN_TEMPLATE_NOT_FOUND'; END IF;
  IF v_template_name = 'FREE' THEN RAISE EXCEPTION 'FREE_PERIOD_IS_SCHEDULER_MANAGED'; END IF;
  IF v_cycle NOT IN ('monthly', 'yearly') THEN RAISE EXCEPTION 'UNSUPPORTED_BILLING_CYCLE'; END IF;
  IF v_cycle = 'monthly' AND p_period_end > p_period_start + interval '1 month 1 day' THEN
    RAISE EXCEPTION 'INVALID_MONTHLY_PERIOD';
  END IF;
  IF v_cycle = 'yearly' AND p_period_end > p_period_start + interval '1 year 1 day' THEN
    RAISE EXCEPTION 'INVALID_YEARLY_PERIOD';
  END IF;

  v_quote_id := nullif(v_sub.metadata->>'quote_id', '')::uuid;
  IF v_quote_id IS NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_PLAN_SNAPSHOT_MISSING'; END IF;
  SELECT * INTO v_quote FROM public.quotes WHERE id = v_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_PLAN_SNAPSHOT_MISSING'; END IF;

  v_key := 'subscription:' || p_subscription_id::text || ':' || p_period_start::text;
  v_source := CASE WHEN v_cycle = 'yearly' THEN 'paid_yearly' ELSE 'paid_monthly' END;

  -- Capacity entitlements are not monthly quotas. Keep the current plan's
  -- capacities active through each confirmed paid period without resetting use.
  UPDATE public.quota_allocations
  SET expires_at = p_period_end,
      subscription_id = p_subscription_id,
      period_start = p_period_start
  WHERE company_id = v_sub.company_id
    AND (source_quote_id = v_quote_id OR (subscription_id = p_subscription_id AND expires_at >= p_period_start))
    AND source = 'subscription' AND quota_type = 'base'
    AND resource IN ('seats', 'plants', 'handsets');

  -- Initial checkout finalization already wrote these exact period allocations.
  SELECT count(*) INTO v_existing_count
  FROM public.quota_allocations qa
  WHERE qa.company_id = v_sub.company_id
    AND qa.source = 'subscription' AND qa.quota_type = 'base'
    AND qa.expires_at = p_period_end
    AND (qa.metadata->>'period_start')::timestamptz = p_period_start;

  IF v_existing_count = 0 THEN
    INSERT INTO public.subscription_quota_periods(company_id, subscription_id, period_start, period_end, source)
    VALUES (v_sub.company_id, p_subscription_id, p_period_start, p_period_end, v_source)
    ON CONFLICT (subscription_id, period_start) DO NOTHING
    RETURNING true INTO v_inserted;

    IF coalesce(v_inserted, false) THEN
      UPDATE public.quota_allocations
      SET expires_at = p_period_start,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('expired_at_period_start', p_period_start)
      WHERE company_id = v_sub.company_id
        AND source = 'subscription' AND quota_type = 'base'
        AND resource IN ('unit', 'box', 'carton', 'pallet')
        AND expires_at > p_period_start;

      INSERT INTO public.quota_allocations(
        company_id, subscription_id, source, quota_type, resource, amount,
        expires_at, period_start, allocation_key, metadata
      )
      SELECT v_sub.company_id, p_subscription_id, 'subscription', 'base', r.resource,
             greatest(coalesce(nullif(v_quote.plan_snapshot_json #>> r.path, '')::integer, 0), 0),
             p_period_end, p_period_start, v_key,
             jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end,
                                'quote_id', v_quote_id, 'allocation_source', v_source)
      FROM (VALUES
        ('unit', ARRAY['quotas','unit']::text[]),
        ('box', ARRAY['quotas','box']::text[]),
        ('carton', ARRAY['quotas','carton']::text[]),
        ('pallet', ARRAY['quotas','pallet']::text[])
      ) AS r(resource, path)
      WHERE greatest(coalesce(nullif(v_quote.plan_snapshot_json #>> r.path, '')::integer, 0), 0) > 0
      ON CONFLICT (company_id, allocation_key, resource) WHERE allocation_key IS NOT NULL
      DO UPDATE SET amount = excluded.amount, expires_at = excluded.expires_at,
                    period_start = excluded.period_start, metadata = excluded.metadata;
    END IF;
  END IF;

  UPDATE public.company_subscriptions
  SET current_period_start = p_period_start,
      current_period_end = p_period_end,
      next_billing_at = p_period_end,
      renewal_date = p_period_end,
      updated_at = now()
  WHERE id = p_subscription_id;

  RETURN jsonb_build_object('success', true, 'subscription_id', p_subscription_id,
                            'period_start', p_period_start, 'period_end', p_period_end,
                            'duplicate', v_existing_count > 0 OR NOT coalesce(v_inserted, false));
END;
$$;

-- Scheduled daily. Calendar-month FREE grants are based on the active plan
-- version. Paid subscription renewal grants are intentionally payment-webhook
-- driven; this job only expires ended paid periods.
CREATE OR REPLACE FUNCTION public.run_universal_subscription_reset(p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_start timestamptz := date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_end timestamptz := (date_trunc('month', p_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
  v_key text;
  v_allocated integer := 0;
  v_expired integer := 0;
  v_result boolean;
BEGIN
  FOR v_sub IN
    SELECT cs.id, cs.company_id,
           coalesce(cs.plan_version_id, (
             SELECT pv.id FROM public.subscription_plan_versions pv
             WHERE pv.template_id = cs.plan_template_id AND pv.is_active
             ORDER BY pv.version_number DESC LIMIT 1
           )) AS plan_version_id
    FROM public.company_subscriptions cs
    JOIN public.subscription_plan_templates t ON t.id = cs.plan_template_id
    WHERE upper(t.name) = 'FREE' AND lower(coalesce(cs.status, '')) = 'active'
      AND (cs.current_period_end IS NULL OR cs.current_period_end > p_at)
    ORDER BY cs.company_id
  LOOP
    PERFORM 1 FROM public.companies c WHERE c.id = v_sub.company_id FOR UPDATE;
    PERFORM 1 FROM public.company_subscriptions cs WHERE cs.id = v_sub.id FOR UPDATE;

    v_key := 'free:' || v_sub.id::text || ':' || v_start::text;
    INSERT INTO public.subscription_quota_periods(company_id, subscription_id, period_start, period_end, source)
    VALUES (v_sub.company_id, v_sub.id, v_start, v_end, 'free_monthly')
    ON CONFLICT (subscription_id, period_start) DO NOTHING
    RETURNING true INTO v_result;

    IF coalesce(v_result, false) THEN
      UPDATE public.quota_allocations
      SET expires_at = v_start,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('expired_at_period_start', v_start)
      WHERE company_id = v_sub.company_id
        AND source = 'subscription' AND quota_type = 'base'
        AND resource IN ('unit', 'box', 'carton', 'pallet')
        AND expires_at > v_start;

      INSERT INTO public.quota_allocations(
        company_id, subscription_id, source, quota_type, resource, amount,
        expires_at, period_start, allocation_key, metadata
      )
      SELECT v_sub.company_id, v_sub.id, 'subscription', 'base', r.resource, r.amount,
             v_end, v_start, v_key,
             jsonb_build_object('period_start', v_start, 'period_end', v_end, 'allocation_source', 'free_monthly')
      FROM (
        SELECT 'unit'::text AS resource, coalesce(pv.unit_limit, 0) AS amount FROM public.subscription_plan_versions pv WHERE pv.id = v_sub.plan_version_id
        UNION ALL SELECT 'box', coalesce(pv.box_limit, 0) FROM public.subscription_plan_versions pv WHERE pv.id = v_sub.plan_version_id
        UNION ALL SELECT 'carton', coalesce(pv.carton_limit, 0) FROM public.subscription_plan_versions pv WHERE pv.id = v_sub.plan_version_id
        UNION ALL SELECT 'pallet', coalesce(pv.pallet_limit, 0) FROM public.subscription_plan_versions pv WHERE pv.id = v_sub.plan_version_id
      ) r
      WHERE r.amount > 0
      ON CONFLICT (company_id, allocation_key, resource) WHERE allocation_key IS NOT NULL
      DO UPDATE SET amount = excluded.amount, expires_at = excluded.expires_at,
                    period_start = excluded.period_start, metadata = excluded.metadata;
      v_allocated := v_allocated + 1;
    END IF;
    v_result := false;
  END LOOP;

  UPDATE public.company_subscriptions cs
  SET status = 'expired', updated_at = p_at
  FROM public.subscription_plan_templates t
  WHERE t.id = cs.plan_template_id
    AND upper(t.name) <> 'FREE'
    AND lower(coalesce(cs.status, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due', 'cancelled', 'canceled')
    AND cs.current_period_end IS NOT NULL
    AND cs.current_period_end <= p_at;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'free_periods_allocated', v_allocated,
                            'paid_subscriptions_expired', v_expired, 'period_start', v_start,
                            'period_end', v_end);
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_paid_subscription_period(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_universal_subscription_reset(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_paid_subscription_period(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_universal_subscription_reset(timestamptz) TO service_role;

-- Snapshot FREE against the current calendar month while its subscription stays
-- lifetime-active. Capacity resources remain lifetime subscription limits and
-- are not copied into monthly quota allocations.
CREATE OR REPLACE FUNCTION public.get_company_entitlement_snapshot(p_company_id uuid, p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_deleted_at timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_free boolean := false;
  v_limits jsonb;
  v_usage jsonb;
  v_topups jsonb;
  v_remaining jsonb;
  v_usage_unit integer := 0; v_usage_box integer := 0; v_usage_carton integer := 0; v_usage_pallet integer := 0;
  v_seats integer := 0; v_plants integer := 0; v_handsets integer := 0;
  v_unit integer := 0; v_box integer := 0; v_carton integer := 0; v_pallet integer := 0;
  v_seat_limit integer := 0; v_plant_limit integer := 0; v_handset_limit integer := 0;
  v_topup_unit integer := 0; v_topup_box integer := 0; v_topup_carton integer := 0; v_topup_pallet integer := 0;
BEGIN
  SELECT deleted_at INTO v_deleted_at FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMPANY_NOT_FOUND'; END IF;
  IF v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'state','COMPANY_DELETED','plan_name',null,'billing_cycle',null,'lifetime',false,
      'period_start',null,'period_end',null,'quota_period_end',null,
      'limits',jsonb_build_object('unit',0,'box',0,'carton',0,'pallet',0,'seat',0,'plant',0,'handset',0),
      'usage',jsonb_build_object('unit',0,'box',0,'carton',0,'pallet',0,'seat',0,'plant',0,'handset',0),
      'topups',jsonb_build_object('unit',0,'box',0,'carton',0,'pallet',0),
      'remaining',jsonb_build_object('unit',0,'box',0,'carton',0,'pallet',0,'seat',0,'plant',0,'handset',0),
      'blocked',true,'reason','COMPANY_DELETED'
    );
  END IF;

  SELECT cs.*, upper(coalesce(t.name, '')) AS plan_name, t.billing_cycle AS template_cycle
  INTO v_sub
  FROM public.company_subscriptions cs
  LEFT JOIN public.subscription_plan_templates t ON t.id = cs.plan_template_id
  WHERE cs.company_id = p_company_id
    AND (lower(coalesce(cs.status, '')) IN ('active','authenticated','pending','paused','past_due')
      OR (lower(coalesce(cs.status, '')) IN ('cancelled','canceled') AND cs.cancel_at_period_end AND cs.current_period_end > p_at))
  ORDER BY cs.updated_at DESC NULLS LAST, cs.created_at DESC LIMIT 1;

  v_free := coalesce(v_sub.plan_name = 'FREE', false);
  IF v_free THEN
    v_start := date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_end := (date_trunc('month', p_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
  ELSE
    v_start := coalesce(v_sub.current_period_start, v_sub.activated_at, date_trunc('month', p_at));
    v_end := coalesce(v_sub.current_period_end, date_trunc('month', p_at) + interval '1 month');
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE resource='unit'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='box'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='carton'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='pallet'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='seats'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='plants'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='handsets'),0)::int
  INTO v_unit,v_box,v_carton,v_pallet,v_seat_limit,v_plant_limit,v_handset_limit
  FROM public.quota_allocations WHERE company_id=p_company_id AND expires_at > p_at;

  IF to_regclass('public.usage_events') IS NOT NULL THEN
    SELECT coalesce(sum(quantity) FILTER (WHERE metric_type='UNIT'),0)::int,
           coalesce(sum(quantity) FILTER (WHERE metric_type='BOX'),0)::int,
           coalesce(sum(quantity) FILTER (WHERE metric_type='CARTON'),0)::int,
           coalesce(sum(quantity) FILTER (WHERE metric_type='SSCC'),0)::int
    INTO v_usage_unit,v_usage_box,v_usage_carton,v_usage_pallet
    FROM public.usage_events WHERE company_id=p_company_id AND created_at >= v_start AND created_at < v_end;
  END IF;
  SELECT count(*)::int INTO v_seats FROM public.seats WHERE company_id=p_company_id AND status='active' AND coalesce(active,false);
  SELECT count(*)::int INTO v_plants FROM public.plants WHERE company_id=p_company_id AND status='active';
  IF to_regclass('public.handset') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM public.handset WHERE company_id=$1 AND lower(coalesce(status, ''active''))=''active''' INTO v_handsets USING p_company_id;
  ELSIF to_regclass('public.handsets') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM public.handsets WHERE company_id=$1 AND lower(coalesce(status, ''active''))=''active''' INTO v_handsets USING p_company_id;
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE resource='unit'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='box'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='carton'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='pallet'),0)::int
  INTO v_topup_unit,v_topup_box,v_topup_carton,v_topup_pallet
  FROM public.quota_allocations WHERE company_id=p_company_id AND expires_at > p_at AND source='addon' AND quota_type='variable';

  v_limits := jsonb_build_object('unit',v_unit,'box',v_box,'carton',v_carton,'pallet',v_pallet,'seat',v_seat_limit,'plant',v_plant_limit,'handset',v_handset_limit);
  v_usage := jsonb_build_object('unit',v_usage_unit,'box',v_usage_box,'carton',v_usage_carton,'pallet',v_usage_pallet,'seat',v_seats,'plant',v_plants,'handset',v_handsets);
  v_topups := jsonb_build_object('unit',v_topup_unit,'box',v_topup_box,'carton',v_topup_carton,'pallet',v_topup_pallet);
  v_remaining := jsonb_build_object('unit',greatest(v_unit-v_usage_unit,0),'box',greatest(v_box-v_usage_box,0),'carton',greatest(v_carton-v_usage_carton,0),'pallet',greatest(v_pallet-v_usage_pallet,0),'seat',greatest(v_seat_limit-v_seats,0),'plant',greatest(v_plant_limit-v_plants,0),'handset',greatest(v_handset_limit-v_handsets,0));

  RETURN jsonb_build_object('state', CASE WHEN v_sub.id IS NULL THEN 'NO_ACTIVE_SUBSCRIPTION' WHEN v_free THEN 'FREE_ACTIVE' ELSE 'PAID_ACTIVE' END,
    'plan_name', v_sub.plan_name, 'billing_cycle', coalesce(v_sub.billing_cycle, v_sub.template_cycle),
    'lifetime', v_free, 'period_start',v_start,'period_end',CASE WHEN v_free THEN NULL ELSE v_end END,
    'quota_period_end',v_end,'limits',v_limits,'usage',v_usage,'topups',v_topups,'remaining',v_remaining,
    'blocked', v_sub.id IS NULL OR (NOT v_free AND v_end <= p_at));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_entitlement_snapshot(uuid, timestamptz) TO authenticated, service_role;
