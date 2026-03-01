-- Billing add-ons + quota enforcement primitives

-- 0) Ensure setup/billing columns exist on companies (some DBs may not have run setup-flow migrations)
DO $$
DECLARE
  companies_reg regclass;
  full_table text;
BEGIN
  companies_reg := to_regclass('public.companies');
  IF companies_reg IS NULL THEN
    companies_reg := to_regclass('companies');
  END IF;
  IF companies_reg IS NULL THEN
    RAISE EXCEPTION 'companies table not found';
  END IF;

  full_table := companies_reg::text;

  -- Core subscription fields
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS subscription_status TEXT', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS subscription_plan TEXT', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ', full_table);

  -- Add-on entitlements
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS extra_user_seats INTEGER NOT NULL DEFAULT 0', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS extra_erp_integrations INTEGER NOT NULL DEFAULT 0', full_table);

  -- 1) Allow subscription_status = past_due (used by cron billing runner)
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conname = 'companies_subscription_status_check'
      AND c.conrelid = companies_reg
  ) THEN
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT companies_subscription_status_check', full_table);
  END IF;

  EXECUTE format(
    'ALTER TABLE %s ADD CONSTRAINT companies_subscription_status_check CHECK (subscription_status IN (''trial'',''active'',''past_due'',''expired'',''cancelled''))',
    full_table
  );

  EXECUTE format(
    'COMMENT ON COLUMN %s.extra_erp_integrations IS %L',
    full_table,
    'Additional paid ERP integrations purchased as add-ons (added to plan max_integrations)'
  );
END $$;


-- 3) Make billing_usage upsert-safe for (company_id, billing_period_start)
-- Ensure billing_usage exists (required for quota enforcement). We resolve companies table again
-- to keep FK creation correct even if companies is not in public schema.
DO $$
DECLARE
  companies_reg regclass;
  full_table text;
BEGIN
  companies_reg := to_regclass('public.companies');
  IF companies_reg IS NULL THEN
    companies_reg := to_regclass('companies');
  END IF;
  IF companies_reg IS NULL THEN
    RAISE EXCEPTION 'companies table not found';
  END IF;

  full_table := companies_reg::text;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.billing_usage (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      company_id UUID NOT NULL REFERENCES %s(id) ON DELETE CASCADE,
      billing_period_start TIMESTAMPTZ NOT NULL,
      billing_period_end TIMESTAMPTZ NOT NULL,
      plan TEXT NOT NULL,

      unit_labels_quota INTEGER DEFAULT 0,
      box_labels_quota INTEGER DEFAULT 0,
      carton_labels_quota INTEGER DEFAULT 0,
      pallet_labels_quota INTEGER DEFAULT 0,
      user_seats_quota INTEGER DEFAULT 1,

      unit_labels_used INTEGER DEFAULT 0,
      box_labels_used INTEGER DEFAULT 0,
      carton_labels_used INTEGER DEFAULT 0,
      pallet_labels_used INTEGER DEFAULT 0,
      user_seats_used INTEGER DEFAULT 1,

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )',
    full_table
  );

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_billing_usage_company_id ON public.billing_usage(company_id)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_billing_usage_period ON public.billing_usage(billing_period_start, billing_period_end)';
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_billing_usage_company_period_start
  ON public.billing_usage (company_id, billing_period_start);


-- 4) Add / consume / refund quotas (for strict plan limit enforcement)
-- Kind mapping:
--  - 'unit'   -> unit_labels_{quota,used}
--  - 'box'    -> box_labels_{quota,used}
--  - 'carton' -> carton_labels_{quota,used}
--  - 'pallet' -> pallet_labels_{quota,used}

