-- ============================================================
-- PHASE 7: Billing retention (optional)
-- ============================================================
-- Goal:
-- Keep canonical billing/audit tables from growing without bound.
--
-- This migration only creates helper functions. Scheduling (cron) is external:
-- - Supabase scheduled functions, pg_cron, or external worker.

CREATE OR REPLACE FUNCTION public.purge_old_webhook_events(p_older_than interval DEFAULT interval '90 days')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint := 0;
BEGIN
  IF to_regclass('public.webhook_events') IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.webhook_events
  WHERE received_at < (now() - p_older_than)
    AND processing_status IN ('processed', 'failed');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_old_entitlement_ops(p_older_than interval DEFAULT interval '180 days')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint := 0;
BEGIN
  IF to_regclass('public.entitlement_operation_log') IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.entitlement_operation_log
  WHERE created_at < (now() - p_older_than);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

