-- Unify company access under company_subscriptions with a zero-quota FREE plan.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS subscription_page_seen_at timestamptz;
ALTER TABLE public.subscription_plan_templates
  ALTER COLUMN razorpay_plan_id DROP NOT NULL;

UPDATE public.subscription_plan_templates SET name = 'ENTERPRISE' WHERE lower(name) = 'scale';
UPDATE public.subscription_plan_templates
SET is_active = false
WHERE lower(name) NOT IN ('free', 'starter', 'growth', 'enterprise');

INSERT INTO public.subscription_plan_templates (name, razorpay_plan_id, billing_cycle, amount_from_razorpay, is_active)
VALUES ('FREE', NULL, 'monthly', 0, true)
ON CONFLICT DO NOTHING;

WITH free_template AS (
  SELECT id FROM public.subscription_plan_templates WHERE upper(name) = 'FREE' ORDER BY created_at LIMIT 1
)
INSERT INTO public.subscription_plan_versions (template_id, version_number, unit_limit, box_limit, carton_limit, pallet_limit, seat_limit, plant_limit, handset_limit)
SELECT id, 1, 0, 0, 0, 0, 0, 0, 0 FROM free_template
ON CONFLICT (template_id, version_number) DO NOTHING;

CREATE OR REPLACE FUNCTION public.activate_default_free_subscription(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription_id uuid;
  v_template_id uuid;
  v_version_id uuid;
BEGIN
  SELECT id INTO v_subscription_id FROM public.company_subscriptions
  WHERE company_id = p_company_id AND lower(status) = 'active'
  ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1;
  IF v_subscription_id IS NOT NULL THEN RETURN v_subscription_id; END IF;

  SELECT id INTO v_template_id FROM public.subscription_plan_templates
  WHERE upper(name) = 'FREE' AND is_active ORDER BY created_at LIMIT 1;
  IF v_template_id IS NULL THEN RAISE EXCEPTION 'FREE_PLAN_NOT_CONFIGURED'; END IF;

  SELECT id INTO v_version_id FROM public.subscription_plan_versions
  WHERE template_id = v_template_id AND is_active ORDER BY version_number DESC LIMIT 1;
  IF v_version_id IS NULL THEN RAISE EXCEPTION 'FREE_PLAN_VERSION_NOT_CONFIGURED'; END IF;

  INSERT INTO public.company_subscriptions (company_id, status, plan_template_id, plan_version_id, activated_at, metadata, updated_at)
  VALUES (p_company_id, 'active', v_template_id, v_version_id, now(), jsonb_build_object('activation_source', 'company_setup'), now())
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_subscription_id FROM public.company_subscriptions
  WHERE company_id = p_company_id ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1;
  RETURN v_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_default_free_subscription(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_default_free_subscription(uuid) TO service_role;

DO $$
DECLARE company_row record;
BEGIN
  FOR company_row IN
    SELECT c.id FROM public.companies c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.company_subscriptions cs
      WHERE cs.company_id = c.id AND lower(cs.status) = 'active'
    )
  LOOP
    PERFORM public.activate_default_free_subscription(company_row.id);
  END LOOP;
END;
$$;

-- Replace the snapshot before dropping the table it previously read.
CREATE OR REPLACE FUNCTION public.get_company_entitlement_snapshot(p_company_id uuid, p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_start timestamptz;
  v_end timestamptz;
  v_limits jsonb;
  v_usage jsonb;
  v_topups jsonb;
  v_remaining jsonb;
  v_has_access boolean := false;
  u int := 0; b int := 0; c int := 0; p int := 0;
  lu int := 0; lb int := 0; lc int := 0; lp int := 0;
  s int := 0; pl int := 0; h int := 0;
  ls int := 0; lpl int := 0; lh int := 0;
BEGIN
  SELECT cs.*, pv.unit_limit, pv.box_limit, pv.carton_limit, pv.pallet_limit,
         pv.seat_limit, pv.plant_limit, pv.handset_limit, t.name AS plan_name
  INTO v_sub
  FROM public.company_subscriptions cs
  LEFT JOIN public.subscription_plan_versions pv ON pv.id = cs.plan_version_id
  LEFT JOIN public.subscription_plan_templates t ON t.id = cs.plan_template_id
  WHERE cs.company_id = p_company_id
    AND (lower(coalesce(cs.status, '')) IN ('active','authenticated','pending','paused','past_due')
      OR (lower(coalesce(cs.status, '')) IN ('cancelled','canceled') AND cs.cancel_at_period_end))
  ORDER BY cs.updated_at DESC NULLS LAST, cs.created_at DESC LIMIT 1;

  v_start := COALESCE(v_sub.current_period_start, v_sub.activated_at, date_trunc('month', p_at));
  v_end := COALESCE(v_sub.current_period_end, date_trunc('month', p_at) + interval '1 month');
  v_has_access := v_sub.id IS NOT NULL
    AND (v_sub.current_period_end IS NULL OR v_sub.current_period_end > p_at)
    AND (lower(coalesce(v_sub.status, '')) IN ('active','authenticated','pending','paused','past_due')
      OR (lower(coalesce(v_sub.status, '')) IN ('cancelled','canceled') AND v_sub.cancel_at_period_end));

  IF to_regclass('public.usage_events') IS NOT NULL THEN
    SELECT coalesce(sum(quantity) FILTER (WHERE metric_type='UNIT'),0)::int,
           coalesce(sum(quantity) FILTER (WHERE metric_type='BOX'),0)::int,
           coalesce(sum(quantity) FILTER (WHERE metric_type='CARTON'),0)::int,
           coalesce(sum(quantity) FILTER (WHERE metric_type='SSCC'),0)::int
    INTO u,b,c,p FROM public.usage_events
    WHERE company_id=p_company_id AND created_at >= v_start AND created_at < v_end;
  END IF;

  SELECT count(*)::int INTO s FROM public.seats WHERE company_id=p_company_id AND status='active' AND coalesce(active,false);
  SELECT count(*)::int INTO pl FROM public.plants WHERE company_id=p_company_id AND status='active';
  IF to_regclass('public.handset') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM public.handset WHERE company_id=$1 AND lower(coalesce(status, ''active''))=''active''' INTO h USING p_company_id;
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE resource='unit'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='box'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='carton'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='pallet'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='seats'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='plants'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='handsets'),0)::int
  INTO lu,lb,lc,lp,ls,lpl,lh FROM public.quota_allocations
  WHERE company_id=p_company_id AND expires_at > p_at;
  v_limits := jsonb_build_object('unit',greatest(lu,0),'box',greatest(lb,0),'carton',greatest(lc,0),'pallet',greatest(lp,0),'seat',greatest(ls,0),'plant',greatest(lpl,0),'handset',greatest(lh,0));
  v_usage := jsonb_build_object('unit',u,'box',b,'carton',c,'pallet',p,'seat',s,'plant',pl,'handset',h);
  v_remaining := jsonb_build_object('unit',greatest(lu-u,0),'box',greatest(lb-b,0),'carton',greatest(lc-c,0),'pallet',greatest(lp-p,0),'seat',greatest(ls-s,0),'plant',greatest(lpl-pl,0),'handset',greatest(lh-h,0));
  SELECT coalesce(sum(amount) FILTER (WHERE resource='unit'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='box'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='carton'),0)::int,
         coalesce(sum(amount) FILTER (WHERE resource='pallet'),0)::int
  INTO u,b,c,p FROM public.quota_allocations
  WHERE company_id=p_company_id AND expires_at > p_at AND source='addon' AND quota_type='variable';
  v_topups := jsonb_build_object('unit',u,'box',b,'carton',c,'pallet',p);
  RETURN jsonb_build_object('state',CASE WHEN v_has_access THEN 'PAID_ACTIVE' ELSE 'NO_ACTIVE_SUBSCRIPTION' END,'plan_name',v_sub.plan_name,'period_start',v_start,'period_end',v_end,'limits',v_limits,'usage',v_usage,'topups',v_topups,'remaining',v_remaining,'blocked',NOT v_has_access);
END;
$$;

DELETE FROM public.quota_allocations WHERE source = 'trial';
DROP FUNCTION IF EXISTS public.cancel_company_trial(uuid);
DROP FUNCTION IF EXISTS public.trial_usage_summary(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.admin_company_reset_trial_mutation(uuid, uuid, text, text, text, text, text);
DROP TABLE IF EXISTS public.company_trials CASCADE;
DROP TABLE IF EXISTS public.trial_reset_logs CASCADE;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS trial_start_date CASCADE,
  DROP COLUMN IF EXISTS trial_end_date CASCADE,
  DROP COLUMN IF EXISTS trial_started_at CASCADE,
  DROP COLUMN IF EXISTS trial_expires_at CASCADE,
  DROP COLUMN IF EXISTS trial_start_at CASCADE,
  DROP COLUMN IF EXISTS trial_end_at CASCADE,
  DROP COLUMN IF EXISTS trial_activated_at CASCADE,
  DROP COLUMN IF EXISTS trial_activated_payment_id CASCADE,
  DROP COLUMN IF EXISTS trial_activated_by_user_id CASCADE,
  DROP COLUMN IF EXISTS trial_ends_at CASCADE,
  DROP COLUMN IF EXISTS trial_status CASCADE;

ALTER TABLE public.company_subscriptions
  DROP COLUMN IF EXISTS is_trial CASCADE,
  DROP COLUMN IF EXISTS trial_end CASCADE;
