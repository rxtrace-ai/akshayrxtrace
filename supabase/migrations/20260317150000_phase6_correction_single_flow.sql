-- Phase 6 correction: enforce single quote->payment->finalize flow metadata.
-- Remove payment_intents mode/snapshot columns introduced in prior phase.

alter table if exists public.payment_intents
  drop constraint if exists payment_intents_billing_mode_check;

alter table if exists public.payment_intents
  drop column if exists quote_snapshot_json;

alter table if exists public.payment_intents
  drop column if exists billing_mode;
