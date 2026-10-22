-- Keep the atomic plant activation guard aligned with the canonical entitlement
-- snapshot used by the Subscription and Plant pages. This reads the active
-- subscription's effective version and current usage without changing any
-- period allocation or snapshot.
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
  v_allocated integer;
  v_active integer;
  v_remaining integer;
  v_blocked boolean;
  v_reason text;
BEGIN
  v_snapshot := public.get_company_entitlement_snapshot(p_company_id, p_now);
  v_state := coalesce(v_snapshot->>'state', 'NO_ACTIVE_SUBSCRIPTION');
  v_allocated := greatest(coalesce(nullif(v_snapshot #>> '{limits,plant}', '')::integer, 0), 0);
  v_active := greatest(coalesce(nullif(v_snapshot #>> '{usage,plant}', '')::integer, 0), 0);
  v_remaining := greatest(coalesce(nullif(v_snapshot #>> '{remaining,plant}', '')::integer, 0), 0);
  v_blocked := coalesce((v_snapshot->>'blocked')::boolean, false)
    OR v_state IN ('NO_ACTIVE_SUBSCRIPTION', 'TRIAL_EXPIRED', 'COMPANY_DELETED')
    OR v_remaining <= 0;
  v_reason := CASE
    WHEN v_state = 'TRIAL_EXPIRED' THEN 'trial_expired'
    WHEN v_blocked THEN 'quota_exceeded'
    ELSE NULL
  END;

  RETURN QUERY SELECT v_allocated, v_active, v_remaining, v_blocked, v_reason;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_plant_entitlement(uuid, timestamptz) TO authenticated;
