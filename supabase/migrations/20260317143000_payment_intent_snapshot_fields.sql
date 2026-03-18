-- Phase 6: store payment-side snapshot details for order-based checkout.

alter table if exists public.payment_intents
  add column if not exists quote_snapshot_json jsonb not null default '{}'::jsonb;

alter table if exists public.payment_intents
  add column if not exists billing_mode text not null default 'plan_with_addons';

alter table if exists public.payment_intents
  add column if not exists correlation_id text;

alter table if exists public.payment_intents
  add column if not exists updated_at timestamptz default now();

alter table if exists public.payment_intents
  drop constraint if exists payment_intents_billing_mode_check;

alter table if exists public.payment_intents
  add constraint payment_intents_billing_mode_check
  check (billing_mode in ('plan_with_addons', 'addons_only'));

update public.payment_intents
set
  quote_snapshot_json = '{}'::jsonb,
  updated_at = coalesce(updated_at, now())
where quote_snapshot_json is null;
