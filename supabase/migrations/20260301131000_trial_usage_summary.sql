-- Aggregates usage_events for trial enforcement
CREATE OR REPLACE FUNCTION public.trial_usage_summary(
  p_company_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz DEFAULT NOW()
)
RETURNS TABLE (
  metric_type text,
  used bigint
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    metric_type,
    COALESCE(SUM(quantity), 0)::bigint AS used
  FROM public.usage_events
  WHERE company_id = p_company_id
    AND created_at >= p_starts_at
    AND created_at <= p_ends_at
  GROUP BY metric_type;
END;
$$;
