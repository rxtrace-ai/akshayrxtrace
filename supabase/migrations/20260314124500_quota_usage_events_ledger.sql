
-- Ledger-based quota consumption (quota_allocations + quota_usage_events)
-- - Replaces legacy quota balance consumption
-- - Adds usage ledger for quota consumption
-- - Blocks usage when trial is cancelled or expired

CREATE TABLE IF NOT EXISTS public.quota_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  resource text NOT NULL CHECK (resource IN ('unit', 'box', 'carton', 'pallet')),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quota_usage_events_company_resource
  ON public.quota_usage_events(company_id, resource);

CREATE OR REPLACE FUNCTION public.consume_quota_balance(
  p_company_id uuid,
  p_kind text,
  p_qty integer,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocated bigint := 0;
  v_used bigint := 0;
  v_remaining bigint := 0;
  v_trial_status text;
  v_trial_end timestamptz;
BEGIN
  IF p_kind NOT IN ('unit', 'box', 'carton', 'pallet') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_KIND');
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_QUANTITY');
  END IF;

  -- Concurrency guard (per-company)
  PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text));

  -- Block if trial is cancelled or expired
  SELECT t.status, t.trial_end
  INTO v_trial_status, v_trial_end
  FROM public.company_trials t
  WHERE t.company_id = p_company_id
  ORDER BY t.created_at DESC
  LIMIT 1;

  IF v_trial_status = 'cancelled' OR (v_trial_end IS NOT NULL AND v_trial_end < p_now) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TRIAL_EXPIRED_OR_CANCELLED');
  END IF;

  -- Allocated quota from ledger
  SELECT COALESCE(SUM(amount), 0)
  INTO v_allocated
  FROM public.quota_allocations
  WHERE company_id = p_company_id
    AND quota_type = 'variable'
    AND resource = p_kind
    AND expires_at > p_now;

  -- Used quota from usage ledger
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_used
  FROM public.quota_usage_events
  WHERE company_id = p_company_id
    AND resource = p_kind;

  v_remaining := v_allocated - v_used;

  IF v_remaining < p_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_QUOTA');
  END IF;

  INSERT INTO public.quota_usage_events (
    company_id,
    resource,
    quantity,
    created_at
  )
  VALUES (
    p_company_id,
    p_kind,
    p_qty,
    p_now
  );

  RETURN jsonb_build_object(
    'ok', true,
    'remaining', greatest(v_remaining - p_qty, 0)
  );
END;
$$;
