-- Phase 7: webhook-driven payment verification and finalization.

alter table if exists public.quotes
  add column if not exists fulfilled_at timestamptz;

alter table if exists public.payment_intents
  add column if not exists processed_at timestamptz;

alter table if exists public.payment_intents
  add column if not exists processed_correlation_id text;

alter table if exists public.quota_allocations
  add column if not exists source_quote_id uuid;

create unique index if not exists uq_quota_allocations_source_quote_resource
  on public.quota_allocations (company_id, source_quote_id, quota_type, resource)
  where source_quote_id is not null;

create or replace function public.process_payment_intent_capture(
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_amount_paise integer,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_intent public.payment_intents%rowtype;
  v_quote public.quotes%rowtype;
  v_expected_amount integer;
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

  v_expected_amount := nullif(v_quote.totals_snapshot_json ->> 'final_total_paise', '')::integer;
  if v_expected_amount is null or v_expected_amount <= 0 then
    raise exception 'QUOTE_FINAL_TOTAL_MISSING';
  end if;

  if p_amount_paise <> v_expected_amount then
    raise exception 'PAYMENT_AMOUNT_MISMATCH';
  end if;

  if v_intent.razorpay_payment_id is not null then
    if v_intent.razorpay_payment_id = p_razorpay_payment_id then
      return jsonb_build_object(
        'success', true,
        'duplicate', true,
        'quote_id', v_quote.id,
        'payment_intent_id', v_intent.id,
        'final_total_paise', v_expected_amount
      );
    end if;
    raise exception 'PAYMENT_INTENT_ALREADY_CAPTURED';
  end if;

  update public.payment_intents
  set
    razorpay_payment_id = p_razorpay_payment_id,
    status = 'paid',
    processed_at = now(),
    processed_correlation_id = p_correlation_id,
    updated_at = now()
  where id = v_intent.id;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'quote_id', v_quote.id,
    'payment_intent_id', v_intent.id,
    'final_total_paise', v_expected_amount
  );
end;
$$;
