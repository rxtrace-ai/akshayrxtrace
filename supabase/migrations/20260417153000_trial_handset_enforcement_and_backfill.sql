-- Production hardening:
-- 1) Backfill missing trial quota allocations for currently active trial companies
--    that do not yet have a paid subscription.
-- 2) Enforce handset entitlement inside activate_handset_v2.

WITH active_trial_companies AS (
  SELECT
    ct.company_id,
    ct.trial_end
  FROM public.company_trials ct
  WHERE ct.status = 'active'
    AND ct.trial_end > now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_subscriptions cs
      WHERE cs.company_id = ct.company_id
        AND lower(coalesce(cs.status::text, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due')
    )
)
INSERT INTO public.quota_allocations (
  company_id,
  source,
  quota_type,
  resource,
  amount,
  expires_at,
  metadata
)
SELECT
  atc.company_id,
  'trial',
  row_data.quota_type,
  row_data.resource,
  row_data.amount,
  atc.trial_end,
  jsonb_build_object(
    'backfilled_via', '20260417153000_trial_handset_enforcement_and_backfill',
    'trial_end', atc.trial_end
  )
FROM active_trial_companies atc
CROSS JOIN (
  VALUES
    ('variable'::text, 'unit'::text, 5000::integer),
    ('variable'::text, 'box'::text, 500::integer),
    ('variable'::text, 'carton'::text, 100::integer),
    ('variable'::text, 'pallet'::text, 25::integer),
    ('base'::text, 'seats'::text, 5::integer),
    ('base'::text, 'plants'::text, 2::integer),
    ('base'::text, 'handsets'::text, 2::integer)
) AS row_data(quota_type, resource, amount)
WHERE row_data.amount > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.quota_allocations qa
    WHERE qa.company_id = atc.company_id
      AND qa.source = 'trial'
      AND qa.resource = row_data.resource
      AND qa.expires_at > now()
  );

CREATE OR REPLACE FUNCTION public.activate_handset_v2(
  p_token_hash text,
  p_device_id text,
  p_platform text,
  p_app_version text,
  p_device_name text,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  token_id uuid,
  company_id uuid,
  handset_id uuid,
  activation_count integer,
  max_activations integer,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token public.handset_activation_tokens%ROWTYPE;
  v_handset_id uuid;
  v_existing_handset record;
  v_snapshot jsonb;
  v_remaining_handset integer := 0;
  v_existing_is_active boolean := false;
BEGIN
  SELECT *
  INTO v_token
  FROM public.handset_activation_tokens
  WHERE token_hash = p_token_hash
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOKEN_NOT_FOUND';
  END IF;

  IF v_token.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'TOKEN_REVOKED';
  END IF;

  IF v_token.expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRED';
  END IF;

  IF v_token.activation_count >= v_token.max_activations THEN
    RAISE EXCEPTION 'TOKEN_EXHAUSTED';
  END IF;

  SELECT h.id, h.status, h.disabled_at
  INTO v_existing_handset
  FROM public.handsets h
  WHERE h.company_id = v_token.company_id
    AND h.device_id = p_device_id
  LIMIT 1
  FOR UPDATE;

  v_existing_is_active := (
    v_existing_handset.id IS NOT NULL
    AND upper(coalesce(v_existing_handset.status, '')) = 'ACTIVE'
    AND v_existing_handset.disabled_at IS NULL
  );

  IF NOT v_existing_is_active THEN
    v_snapshot := public.get_company_entitlement_snapshot(v_token.company_id, now());
    v_remaining_handset := greatest(coalesce((v_snapshot -> 'remaining' ->> 'handset')::integer, 0), 0);

    IF v_remaining_handset <= 0 THEN
      RAISE EXCEPTION 'HANDSET_QUOTA_EXCEEDED';
    END IF;
  END IF;

  UPDATE public.handset_activation_tokens
  SET activation_count = activation_count + 1
  WHERE id = v_token.id;

  INSERT INTO public.handsets (
    company_id,
    status,
    device_id,
    platform,
    app_version,
    device_name,
    activated_by,
    activated_at,
    disabled_by,
    disabled_at
  )
  VALUES (
    v_token.company_id,
    'ACTIVE',
    p_device_id,
    lower(coalesce(nullif(p_platform, ''), 'android')),
    nullif(p_app_version, ''),
    nullif(p_device_name, ''),
    p_actor_user_id,
    now(),
    NULL,
    NULL
  )
  ON CONFLICT (company_id, device_id)
  DO UPDATE SET
    status = 'ACTIVE',
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    device_name = EXCLUDED.device_name,
    activated_by = EXCLUDED.activated_by,
    activated_at = now(),
    disabled_by = NULL,
    disabled_at = NULL
  RETURNING id INTO v_handset_id;

  INSERT INTO public.handset_logs (
    company_id,
    handset_id,
    event_type,
    metadata,
    created_by
  )
  VALUES (
    v_token.company_id,
    v_handset_id,
    'token_activated',
    jsonb_build_object(
      'token_id', v_token.id,
      'activation_count', v_token.activation_count + 1,
      'max_activations', v_token.max_activations,
      'device_id', p_device_id,
      'platform', lower(coalesce(nullif(p_platform, ''), 'android'))
    ),
    p_actor_user_id
  );

  RETURN QUERY
  SELECT
    v_token.id,
    v_token.company_id,
    v_handset_id,
    v_token.activation_count + 1,
    v_token.max_activations,
    v_token.expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_handset_v2(text, text, text, text, text, uuid) TO service_role;
