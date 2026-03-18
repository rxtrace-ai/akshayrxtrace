-- Phase 3.1 + Phase 4 integrity patch
-- Enforces immutable quote -> payment_intent -> webhook capture flow.

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  plan_id text,
  addons_json jsonb not null,
  discount_paise integer not null default 0,
  taxable_subtotal_paise integer not null,
  gst_paise integer not null,
  final_total_paise integer not null,
  currency text not null default 'INR',
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists idx_quotes_company_user_status
  on public.quotes (company_id, user_id, status, expires_at desc);

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  amount_paise integer not null,
  status text not null default 'created',
  created_at timestamptz default now()
);

create unique index if not exists uq_payment_intents_quote_id
  on public.payment_intents (quote_id);

create or replace function public.process_payment_intent_capture(
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_amount_paise integer
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_intent public.payment_intents%rowtype;
  v_quote public.quotes%rowtype;
begin
  if p_razorpay_order_id is null or btrim(p_razorpay_order_id) = '' then
    raise exception 'ORDER_ID_REQUIRED';
  end if;
  if p_razorpay_payment_id is null or btrim(p_razorpay_payment_id) = '' then
    raise exception 'PAYMENT_ID_REQUIRED';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'INVALID_PAYMENT_AMOUNT';
  end if;

  select *
  into v_intent
  from public.payment_intents
  where razorpay_order_id = p_razorpay_order_id
  for update;

  if not found then
    raise exception 'PAYMENT_INTENT_NOT_FOUND';
  end if;

  select *
  into v_quote
  from public.quotes
  where id = v_intent.quote_id
  for update;

  if not found then
    raise exception 'QUOTE_NOT_FOUND';
  end if;

  if p_amount_paise <> v_quote.final_total_paise then
    raise exception 'PAYMENT_AMOUNT_MISMATCH';
  end if;

  if v_intent.razorpay_payment_id is not null then
    if v_intent.razorpay_payment_id = p_razorpay_payment_id then
      return jsonb_build_object(
        'success', true,
        'duplicate', true,
        'quote_id', v_quote.id,
        'payment_intent_id', v_intent.id
      );
    end if;
    raise exception 'PAYMENT_INTENT_ALREADY_CAPTURED';
  end if;

  update public.payment_intents
  set
    razorpay_payment_id = p_razorpay_payment_id,
    status = 'paid'
  where id = v_intent.id;

  if v_quote.status = 'active' then
    update public.quotes
    set status = 'used'
    where id = v_quote.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'quote_id', v_quote.id,
    'payment_intent_id', v_intent.id
  );
end;
$$;
