-- Subscription-cycle quota periods. Each period captures the plan configuration
-- active at its start, and quota_allocations remain the consumption authority.
ALTER TABLE public.subscription_quota_periods
  ADD COLUMN IF NOT EXISTS plan_version_id uuid REFERENCES public.subscription_plan_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quota_snapshot_json jsonb;

CREATE OR REPLACE FUNCTION public.get_subscription_cycle_window(
  p_anchor timestamptz,
  p_cycle text,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(period_start timestamptz, period_end timestamptz)
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_step integer := CASE WHEN lower(coalesce(p_cycle, 'monthly')) = 'yearly' THEN 12 ELSE 1 END;
  v_offset integer := 0;
BEGIN
  IF p_anchor IS NULL OR p_at IS NULL THEN RAISE EXCEPTION 'INVALID_SUBSCRIPTION_PERIOD_DATE'; END IF;
  period_start := p_anchor;
  period_end := p_anchor + make_interval(months => v_step);
  WHILE period_end <= p_at LOOP
    v_offset := v_offset + v_step;
    period_start := p_anchor + make_interval(months => v_offset);
    period_end := p_anchor + make_interval(months => v_offset + v_step);
  END LOOP;
  RETURN NEXT;
END;
$$;

-- Resolve historical configuration from the immutable admin audit snapshots.
-- If there was no edit after the requested time, the current active version is
-- the same configuration that was active at that time.
CREATE OR REPLACE FUNCTION public.resolve_plan_quota_snapshot_at(
  p_template_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state jsonb;
  v_version_id uuid;
  v_quotas jsonb;
BEGIN
  SELECT coalesce(e.after_state_json->'active_version', (
    SELECT v.value FROM jsonb_array_elements(coalesce(e.after_state_json->'versions', '[]'::jsonb)) AS v(value)
    WHERE coalesce((v.value->>'is_active')::boolean, false) ORDER BY coalesce((v.value->>'version_number')::integer, 0) DESC LIMIT 1
  )) INTO v_state
  FROM public.admin_mutation_audit_events e
  WHERE e.entity_type = 'subscription_plan_template' AND e.entity_id = p_template_id::text AND e.created_at <= p_at
  ORDER BY e.created_at DESC LIMIT 1;

  IF v_state IS NULL THEN
    SELECT coalesce(e.before_state_json->'active_version', (
      SELECT v.value FROM jsonb_array_elements(coalesce(e.before_state_json->'versions', '[]'::jsonb)) AS v(value)
      WHERE coalesce((v.value->>'is_active')::boolean, false) ORDER BY coalesce((v.value->>'version_number')::integer, 0) DESC LIMIT 1
    )) INTO v_state
    FROM public.admin_mutation_audit_events e
    WHERE e.entity_type = 'subscription_plan_template' AND e.entity_id = p_template_id::text AND e.created_at > p_at
    ORDER BY e.created_at LIMIT 1;
  END IF;

  v_version_id := nullif(v_state->>'id', '')::uuid;
  IF v_version_id IS NULL THEN
    SELECT jsonb_build_object(
      'plan_version_id', pv.id,
      'quotas', jsonb_build_object('unit', pv.unit_limit, 'box', pv.box_limit, 'carton', pv.carton_limit, 'pallet', pv.pallet_limit)
    ) INTO v_quotas
    FROM public.subscription_plan_versions pv
    WHERE pv.template_id = p_template_id AND pv.is_active
    ORDER BY pv.version_number DESC LIMIT 1;
    IF v_quotas IS NULL THEN RAISE EXCEPTION 'ACTIVE_PLAN_VERSION_NOT_FOUND'; END IF;
    RETURN v_quotas;
  END IF;

  RETURN jsonb_build_object(
    'plan_version_id', v_version_id,
    'quotas', jsonb_build_object(
      'unit', greatest(coalesce(nullif(v_state->>'unit_limit', '')::integer, 0), 0),
      'box', greatest(coalesce(nullif(v_state->>'box_limit', '')::integer, 0), 0),
      'carton', greatest(coalesce(nullif(v_state->>'carton_limit', '')::integer, 0), 0),
      'pallet', greatest(coalesce(nullif(v_state->>'pallet_limit', '')::integer, 0), 0)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_subscription_quota_period(
  p_subscription_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_period_source text,
  p_config_snapshot jsonb DEFAULT NULL,
  p_source_quote_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
  v_template_name text;
  v_config jsonb;
  v_quotas jsonb;
  v_plan_version_id uuid;
  v_key text;
  v_inserted boolean := false;
  v_resource text;
  v_amount integer;
  v_existing_period public.subscription_quota_periods%ROWTYPE;
BEGIN
  IF p_subscription_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_PERIOD';
  END IF;
  IF p_period_source NOT IN ('free_monthly', 'paid_monthly', 'paid_yearly') THEN RAISE EXCEPTION 'INVALID_SUBSCRIPTION_PERIOD_SOURCE'; END IF;

  SELECT * INTO v_sub FROM public.company_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  SELECT upper(coalesce(t.name, '')) INTO v_template_name FROM public.subscription_plan_templates t WHERE t.id = v_sub.plan_template_id;
  IF v_template_name IS NULL THEN RAISE EXCEPTION 'PLAN_TEMPLATE_NOT_FOUND'; END IF;

  v_config := coalesce(p_config_snapshot, public.resolve_plan_quota_snapshot_at(v_sub.plan_template_id, p_period_start));
  v_quotas := coalesce(v_config->'quotas', '{}'::jsonb);
  v_plan_version_id := nullif(v_config->>'plan_version_id', '')::uuid;
  v_key := 'subscription:' || p_subscription_id::text || ':' || p_period_start::text;

  INSERT INTO public.subscription_quota_periods(
    company_id, subscription_id, period_start, period_end, source, plan_version_id, quota_snapshot_json
  ) VALUES (
    v_sub.company_id, p_subscription_id, p_period_start, p_period_end, p_period_source,
    v_plan_version_id, v_config
  )
  ON CONFLICT (subscription_id, period_start) DO NOTHING
  RETURNING true INTO v_inserted;

  IF NOT coalesce(v_inserted, false) THEN
    SELECT * INTO v_existing_period FROM public.subscription_quota_periods
    WHERE subscription_id = p_subscription_id AND period_start = p_period_start FOR UPDATE;
    v_config := v_existing_period.quota_snapshot_json;
    v_quotas := coalesce(v_config->'quotas', '{}'::jsonb);
    v_plan_version_id := v_existing_period.plan_version_id;
    IF v_config IS NULL THEN
      -- Legacy periods may be completed only from their recorded allocation,
      -- or from the explicit historical snapshot supplied by a safe repair.
      IF p_config_snapshot IS NOT NULL THEN
        v_config := p_config_snapshot;
        v_quotas := coalesce(v_config->'quotas', '{}'::jsonb);
        v_plan_version_id := nullif(v_config->>'plan_version_id', '')::uuid;
        UPDATE public.subscription_quota_periods
        SET plan_version_id = v_plan_version_id, quota_snapshot_json = v_config
        WHERE id = v_existing_period.id;
      ELSE
        SELECT jsonb_build_object('plan_version_id', v_plan_version_id, 'quotas', jsonb_build_object(
          'unit', coalesce(sum(amount) FILTER (WHERE resource='unit'), 0),
          'box', coalesce(sum(amount) FILTER (WHERE resource='box'), 0),
          'carton', coalesce(sum(amount) FILTER (WHERE resource='carton'), 0),
          'pallet', coalesce(sum(amount) FILTER (WHERE resource='pallet'), 0)
        )) INTO v_config
        FROM public.quota_allocations
        WHERE company_id = v_sub.company_id AND subscription_id = p_subscription_id
          AND resource IN ('unit','box','carton','pallet')
          AND (period_start = p_period_start OR metadata->>'period_start' = p_period_start::text);
        v_quotas := v_config->'quotas';
        UPDATE public.subscription_quota_periods
        SET quota_snapshot_json = v_config WHERE id = v_existing_period.id;
      END IF;
    END IF;
  ELSE
    -- A new period closes all previous base-code allocations. Usage history is
    -- untouched and remains keyed to its original period_start.
    UPDATE public.quota_allocations
    SET expires_at = p_period_start,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('expired_at_period_start', p_period_start)
    WHERE company_id = v_sub.company_id AND source = 'subscription' AND quota_type = 'base'
      AND resource IN ('unit','box','carton','pallet') AND expires_at > p_period_start
      AND (p_source_quote_id IS NULL OR source_quote_id IS DISTINCT FROM p_source_quote_id);

    IF p_source_quote_id IS NOT NULL THEN
      FOR v_resource IN SELECT unnest(ARRAY['unit','box','carton','pallet']) LOOP
        v_amount := greatest(coalesce(nullif(v_quotas->>v_resource, '')::integer, 0), 0);
        IF v_amount > 0 THEN
          UPDATE public.quota_allocations
          SET amount = v_amount, subscription_id = p_subscription_id, period_start = p_period_start,
              expires_at = p_period_end,
              allocation_key = v_key,
              metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                'period_start', p_period_start, 'period_end', p_period_end,
                'plan_version_id', v_plan_version_id, 'quota_snapshot', v_config,
                'allocation_source', p_period_source
              )
          WHERE company_id = v_sub.company_id AND source_quote_id = p_source_quote_id
            AND source = 'subscription' AND quota_type = 'base' AND resource = v_resource
            AND allocation_key IS NULL
            AND nullif(metadata->>'period_start','')::timestamptz = p_period_start
            AND nullif(metadata->>'period_end','')::timestamptz = p_period_end;
        ELSE
          UPDATE public.quota_allocations
          SET expires_at = p_period_start,
              metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('expired_at_period_start', p_period_start)
          WHERE company_id = v_sub.company_id AND source_quote_id = p_source_quote_id
            AND source = 'subscription' AND quota_type = 'base' AND resource = v_resource
            AND allocation_key IS NULL AND expires_at > p_period_start
            AND nullif(metadata->>'period_start','')::timestamptz = p_period_start
            AND nullif(metadata->>'period_end','')::timestamptz = p_period_end;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Complete only missing positive allocations from the period's locked
  -- snapshot. Existing rows are never rewritten on a duplicate invocation.
  FOR v_resource IN SELECT unnest(ARRAY['unit','box','carton','pallet']) LOOP
    v_amount := greatest(coalesce(nullif(v_quotas->>v_resource, '')::integer, 0), 0);
    IF v_amount <= 0 THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.quota_allocations qa
      WHERE qa.company_id = v_sub.company_id AND qa.subscription_id = p_subscription_id
        AND qa.resource = v_resource AND qa.source = 'subscription' AND qa.quota_type = 'base'
        AND qa.allocation_key = v_key
    ) THEN
      INSERT INTO public.quota_allocations(
        company_id, subscription_id, source, quota_type, resource, amount,
        expires_at, period_start, allocation_key, source_quote_id, metadata
      ) VALUES (
        v_sub.company_id, p_subscription_id, 'subscription', 'base', v_resource, v_amount,
        p_period_end, p_period_start, v_key, NULL,
        jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end,
                           'plan_version_id', v_plan_version_id, 'quota_snapshot', v_config,
                           'allocation_source', p_period_source)
      ) ON CONFLICT (company_id, allocation_key, resource) WHERE allocation_key IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;

  UPDATE public.company_subscriptions
  SET current_period_start = p_period_start,
      current_period_end = p_period_end,
      plan_version_id = coalesce(v_plan_version_id, plan_version_id),
      updated_at = now()
  WHERE id = p_subscription_id AND (current_period_start IS NULL OR current_period_start <= p_period_start);

  RETURN jsonb_build_object(
    'success', true, 'created', coalesce(v_inserted, false),
    'subscription_id', p_subscription_id, 'company_id', v_sub.company_id,
    'period_start', p_period_start, 'period_end', p_period_end,
    'plan_version_id', v_plan_version_id, 'quota_snapshot', v_config
  );
END;
$$;

-- Repair/backfill active FREE periods. Existing valid allocation rows are
-- preserved; a missing current period is anchored to activation, and its
-- opening snapshot is resolved from admin audit history at the period start.
DO $$
DECLARE
  v_sub record;
  v_anchor timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_existing_start timestamptz;
  v_existing_end timestamptz;
  v_snapshot jsonb;
  v_period_id uuid;
  v_has_allocation boolean;
BEGIN
  FOR v_sub IN
    SELECT cs.id, cs.company_id, cs.plan_template_id, cs.plan_version_id,
           cs.activated_at, cs.current_period_start, cs.current_period_end
    FROM public.company_subscriptions cs
    JOIN public.subscription_plan_templates t ON t.id = cs.plan_template_id
    WHERE upper(t.name) = 'FREE' AND lower(coalesce(cs.status,'')) = 'active'
  LOOP
    v_period_id := NULL;
    v_has_allocation := false;
    v_anchor := coalesce(v_sub.activated_at, v_sub.current_period_start, now());
    SELECT w.period_start, w.period_end INTO v_start, v_end
    FROM public.get_subscription_cycle_window(v_anchor, 'monthly', now()) w;

    SELECT sp.id,sp.period_start,sp.period_end,
           EXISTS (SELECT 1 FROM public.quota_allocations qa
                   WHERE qa.subscription_id=v_sub.id AND qa.source='subscription' AND qa.quota_type='base'
                     AND qa.resource IN ('unit','box','carton','pallet')
                     AND (qa.period_start=sp.period_start OR qa.metadata->>'period_start'=sp.period_start::text))
    INTO v_period_id,v_existing_start,v_existing_end,v_has_allocation
    FROM public.subscription_quota_periods sp
    WHERE sp.subscription_id = v_sub.id AND sp.source = 'free_monthly'
      AND sp.period_start = v_start AND sp.period_end = v_end
    LIMIT 1;

    IF v_period_id IS NOT NULL AND coalesce(v_has_allocation,false) THEN
      v_start:=v_existing_start; v_end:=v_existing_end;
      SELECT jsonb_build_object('plan_version_id',v_sub.plan_version_id,'quotas',jsonb_build_object(
        'unit',coalesce(sum(qa.amount) FILTER(WHERE qa.resource='unit'),0),
        'box',coalesce(sum(qa.amount) FILTER(WHERE qa.resource='box'),0),
        'carton',coalesce(sum(qa.amount) FILTER(WHERE qa.resource='carton'),0),
        'pallet',coalesce(sum(qa.amount) FILTER(WHERE qa.resource='pallet'),0)
      )) INTO v_snapshot
      FROM public.quota_allocations qa
      WHERE qa.subscription_id=v_sub.id AND qa.source='subscription' AND qa.quota_type='base'
        AND (qa.period_start=v_start OR qa.metadata->>'period_start'=v_start::text)
        AND qa.resource IN ('unit','box','carton','pallet');
      UPDATE public.subscription_quota_periods sp
      SET quota_snapshot_json=coalesce(sp.quota_snapshot_json,v_snapshot),
          plan_version_id=coalesce(sp.plan_version_id,nullif(v_snapshot->>'plan_version_id','')::uuid)
      WHERE sp.id=v_period_id;
      UPDATE public.company_subscriptions SET current_period_start=v_start,current_period_end=v_end,updated_at=now()
      WHERE id=v_sub.id;
      CONTINUE;
    END IF;

    IF v_period_id IS NULL THEN
      SELECT sp.id,
             sp.period_start,
             sp.period_end,
             EXISTS (SELECT 1 FROM public.quota_allocations qa
                     WHERE qa.subscription_id = v_sub.id AND qa.source='subscription' AND qa.quota_type='base'
                       AND qa.resource IN ('unit','box','carton','pallet')
                       AND (qa.period_start = sp.period_start OR qa.metadata->>'period_start' = sp.period_start::text))
      INTO v_period_id, v_existing_start, v_existing_end, v_has_allocation
      FROM public.subscription_quota_periods sp
      WHERE sp.subscription_id = v_sub.id AND sp.source = 'free_monthly' AND sp.period_end > now()
      ORDER BY sp.period_start DESC LIMIT 1;

      IF v_period_id IS NOT NULL AND coalesce(v_has_allocation, false) THEN
        -- A valid current allocation is immutable. Preserve its existing window.
        v_start := v_existing_start;
        v_end := v_existing_end;
        SELECT jsonb_build_object('plan_version_id',v_sub.plan_version_id,'quotas',jsonb_build_object(
          'unit',coalesce(sum(qa.amount) FILTER(WHERE qa.resource='unit'),0),
          'box',coalesce(sum(qa.amount) FILTER(WHERE qa.resource='box'),0),
          'carton',coalesce(sum(qa.amount) FILTER(WHERE qa.resource='carton'),0),
          'pallet',coalesce(sum(qa.amount) FILTER(WHERE qa.resource='pallet'),0)
        )) INTO v_snapshot
        FROM public.quota_allocations qa
        WHERE qa.subscription_id=v_sub.id AND qa.source='subscription' AND qa.quota_type='base'
          AND (qa.period_start=v_start OR qa.metadata->>'period_start'=v_start::text)
          AND qa.resource IN ('unit','box','carton','pallet');
        UPDATE public.subscription_quota_periods sp
        SET quota_snapshot_json=coalesce(sp.quota_snapshot_json,v_snapshot),
            plan_version_id=coalesce(sp.plan_version_id,nullif(v_snapshot->>'plan_version_id','')::uuid)
        WHERE sp.id=v_period_id;
        UPDATE public.company_subscriptions SET current_period_start=v_start,current_period_end=v_end,updated_at=now()
        WHERE id=v_sub.id;
        CONTINUE;
      END IF;

      IF v_period_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.subscription_quota_periods x WHERE x.subscription_id=v_sub.id AND x.period_start=v_start) THEN
        UPDATE public.subscription_quota_periods SET period_start=v_start,period_end=v_end WHERE id=v_period_id;
      ELSE
        v_period_id:=NULL;
      END IF;
    END IF;

    v_snapshot := public.resolve_plan_quota_snapshot_at(v_sub.plan_template_id, v_start);
    IF v_period_id IS NULL THEN
      INSERT INTO public.subscription_quota_periods(
        company_id, subscription_id, period_start, period_end, source, plan_version_id, quota_snapshot_json
      ) VALUES (
        v_sub.company_id, v_sub.id, v_start, v_end, 'free_monthly',
        nullif(v_snapshot->>'plan_version_id','')::uuid, v_snapshot
      ) ON CONFLICT (subscription_id, period_start) DO NOTHING
      RETURNING id INTO v_period_id;
      IF v_period_id IS NULL THEN
        SELECT id INTO v_period_id FROM public.subscription_quota_periods WHERE subscription_id=v_sub.id AND period_start=v_start;
      END IF;
    ELSE
      -- Only fill a missing historical snapshot. A valid allocation remains the
      -- source of truth for an already-open period.
      UPDATE public.subscription_quota_periods sp
      SET plan_version_id = coalesce(sp.plan_version_id, nullif(v_snapshot->>'plan_version_id','')::uuid),
          quota_snapshot_json = coalesce(sp.quota_snapshot_json, v_snapshot),
          period_end = CASE WHEN sp.period_start = v_start THEN v_end ELSE sp.period_end END
      WHERE sp.id = v_period_id;
    END IF;

    UPDATE public.company_subscriptions
    SET current_period_start = v_start, current_period_end = v_end,
        plan_version_id = coalesce(v_sub.plan_version_id, nullif(v_snapshot->>'plan_version_id','')::uuid),
        updated_at = now()
    WHERE id = v_sub.id AND NOT coalesce(v_has_allocation, false);

    PERFORM public.allocate_subscription_quota_period(
      v_sub.id, v_start, v_end, 'free_monthly', NULL, NULL
    );
    v_period_id := NULL;
    v_has_allocation := false;
  END LOOP;
END;
$$;

-- Backfill period snapshots for paid customers from their existing allocations;
-- do not change or recreate their current quota rows.
DO $$
DECLARE
  v_sub record;
  v_quotas jsonb;
BEGIN
  FOR v_sub IN
    SELECT cs.id, cs.company_id, cs.plan_version_id, cs.current_period_start, cs.current_period_end,
           lower(coalesce(cs.billing_cycle,t.billing_cycle,'monthly')) AS billing_cycle
    FROM public.company_subscriptions cs
    JOIN public.subscription_plan_templates t ON t.id=cs.plan_template_id
    WHERE upper(t.name) <> 'FREE' AND lower(coalesce(cs.status,'')) IN ('active','authenticated')
      AND cs.current_period_start IS NOT NULL AND cs.current_period_end IS NOT NULL
  LOOP
    SELECT jsonb_build_object(
      'plan_version_id', v_sub.plan_version_id,
      'quotas', jsonb_build_object(
        'unit', coalesce(sum(amount) FILTER (WHERE resource='unit'),0),
        'box', coalesce(sum(amount) FILTER (WHERE resource='box'),0),
        'carton', coalesce(sum(amount) FILTER (WHERE resource='carton'),0),
        'pallet', coalesce(sum(amount) FILTER (WHERE resource='pallet'),0)
      )
    ) INTO v_quotas
    FROM public.quota_allocations qa
    WHERE qa.company_id=v_sub.company_id AND qa.source='subscription' AND qa.quota_type='base'
      AND qa.resource IN ('unit','box','carton','pallet')
      AND (qa.period_start=v_sub.current_period_start OR qa.metadata->>'period_start'=v_sub.current_period_start::text
        OR (qa.period_start IS NULL AND qa.expires_at=v_sub.current_period_end));

    IF EXISTS (SELECT 1 FROM public.quota_allocations qa WHERE qa.company_id=v_sub.company_id
      AND qa.source='subscription' AND qa.quota_type='base' AND qa.resource IN ('unit','box','carton','pallet')
      AND (qa.period_start=v_sub.current_period_start OR qa.metadata->>'period_start'=v_sub.current_period_start::text
        OR (qa.period_start IS NULL AND qa.expires_at=v_sub.current_period_end))) THEN
      INSERT INTO public.subscription_quota_periods(
        company_id,subscription_id,period_start,period_end,source,plan_version_id,quota_snapshot_json
      ) VALUES (
        v_sub.company_id,v_sub.id,v_sub.current_period_start,v_sub.current_period_end,
        CASE WHEN v_sub.billing_cycle='yearly' THEN 'paid_yearly' ELSE 'paid_monthly' END,
        v_sub.plan_version_id,v_quotas
      ) ON CONFLICT (subscription_id,period_start) DO NOTHING;

      UPDATE public.quota_allocations qa
      SET subscription_id=v_sub.id, period_start=v_sub.current_period_start,
          allocation_key='subscription:'||v_sub.id::text||':'||v_sub.current_period_start::text,
          metadata=coalesce(qa.metadata,'{}'::jsonb)||jsonb_build_object('period_start',v_sub.current_period_start,'period_end',v_sub.current_period_end)
      WHERE qa.company_id=v_sub.company_id AND qa.source='subscription' AND qa.quota_type='base'
        AND qa.resource IN ('unit','box','carton','pallet') AND qa.expires_at=v_sub.current_period_end
        AND qa.allocation_key IS NULL
        AND (qa.metadata->>'period_start'=v_sub.current_period_start::text OR qa.period_start=v_sub.current_period_start OR qa.period_start IS NULL);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_default_free_subscription(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription_id uuid;
  v_template_id uuid;
  v_anchor timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_snapshot jsonb;
BEGIN
  PERFORM 1 FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMPANY_NOT_FOUND'; END IF;

  SELECT cs.id, cs.plan_template_id, cs.activated_at, cs.current_period_start, cs.current_period_end
  INTO v_subscription_id, v_template_id, v_anchor, v_start, v_end
  FROM public.company_subscriptions cs
  WHERE cs.company_id=p_company_id AND lower(cs.status)='active'
  ORDER BY cs.updated_at DESC NULLS LAST,cs.created_at DESC LIMIT 1 FOR UPDATE;

  IF v_subscription_id IS NOT NULL THEN
    IF upper((SELECT name FROM public.subscription_plan_templates WHERE id=v_template_id)) <> 'FREE' THEN
      RETURN v_subscription_id;
    END IF;
    IF v_start IS NULL OR v_end IS NULL THEN
      v_anchor := coalesce(v_anchor,now());
      SELECT w.period_start,w.period_end INTO v_start,v_end FROM public.get_subscription_cycle_window(v_anchor,'monthly',now()) w;
      v_snapshot := public.resolve_plan_quota_snapshot_at(v_template_id,v_start);
      PERFORM public.allocate_subscription_quota_period(v_subscription_id,v_start,v_end,'free_monthly',v_snapshot,NULL);
    END IF;
    RETURN v_subscription_id;
  END IF;

  SELECT id INTO v_template_id FROM public.subscription_plan_templates
  WHERE upper(name)='FREE' AND is_active ORDER BY created_at LIMIT 1;
  IF v_template_id IS NULL THEN RAISE EXCEPTION 'FREE_PLAN_NOT_CONFIGURED'; END IF;
  v_anchor := now();
  v_start := v_anchor;
  v_end := v_anchor + interval '1 month';
  v_snapshot := public.resolve_plan_quota_snapshot_at(v_template_id,v_start);

  INSERT INTO public.company_subscriptions(
    company_id,status,plan_template_id,plan_version_id,billing_cycle,
    current_period_start,current_period_end,activated_at,start_date,metadata,updated_at
  ) VALUES (
    p_company_id,'active',v_template_id,nullif(v_snapshot->>'plan_version_id','')::uuid,'monthly',
    v_start,v_end,v_anchor,v_start,jsonb_build_object('activation_source','company_setup'),now()
  ) RETURNING id INTO v_subscription_id;

  PERFORM public.allocate_subscription_quota_period(v_subscription_id,v_start,v_end,'free_monthly',v_snapshot,NULL);
  RETURN v_subscription_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_paid_subscription_period(
  p_subscription_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.company_subscriptions%ROWTYPE;
  v_cycle text;
  v_source text;
  v_quote_id uuid;
  v_config jsonb;
  v_period_exists boolean;
BEGIN
  SELECT * INTO v_sub FROM public.company_subscriptions WHERE id=p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  SELECT lower(coalesce(v_sub.billing_cycle,t.billing_cycle,'monthly')) INTO v_cycle
  FROM public.subscription_plan_templates t WHERE t.id=v_sub.plan_template_id;
  IF v_cycle NOT IN ('monthly','yearly') THEN RAISE EXCEPTION 'UNSUPPORTED_BILLING_CYCLE'; END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end<=p_period_start THEN RAISE EXCEPTION 'INVALID_SUBSCRIPTION_PERIOD'; END IF;
  IF v_cycle='monthly' AND p_period_end>p_period_start+interval '1 month 1 day' THEN RAISE EXCEPTION 'INVALID_MONTHLY_PERIOD'; END IF;
  IF v_cycle='yearly' AND p_period_end>p_period_start+interval '1 year 1 day' THEN RAISE EXCEPTION 'INVALID_YEARLY_PERIOD'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.subscription_quota_periods WHERE subscription_id=p_subscription_id AND period_start=p_period_start)
  INTO v_period_exists;
  v_quote_id := nullif(v_sub.metadata->>'quote_id','')::uuid;
  v_source := CASE WHEN v_cycle='yearly' THEN 'paid_yearly' ELSE 'paid_monthly' END;
  v_config := public.resolve_plan_quota_snapshot_at(v_sub.plan_template_id,p_period_start);

  -- Preserve existing paid capacities through their provider-confirmed term;
  -- capacities are not part of the consumable quota reset.
  IF v_quote_id IS NOT NULL THEN
    UPDATE public.quota_allocations
    SET expires_at=p_period_end,subscription_id=p_subscription_id,period_start=p_period_start
    WHERE company_id=v_sub.company_id AND source_quote_id=v_quote_id
      AND source='subscription' AND quota_type='base' AND resource IN ('seats','plants','handsets');
  END IF;

  RETURN public.allocate_subscription_quota_period(
    p_subscription_id,p_period_start,p_period_end,v_source,v_config,v_quote_id
  ) || jsonb_build_object('duplicate',v_period_exists);
END;
$$;

CREATE OR REPLACE FUNCTION public.run_universal_subscription_reset(p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_anchor timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_next_start timestamptz;
  v_next_end timestamptz;
  v_cycle_index integer;
  v_step integer;
  v_cycle_no integer;
  v_result jsonb;
  v_periods jsonb := '[]'::jsonb;
  v_expired integer := 0;
BEGIN
  FOR v_sub IN
    SELECT cs.id,cs.company_id,cs.plan_template_id,cs.activated_at,cs.current_period_start,cs.current_period_end
    FROM public.company_subscriptions cs
    JOIN public.subscription_plan_templates t ON t.id=cs.plan_template_id
    WHERE upper(t.name)='FREE' AND lower(coalesce(cs.status,''))='active'
      AND (cs.current_period_end IS NULL OR cs.current_period_end<=p_at)
    ORDER BY cs.company_id
  LOOP
    PERFORM 1 FROM public.companies WHERE id=v_sub.company_id FOR UPDATE;
    PERFORM 1 FROM public.company_subscriptions WHERE id=v_sub.id FOR UPDATE;
    v_anchor:=coalesce(v_sub.activated_at,v_sub.current_period_start,p_at);
    v_start:=coalesce(v_sub.current_period_start,v_anchor);
    v_end:=coalesce(v_sub.current_period_end,v_start+interval '1 month');
    v_step:=1;
    v_cycle_index:=1;
    WHILE v_anchor+make_interval(months=>v_cycle_index)<v_start AND v_cycle_index<2400 LOOP
      v_cycle_index:=v_cycle_index+v_step;
    END LOOP;
    v_cycle_no:=0;
    WHILE v_end<=p_at AND v_cycle_no<120 LOOP
      v_next_start:=v_end;
      SELECT w.period_start,w.period_end INTO v_next_start,v_next_end
      FROM public.get_subscription_cycle_window(v_anchor,'monthly',v_next_start) w;
      v_result:=public.allocate_subscription_quota_period(v_sub.id,v_next_start,v_next_end,'free_monthly',NULL,NULL);
      IF coalesce((v_result->>'created')::boolean,false) THEN
        v_periods:=v_periods||jsonb_build_array(jsonb_build_object(
          'company_id',v_sub.company_id,'subscription_id',v_sub.id,
          'period_start',v_next_start,'period_end',v_next_end
        ));
      END IF;
      v_start:=v_next_start;
      v_end:=v_next_end;
      v_cycle_no:=v_cycle_no+1;
    END LOOP;
  END LOOP;

  UPDATE public.company_subscriptions cs SET status='expired',updated_at=p_at
  FROM public.subscription_plan_templates t
  WHERE t.id=cs.plan_template_id AND upper(t.name)<>'FREE'
    AND lower(coalesce(cs.status,'')) IN ('active','authenticated','pending','paused','past_due','cancelled','canceled')
    AND cs.current_period_end IS NOT NULL AND cs.current_period_end<=p_at;
  GET DIAGNOSTICS v_expired=ROW_COUNT;

  RETURN jsonb_build_object('success',true,'free_periods',v_periods,
    'paid_subscriptions_expired',v_expired,'processed_at',p_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_entitlement_snapshot(p_company_id uuid,p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_period record;
  v_start timestamptz;
  v_end timestamptz;
  v_free boolean:=false;
  v_unit integer:=0; v_box integer:=0; v_carton integer:=0; v_pallet integer:=0;
  v_used_unit integer:=0; v_used_box integer:=0; v_used_carton integer:=0; v_used_pallet integer:=0;
  v_seat_limit integer:=0; v_plant_limit integer:=0; v_handset_limit integer:=0;
  v_seats integer:=0; v_plants integer:=0; v_handsets integer:=0;
  v_topup_unit integer:=0; v_topup_box integer:=0; v_topup_carton integer:=0; v_topup_pallet integer:=0;
  v_limits jsonb; v_usage jsonb; v_topups jsonb; v_remaining jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=p_company_id) THEN RAISE EXCEPTION 'COMPANY_NOT_FOUND'; END IF;
  SELECT cs.*,upper(coalesce(t.name,'')) AS plan_name,t.billing_cycle AS template_cycle,
    pv.seat_limit AS version_seat_limit,pv.plant_limit AS version_plant_limit,pv.handset_limit AS version_handset_limit
  INTO v_sub
  FROM public.company_subscriptions cs
  LEFT JOIN public.subscription_plan_templates t ON t.id=cs.plan_template_id
  LEFT JOIN LATERAL (
    SELECT candidate.seat_limit,candidate.plant_limit,candidate.handset_limit
    FROM public.subscription_plan_versions candidate
    WHERE candidate.id=cs.plan_version_id OR (cs.plan_version_id IS NULL AND candidate.template_id=cs.plan_template_id)
    ORDER BY (candidate.id=cs.plan_version_id) DESC,candidate.is_active DESC,candidate.version_number DESC LIMIT 1
  ) pv ON true
  WHERE cs.company_id=p_company_id
    AND (lower(coalesce(cs.status,'')) IN ('active','authenticated','pending','paused','past_due')
      OR (lower(coalesce(cs.status,'')) IN ('cancelled','canceled') AND cs.cancel_at_period_end AND cs.current_period_end>p_at))
  ORDER BY cs.updated_at DESC NULLS LAST,cs.created_at DESC LIMIT 1;
  v_free:=coalesce(v_sub.plan_name='FREE',false);

  SELECT sp.period_start,sp.period_end,sp.quota_snapshot_json INTO v_period
  FROM public.subscription_quota_periods sp
  WHERE sp.subscription_id=v_sub.id AND sp.period_start<=p_at AND sp.period_end>p_at
  ORDER BY sp.period_start DESC LIMIT 1;

  IF v_period.period_start IS NOT NULL THEN
    v_start:=v_period.period_start; v_end:=v_period.period_end;
  ELSIF v_free THEN
    SELECT w.period_start,w.period_end INTO v_start,v_end
    FROM public.get_subscription_cycle_window(coalesce(v_sub.activated_at,v_sub.current_period_start,p_at),'monthly',p_at) w;
  ELSE
    v_start:=coalesce(v_sub.current_period_start,v_sub.activated_at,date_trunc('month',p_at));
    v_end:=coalesce(v_sub.current_period_end,v_start+interval '1 month');
  END IF;

  SELECT coalesce(sum(qa.amount) FILTER(WHERE qa.resource='unit'),0)::int,
         coalesce(sum(qa.amount) FILTER(WHERE qa.resource='box'),0)::int,
         coalesce(sum(qa.amount) FILTER(WHERE qa.resource='carton'),0)::int,
         coalesce(sum(qa.amount) FILTER(WHERE qa.resource='pallet'),0)::int,
         coalesce(sum(qa.amount) FILTER(WHERE qa.resource='seats' AND qa.source='addon'),0)::int,
         coalesce(sum(qa.amount) FILTER(WHERE qa.resource='plants' AND qa.source='addon'),0)::int,
         coalesce(sum(qa.amount) FILTER(WHERE qa.resource='handsets' AND qa.source='addon'),0)::int
  INTO v_unit,v_box,v_carton,v_pallet,v_seat_limit,v_plant_limit,v_handset_limit
  FROM public.quota_allocations qa
  WHERE qa.company_id=p_company_id AND qa.expires_at>p_at
    AND (qa.source<>'subscription' OR qa.period_start=v_start OR qa.metadata->>'period_start'=v_start::text
      OR (qa.period_start IS NULL AND qa.expires_at=v_end));

  v_seat_limit:=v_seat_limit+coalesce(v_sub.version_seat_limit,0);
  v_plant_limit:=v_plant_limit+coalesce(v_sub.version_plant_limit,0);
  v_handset_limit:=v_handset_limit+coalesce(v_sub.version_handset_limit,0);

  SELECT coalesce(sum(uc.used_quantity) FILTER(WHERE uc.metric_type='UNIT'),0)::int,
         coalesce(sum(uc.used_quantity) FILTER(WHERE uc.metric_type='BOX'),0)::int,
         coalesce(sum(uc.used_quantity) FILTER(WHERE uc.metric_type='CARTON'),0)::int,
         coalesce(sum(uc.used_quantity) FILTER(WHERE uc.metric_type='SSCC'),0)::int
  INTO v_used_unit,v_used_box,v_used_carton,v_used_pallet
  FROM public.usage_counters uc WHERE uc.company_id=p_company_id AND uc.period_start=v_start::date;

  SELECT count(*)::int INTO v_seats FROM public.seats WHERE company_id=p_company_id AND status='active' AND coalesce(active,false);
  SELECT count(*)::int INTO v_plants FROM public.plants WHERE company_id=p_company_id AND status='active';
  IF to_regclass('public.handset') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM public.handset WHERE company_id=$1 AND lower(coalesce(status,''active''))=''active''' INTO v_handsets USING p_company_id;
  ELSIF to_regclass('public.handsets') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM public.handsets WHERE company_id=$1 AND lower(coalesce(status,''active''))=''active''' INTO v_handsets USING p_company_id;
  END IF;

  SELECT coalesce(sum(amount) FILTER(WHERE resource='unit'),0)::int,
         coalesce(sum(amount) FILTER(WHERE resource='box'),0)::int,
         coalesce(sum(amount) FILTER(WHERE resource='carton'),0)::int,
         coalesce(sum(amount) FILTER(WHERE resource='pallet'),0)::int
  INTO v_topup_unit,v_topup_box,v_topup_carton,v_topup_pallet
  FROM public.quota_allocations
  WHERE company_id=p_company_id AND expires_at>p_at AND source='addon' AND quota_type='variable';

  v_limits:=jsonb_build_object('unit',v_unit,'box',v_box,'carton',v_carton,'pallet',v_pallet,'seat',v_seat_limit,'plant',v_plant_limit,'handset',v_handset_limit);
  v_usage:=jsonb_build_object('unit',v_used_unit,'box',v_used_box,'carton',v_used_carton,'pallet',v_used_pallet,'seat',v_seats,'plant',v_plants,'handset',v_handsets);
  v_topups:=jsonb_build_object('unit',v_topup_unit,'box',v_topup_box,'carton',v_topup_carton,'pallet',v_topup_pallet);
  v_remaining:=jsonb_build_object('unit',greatest(v_unit-v_used_unit,0),'box',greatest(v_box-v_used_box,0),'carton',greatest(v_carton-v_used_carton,0),'pallet',greatest(v_pallet-v_used_pallet,0),
    'seat',greatest(v_seat_limit-v_seats,0),'plant',greatest(v_plant_limit-v_plants,0),'handset',greatest(v_handset_limit-v_handsets,0));

  RETURN jsonb_build_object(
    'state',CASE WHEN v_sub.id IS NULL THEN 'NO_ACTIVE_SUBSCRIPTION' WHEN v_free THEN 'FREE_ACTIVE' ELSE 'PAID_ACTIVE' END,
    'plan_name',v_sub.plan_name,'billing_cycle',coalesce(v_sub.billing_cycle,v_sub.template_cycle),
    'lifetime',v_free,'period_start',v_start,'period_end',v_end,'quota_period_end',v_end,
    'limits',v_limits,'usage',v_usage,'topups',v_topups,'remaining',v_remaining,
    'blocked',v_sub.id IS NULL OR (NOT v_free AND v_end<=p_at)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_subscription_cycle_window(timestamptz,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resolve_plan_quota_snapshot_at(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.allocate_subscription_quota_period(uuid,timestamptz,timestamptz,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.activate_default_free_subscription(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.allocate_paid_subscription_period(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.run_universal_subscription_reset(timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_company_entitlement_snapshot(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_subscription_cycle_window(timestamptz,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_plan_quota_snapshot_at(uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_subscription_quota_period(uuid,timestamptz,timestamptz,text,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_default_free_subscription(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_paid_subscription_period(uuid,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_universal_subscription_reset(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_entitlement_snapshot(uuid,timestamptz) TO authenticated,service_role;
