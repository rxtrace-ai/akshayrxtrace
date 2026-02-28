-- Plant management production hardening:
-- - remove allocated lifecycle state from entity table
-- - centralize entitlement resolution
-- - enforce atomic activation with server authority checks
-- - add tenant-safe RLS and uniqueness safeguards

ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS normalized_name text GENERATED ALWAYS AS (
    lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ) STORED;

UPDATE public.plants
SET status = 'deactivated',
    activated_at = NULL
WHERE status = 'allocated';

ALTER TABLE public.plants
  DROP CONSTRAINT IF EXISTS plants_status_check;

ALTER TABLE public.plants
  ADD CONSTRAINT plants_status_check
  CHECK (status IN ('active', 'deactivated'));

ALTER TABLE public.plants
  ALTER COLUMN status SET DEFAULT 'active';

CREATE UNIQUE INDEX IF NOT EXISTS plants_company_normalized_name_key
  ON public.plants (company_id, normalized_name);

CREATE TABLE IF NOT EXISTS public.company_plant_entitlement_overrides (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  admin_override_limit integer CHECK (admin_override_limit IS NULL OR admin_override_limit >= 0),
  enterprise_override_limit integer CHECK (enterprise_override_limit IS NULL OR enterprise_override_limit >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plant_limit_profiles (
  plan_code text PRIMARY KEY,
  plant_limit integer NOT NULL CHECK (plant_limit >= 0),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plant_limit_profiles (plan_code, plant_limit, is_active)
VALUES
  ('starter', 2, true),
  ('starter_monthly', 2, true),
  ('starter_yearly', 3, true),
  ('growth', 5, true),
  ('growth_monthly', 5, true),
  ('growth_yearly', 8, true),
  ('enterprise', 12, true),
  ('enterprise_monthly', 12, true),
  ('enterprise_quarterly', 16, true)
ON CONFLICT (plan_code) DO NOTHING;

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
  v_company record;
  v_override record;
  v_plan_code text;
  v_alloc integer := 0;
  v_active integer := 0;
  v_blocked boolean := false;
  v_reason text := NULL;
BEGIN
  SELECT
    c.id,
    c.subscription_plan,
    c.trial_started_at,
    c.trial_expires_at,
    c.deleted_at
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company.deleted_at IS NOT NULL THEN
    SELECT count(*)::int INTO v_active
    FROM public.plants p
    WHERE p.company_id = p_company_id
      AND p.status = 'active';

    RETURN QUERY
    SELECT 0, v_active, 0, true, 'quota_exceeded';
    RETURN;
  END IF;

  IF v_company.trial_started_at IS NOT NULL THEN
    IF v_company.trial_expires_at IS NULL OR p_now > v_company.trial_expires_at THEN
      v_alloc := 0;
      v_blocked := true;
      v_reason := 'trial_expired';
    ELSE
      v_alloc := 2;
    END IF;
  ELSE
    SELECT
      o.admin_override_limit,
      o.enterprise_override_limit
    INTO v_override
    FROM public.company_plant_entitlement_overrides o
    WHERE o.company_id = p_company_id;

    IF COALESCE(v_override.admin_override_limit, v_override.enterprise_override_limit) IS NOT NULL THEN
      v_alloc := COALESCE(v_override.admin_override_limit, v_override.enterprise_override_limit);
    ELSE
      v_plan_code := lower(coalesce(trim(v_company.subscription_plan), 'starter'));

      SELECT p.plant_limit
      INTO v_alloc
      FROM public.plant_limit_profiles p
      WHERE p.plan_code = v_plan_code
        AND p.is_active = true
      LIMIT 1;

      IF v_alloc IS NULL THEN
        IF v_plan_code LIKE 'growth%' THEN
          v_alloc := 5;
        ELSIF v_plan_code LIKE 'enterprise%' THEN
          v_alloc := 12;
        ELSE
          v_alloc := 2;
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT count(*)::int INTO v_active
  FROM public.plants p
  WHERE p.company_id = p_company_id
    AND p.status = 'active';

  IF NOT v_blocked AND v_active >= v_alloc THEN
    v_blocked := true;
    v_reason := 'quota_exceeded';
  END IF;

  RETURN QUERY
  SELECT
    v_alloc,
    v_active,
    GREATEST(v_alloc - v_active, 0),
    v_blocked,
    v_reason;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_plant_atomic(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_street_address text,
  p_city_state text,
  p_location_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company record;
  v_entitlement record;
  v_wallet_status text;
  v_inserted public.plants%ROWTYPE;
  v_name text;
  v_street text;
  v_city text;
  v_location text;
BEGIN
  v_name := trim(coalesce(p_name, ''));
  v_street := trim(coalesce(p_street_address, ''));
  v_city := trim(coalesce(p_city_state, ''));
  v_location := NULLIF(trim(coalesce(p_location_description, '')), '');

  IF v_name = '' OR v_street = '' OR v_city = '' THEN
    RAISE EXCEPTION 'INVALID_PLANT_PAYLOAD';
  END IF;

  SELECT c.id, c.user_id, c.deleted_at
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company.user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT cw.status
  INTO v_wallet_status
  FROM public.company_wallets cw
  WHERE cw.company_id = p_company_id
  LIMIT 1;

  IF coalesce(v_wallet_status, 'ACTIVE') = 'FROZEN' THEN
    RAISE EXCEPTION 'COMPANY_FROZEN';
  END IF;

  -- Lock active rows for this tenant to prevent concurrent over-activation.
  PERFORM 1
  FROM public.plants p
  WHERE p.company_id = p_company_id
    AND p.status = 'active'
  FOR UPDATE;

  SELECT * INTO v_entitlement
  FROM public.get_plant_entitlement(p_company_id, now());

  IF v_entitlement.blocked THEN
    IF v_entitlement.reason = 'trial_expired' THEN
      RAISE EXCEPTION 'TRIAL_EXPIRED';
    END IF;
    RAISE EXCEPTION 'PLANT_QUOTA_EXCEEDED';
  END IF;

  INSERT INTO public.plants (
    company_id,
    name,
    street_address,
    city_state,
    location_description,
    status,
    activated_at
  )
  VALUES (
    p_company_id,
    v_name,
    v_street,
    v_city,
    v_location,
    'active',
    now()
  )
  RETURNING * INTO v_inserted;

  INSERT INTO public.audit_logs (
    action,
    company_id,
    actor,
    status,
    metadata,
    created_at
  )
  VALUES (
    'PLANT_ACTIVATED',
    p_company_id,
    p_actor_user_id::text,
    'success',
    jsonb_build_object(
      'plant_id', v_inserted.id,
      'name', v_inserted.name
    ),
    now()
  );

  SELECT * INTO v_entitlement
  FROM public.get_plant_entitlement(p_company_id, now());

  RETURN jsonb_build_object(
    'success', true,
    'plant', to_jsonb(v_inserted),
    'entitlement', jsonb_build_object(
      'allocated', v_entitlement.allocated,
      'active', v_entitlement.active,
      'remaining', v_entitlement.remaining,
      'blocked', v_entitlement.blocked,
      'reason', v_entitlement.reason
    )
  );
END;
$$;

ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plants read same company" ON public.plants;
CREATE POLICY "Plants read same company"
ON public.plants
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = plants.company_id
      AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = plants.company_id
      AND s.user_id = auth.uid()
      AND lower(coalesce(s.status, '')) = 'active'
  )
);

DROP POLICY IF EXISTS "Plants owner write" ON public.plants;
CREATE POLICY "Plants owner write"
ON public.plants
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = plants.company_id
      AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = plants.company_id
      AND c.user_id = auth.uid()
  )
);

GRANT EXECUTE ON FUNCTION public.get_plant_entitlement(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_plant_atomic(uuid, uuid, text, text, text, text) TO authenticated;
