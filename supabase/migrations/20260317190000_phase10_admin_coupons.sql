-- Phase 10: production-grade admin coupon management.
-- Dedicated coupons table for backend pricing + quote integration.

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percentage', 'flat')),
  discount_value integer not null check (discount_value >= 0),
  max_discount_paise integer check (max_discount_paise is null or max_discount_paise >= 0),
  active boolean not null default true,
  valid_from timestamptz,
  valid_until timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists coupons_code_unique_idx
  on public.coupons (upper(code));

create index if not exists coupons_active_validity_idx
  on public.coupons (active, valid_from, valid_until);

create index if not exists coupons_usage_idx
  on public.coupons (usage_limit, used_count);

