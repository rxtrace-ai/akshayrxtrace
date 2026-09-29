-- Keep current-period code allocations immutable, but read usage from the
-- counter ledger maintained by consume_entitlement/refund_entitlement.
-- Subscription capacities come from the selected plan version plus active
-- capacity add-on allocations; they are not monthly quota allocations.
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
  v_sub record;
  v_deleted_at timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_free boolean := false;
  v_limits jsonb;
  v_usage jsonb;
  v_topups jsonb;
  v_remaining jsonb;
  v_usage_unit integer := 0;
  v_usage_box integer := 0;
  v_usage_carton integer := 0;
  v_usage_pallet integer := 0;
  v_seats integer := 0;
  v_plants integer := 0;
  v_handsets integer := 0;
  v_unit integer := 0;
  v_box integer := 0;
  v_carton integer := 0;
  v_pallet integer := 0;
  v_seat_limit integer := 0;
  v_plant_limit integer := 0;
  v_handset_limit integer := 0;
  v_topup_unit integer := 0;
  v_topup_box integer := 0;
  v_topup_carton integer := 0;
  v_topup_pallet integer := 0;
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

  SELECT cs.*, upper(coalesce(t.name, '')) AS plan_name, t.billing_cycle AS template_cycle,
         pv.seat_limit AS version_seat_limit,
         pv.plant_limit AS version_plant_limit,
         pv.handset_limit AS version_handset_limit
  INTO v_sub
  FROM public.company_subscriptions cs
  LEFT JOIN public.subscription_plan_templates t ON t.id = cs.plan_template_id
  LEFT JOIN LATERAL (
    SELECT candidate.seat_limit, candidate.plant_limit, candidate.handset_limit
    FROM public.subscription_plan_versions candidate
    WHERE candidate.id = cs.plan_version_id
       OR (cs.plan_version_id IS NULL AND candidate.template_id = cs.plan_template_id)
    ORDER BY (candidate.id = cs.plan_version_id) DESC, candidate.is_active DESC, candidate.version_number DESC
    LIMIT 1
  ) pv ON true
  WHERE cs.company_id = p_company_id
    AND (lower(coalesce(cs.status, '')) IN ('active','authenticated','pending','paused','past_due')
      OR (lower(coalesce(cs.status, '')) IN ('cancelled','canceled') AND cs.cancel_at_period_end AND cs.current_period_end > p_at))
  ORDER BY cs.updated_at DESC NULLS LAST, cs.created_at DESC
  LIMIT 1;

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
         coalesce(sum(amount) FILTER (WHERE resource='seats' AND source='addon'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='plants' AND source='addon'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='handsets' AND source='addon'),0)::int
  INTO v_unit,v_box,v_carton,v_pallet,v_seat_limit,v_plant_limit,v_handset_limit
  FROM public.quota_allocations
  WHERE company_id=p_company_id AND expires_at > p_at;

  v_seat_limit := v_seat_limit + coalesce(v_sub.version_seat_limit, 0);
  v_plant_limit := v_plant_limit + coalesce(v_sub.version_plant_limit, 0);
  v_handset_limit := v_handset_limit + coalesce(v_sub.version_handset_limit, 0);

  SELECT coalesce(sum(used_quantity) FILTER (WHERE metric_type='UNIT'),0)::int,
         coalesce(sum(used_quantity) FILTER (WHERE metric_type='BOX'),0)::int,
         coalesce(sum(used_quantity) FILTER (WHERE metric_type='CARTON'),0)::int,
         coalesce(sum(used_quantity) FILTER (WHERE metric_type='SSCC'),0)::int
  INTO v_usage_unit,v_usage_box,v_usage_carton,v_usage_pallet
  FROM public.usage_counters
  WHERE company_id=p_company_id AND period_start=v_start::date;

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
  FROM public.quota_allocations
  WHERE company_id=p_company_id AND expires_at > p_at AND source='addon' AND quota_type='variable';

  v_limits := jsonb_build_object('unit',v_unit,'box',v_box,'carton',v_carton,'pallet',v_pallet,'seat',v_seat_limit,'plant',v_plant_limit,'handset',v_handset_limit);
  v_usage := jsonb_build_object('unit',v_usage_unit,'box',v_usage_box,'carton',v_usage_carton,'pallet',v_usage_pallet,'seat',v_seats,'plant',v_plants,'handset',v_handsets);
  v_topups := jsonb_build_object('unit',v_topup_unit,'box',v_topup_box,'carton',v_topup_carton,'pallet',v_topup_pallet);
  v_remaining := jsonb_build_object('unit',v_unit-v_usage_unit,'box',v_box-v_usage_box,'carton',v_carton-v_usage_carton,'pallet',v_pallet-v_usage_pallet,'seat',greatest(v_seat_limit-v_seats,0),'plant',greatest(v_plant_limit-v_plants,0),'handset',greatest(v_handset_limit-v_handsets,0));

  RETURN jsonb_build_object('state', CASE WHEN v_sub.id IS NULL THEN 'NO_ACTIVE_SUBSCRIPTION' WHEN v_free THEN 'FREE_ACTIVE' ELSE 'PAID_ACTIVE' END,
    'plan_name', v_sub.plan_name, 'billing_cycle', coalesce(v_sub.billing_cycle, v_sub.template_cycle),
    'lifetime', v_free, 'period_start',v_start,'period_end',CASE WHEN v_free THEN NULL ELSE v_end END,
    'quota_period_end',v_end,'limits',v_limits,'usage',v_usage,'topups',v_topups,'remaining',v_remaining,
    'blocked', v_sub.id IS NULL OR (NOT v_free AND v_end <= p_at));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_entitlement_snapshot(uuid, timestamptz) TO authenticated, service_role;