CREATE OR REPLACE FUNCTION public.billing_usage_add_quota(
  p_company_id uuid,
  p_kind text,
  p_qty integer,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(ok boolean, usage_id uuid, quota integer, used integer, remaining integer, error text)
LANGUAGE plpgsql
AS $$
DECLARE
  u public.billing_usage%ROWTYPE;
  quota_col text;
  used_col text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'qty must be a positive integer';
    RETURN;
  END IF;

  IF p_kind = 'unit' THEN
    quota_col := 'unit_labels_quota';
    used_col := 'unit_labels_used';
  ELSIF p_kind = 'box' THEN
    quota_col := 'box_labels_quota';
    used_col := 'box_labels_used';
  ELSIF p_kind = 'carton' THEN
    quota_col := 'carton_labels_quota';
    used_col := 'carton_labels_used';
  ELSIF p_kind = 'pallet' THEN
    quota_col := 'pallet_labels_quota';
    used_col := 'pallet_labels_used';
  ELSE
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'invalid kind';
    RETURN;
  END IF;

  SELECT * INTO u
  FROM public.billing_usage
  WHERE company_id = p_company_id
    AND billing_period_start <= p_now
    AND billing_period_end > p_now
  ORDER BY billing_period_start DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'no active billing_usage row for current period';
    RETURN;
  END IF;

  EXECUTE format(
    'UPDATE public.billing_usage SET %I = COALESCE(%I,0) + $1, updated_at = now() WHERE id = $2 RETURNING %I, %I',
    quota_col, quota_col, quota_col, used_col
  )
  INTO quota, used
  USING p_qty, u.id;

  remaining := GREATEST(0, COALESCE(quota,0) - COALESCE(used,0));
  RETURN QUERY SELECT true, u.id, quota, used, remaining, NULL::text;
END;
$$;


CREATE OR REPLACE FUNCTION public.billing_usage_consume(
  p_company_id uuid,
  p_kind text,
  p_qty integer,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(ok boolean, usage_id uuid, quota integer, used integer, remaining integer, error text)
LANGUAGE plpgsql
AS $$
DECLARE
  u public.billing_usage%ROWTYPE;
  quota_col text;
  used_col text;
  current_quota integer;
  current_used integer;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'qty must be a positive integer';
    RETURN;
  END IF;

  IF p_kind = 'unit' THEN
    quota_col := 'unit_labels_quota';
    used_col := 'unit_labels_used';
  ELSIF p_kind = 'box' THEN
    quota_col := 'box_labels_quota';
    used_col := 'box_labels_used';
  ELSIF p_kind = 'carton' THEN
    quota_col := 'carton_labels_quota';
    used_col := 'carton_labels_used';
  ELSIF p_kind = 'pallet' THEN
    quota_col := 'pallet_labels_quota';
    used_col := 'pallet_labels_used';
  ELSE
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'invalid kind';
    RETURN;
  END IF;

  SELECT * INTO u
  FROM public.billing_usage
  WHERE company_id = p_company_id
    AND billing_period_start <= p_now
    AND billing_period_end > p_now
  ORDER BY billing_period_start DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'no active billing_usage row for current period';
    RETURN;
  END IF;

  EXECUTE format('SELECT COALESCE(%I,0), COALESCE(%I,0) FROM public.billing_usage WHERE id = $1', quota_col, used_col)
    INTO current_quota, current_used
    USING u.id;

  IF current_used + p_qty > current_quota THEN
    RETURN QUERY SELECT false, u.id, current_quota, current_used, GREATEST(0, current_quota - current_used), 'quota_exceeded';
    RETURN;
  END IF;

  EXECUTE format(
    'UPDATE public.billing_usage SET %I = COALESCE(%I,0) + $1, updated_at = now() WHERE id = $2 RETURNING %I, %I',
    used_col, used_col, quota_col, used_col
  )
  INTO quota, used
  USING p_qty, u.id;

  remaining := GREATEST(0, COALESCE(quota,0) - COALESCE(used,0));
  RETURN QUERY SELECT true, u.id, quota, used, remaining, NULL::text;
END;
$$;


CREATE OR REPLACE FUNCTION public.billing_usage_refund(
  p_company_id uuid,
  p_kind text,
  p_qty integer,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(ok boolean, usage_id uuid, quota integer, used integer, remaining integer, error text)
LANGUAGE plpgsql
AS $$
DECLARE
  u public.billing_usage%ROWTYPE;
  quota_col text;
  used_col text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'qty must be a positive integer';
    RETURN;
  END IF;

  IF p_kind = 'unit' THEN
    quota_col := 'unit_labels_quota';
    used_col := 'unit_labels_used';
  ELSIF p_kind = 'box' THEN
    quota_col := 'box_labels_quota';
    used_col := 'box_labels_used';
  ELSIF p_kind = 'carton' THEN
    quota_col := 'carton_labels_quota';
    used_col := 'carton_labels_used';
  ELSIF p_kind = 'pallet' THEN
    quota_col := 'pallet_labels_quota';
    used_col := 'pallet_labels_used';
  ELSE
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'invalid kind';
    RETURN;
  END IF;

  SELECT * INTO u
  FROM public.billing_usage
  WHERE company_id = p_company_id
    AND billing_period_start <= p_now
    AND billing_period_end > p_now
  ORDER BY billing_period_start DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'no active billing_usage row for current period';
    RETURN;
  END IF;

  EXECUTE format(
    'UPDATE public.billing_usage SET %I = GREATEST(0, COALESCE(%I,0) - $1), updated_at = now() WHERE id = $2 RETURNING %I, %I',
    used_col, used_col, quota_col, used_col
  )
  INTO quota, used
  USING p_qty, u.id;

  remaining := GREATEST(0, COALESCE(quota,0) - COALESCE(used,0));
  RETURN QUERY SELECT true, u.id, quota, used, remaining, NULL::text;
END;
$$;
