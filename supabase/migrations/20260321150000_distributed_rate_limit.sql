-- Distributed rate limiting for multi-instance deployments.
-- Uses DB-backed token bucket with row-level locking for atomic consume semantics.

CREATE TABLE IF NOT EXISTS public.distributed_rate_limits (
  key text PRIMARY KEY,
  tokens numeric NOT NULL,
  last_refill_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distributed_rate_limits_updated_at
  ON public.distributed_rate_limits(updated_at DESC);

ALTER TABLE public.distributed_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.distributed_rate_limits FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Service role full access distributed_rate_limits" ON public.distributed_rate_limits;
CREATE POLICY "Service role full access distributed_rate_limits"
  ON public.distributed_rate_limits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.consume_distributed_rate_limit(
  p_key text,
  p_refill_per_minute numeric,
  p_burst numeric,
  p_cost numeric DEFAULT 1
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_tokens numeric;
  v_last_refill timestamptz;
  v_elapsed_seconds numeric;
  v_refill_per_second numeric;
  v_refilled_tokens numeric;
  v_missing_tokens numeric;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'RATE_LIMIT_KEY_REQUIRED';
  END IF;
  IF p_refill_per_minute <= 0 OR p_burst <= 0 OR p_cost <= 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAMS';
  END IF;

  INSERT INTO public.distributed_rate_limits AS rl (key, tokens, last_refill_at, updated_at)
  VALUES (p_key, p_burst, v_now, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT rl.tokens, rl.last_refill_at
  INTO v_tokens, v_last_refill
  FROM public.distributed_rate_limits rl
  WHERE rl.key = p_key
  FOR UPDATE;

  v_elapsed_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_last_refill)));
  v_refill_per_second := p_refill_per_minute / 60.0;
  v_refilled_tokens := LEAST(p_burst, v_tokens + (v_elapsed_seconds * v_refill_per_second));

  IF v_refilled_tokens >= p_cost THEN
    v_refilled_tokens := v_refilled_tokens - p_cost;

    UPDATE public.distributed_rate_limits
    SET tokens = v_refilled_tokens,
        last_refill_at = v_now,
        updated_at = v_now
    WHERE key = p_key;

    RETURN QUERY SELECT true, FLOOR(v_refilled_tokens)::integer, 0;
    RETURN;
  END IF;

  UPDATE public.distributed_rate_limits
  SET tokens = v_refilled_tokens,
      last_refill_at = v_now,
      updated_at = v_now
  WHERE key = p_key;

  v_missing_tokens := p_cost - v_refilled_tokens;
  RETURN QUERY
  SELECT
    false,
    FLOOR(v_refilled_tokens)::integer,
    GREATEST(1, CEIL(v_missing_tokens / GREATEST(v_refill_per_second, 0.0001)))::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_distributed_rate_limit(text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_distributed_rate_limit(text, numeric, numeric, numeric) TO service_role;

-- Cleanup function for stale limiter keys.
CREATE OR REPLACE FUNCTION public.cleanup_distributed_rate_limits(
  p_older_than interval DEFAULT interval '7 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.distributed_rate_limits
  WHERE updated_at < (now() - p_older_than);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_distributed_rate_limits(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_distributed_rate_limits(interval) TO service_role;
