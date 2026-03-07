-- ============================================================
-- Fix: Prevent double-counting quota usage
-- ============================================================
-- Background:
-- - We treat usage_counters as the authoritative quota ledger.
-- - consume_entitlement() updates usage_counters directly.
-- - Older schema also has a trigger on usage_events that aggregates into usage_counters.
--   If both are active, counters get incremented twice.
--
-- This migration disables the usage_events -> usage_counters aggregation trigger.
-- usage_events remains as an audit/event log only.

DO $$
BEGIN
  IF to_regclass('public.usage_events') IS NOT NULL THEN
    BEGIN
      DROP TRIGGER IF EXISTS aggregate_usage_on_insert ON public.usage_events;
    EXCEPTION WHEN undefined_object THEN
      -- ignore
    END;
  END IF;
END $$;

