-- Phase 5 quote fulfillment snapshot extensions
-- Keeps plan/totals immutable for post-payment activation and invoicing.

alter table if exists public.quotes
  add column if not exists plan_snapshot_json jsonb not null default '{}'::jsonb;

alter table if exists public.quotes
  add column if not exists totals_snapshot_json jsonb not null default '{}'::jsonb;
