alter table if exists public.quotes
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null;

alter table if exists public.quotes
  add column if not exists coupon_code text;

alter table if exists public.quotes
  add column if not exists coupon_snapshot_json jsonb not null default '{}'::jsonb;

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  invoice_id uuid references public.billing_invoices(id) on delete set null,
  code text not null,
  status text not null default 'redeemed' check (status in ('redeemed', 'reversed')),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists coupon_redemptions_quote_id_key
  on public.coupon_redemptions(quote_id)
  where quote_id is not null;

create index if not exists coupon_redemptions_coupon_company_idx
  on public.coupon_redemptions(coupon_id, company_id, created_at desc);
