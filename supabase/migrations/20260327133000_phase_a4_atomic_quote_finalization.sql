alter table if exists public.company_addon_subscriptions
  add column if not exists source_quote_id uuid references public.quotes(id) on delete set null;

create unique index if not exists company_addon_subscriptions_company_addon_quote_key
  on public.company_addon_subscriptions (company_id, addon_id, source_quote_id)
  where source_quote_id is not null;

create or replace function public.finalize_paid_quote(
  p_quote_id uuid,
  p_expected_company_id uuid default null,
  p_expected_user_id uuid default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes%rowtype;
  v_intent public.payment_intents%rowtype;
  v_existing_sub public.company_subscriptions%rowtype;
  v_invoice public.billing_invoices%rowtype;
  v_company_id uuid;
  v_user_id uuid;
  v_invoice_reference text;
  v_plan_snapshot jsonb;
  v_totals_snapshot jsonb;
  v_addons_snapshot jsonb;
  v_coupon_snapshot jsonb;
  v_has_plan boolean;
  v_now timestamptz := now();
  v_now_iso text := v_now::text;
  v_billing_cycle text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_provider_subscription_id text;
  v_provider_customer_id text;
  v_addon_line jsonb;
  v_resource text;
  v_amount integer;
  v_coupon_id uuid;
  v_coupon_code text;
  v_coupon_usage_limit integer;
  v_coupon_used_count integer;
  v_coupon_discount_paise integer;
begin
  if p_quote_id is null then
    raise exception 'QUOTE_ID_REQUIRED';
  end if;

  select *
  into v_quote
  from public.quotes
  where id = p_quote_id
  for update;

  if not found then
    raise exception 'QUOTE_NOT_FOUND';
  end if;

  v_company_id := v_quote.company_id;
  v_user_id := v_quote.user_id;

  if p_expected_company_id is not null and v_company_id <> p_expected_company_id then
    raise exception 'QUOTE_FORBIDDEN';
  end if;
  if p_expected_user_id is not null and v_user_id <> p_expected_user_id then
    raise exception 'QUOTE_FORBIDDEN';
  end if;

  v_invoice_reference := 'quote:' || p_quote_id::text;
  if v_quote.fulfilled_at is not null then
    select *
    into v_invoice
    from public.billing_invoices
    where company_id = v_company_id
      and reference = v_invoice_reference
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'success', true,
      'no_op', true,
      'reason', 'already_fulfilled',
      'quote_id', p_quote_id,
      'company_id', v_company_id,
      'invoice_reference', v_invoice_reference,
      'invoice_id', v_invoice.id
    );
  end if;

  select *
  into v_intent
  from public.payment_intents
  where quote_id = p_quote_id
  for update;

  if not found then
    raise exception 'PAYMENT_INTENT_NOT_FOUND';
  end if;

  if lower(coalesce(v_intent.status, '')) <> 'paid' then
    raise exception 'PAYMENT_NOT_CAPTURED_YET';
  end if;

  v_plan_snapshot := coalesce(v_quote.plan_snapshot_json, '{}'::jsonb);
  v_totals_snapshot := coalesce(v_quote.totals_snapshot_json, '{}'::jsonb);
  v_addons_snapshot := coalesce(v_quote.addons_json, '{}'::jsonb);
  v_coupon_snapshot := coalesce(v_quote.coupon_snapshot_json, '{}'::jsonb);
  v_has_plan := v_plan_snapshot <> '{}'::jsonb;

  if coalesce(nullif(v_totals_snapshot->>'final_total_paise', ''), '0')::integer <= 0 then
    raise exception 'QUOTE_FINAL_TOTAL_MISSING';
  end if;

  v_billing_cycle := case
    when lower(coalesce(v_plan_snapshot->>'billing_cycle', 'monthly')) = 'yearly' then 'yearly'
    else 'monthly'
  end;

  v_period_start := v_now;
  v_period_end := case
    when v_billing_cycle = 'yearly' then v_now + interval '1 year'
    else v_now + interval '1 month'
  end;

  if not v_has_plan then
    select *
    into v_existing_sub
    from public.company_subscriptions
    where company_id = v_company_id
    order by updated_at desc
    limit 1
    for update;

    if v_existing_sub.current_period_end is not null then
      v_period_end := v_existing_sub.current_period_end;
    end if;
  else
    select *
    into v_existing_sub
    from public.company_subscriptions
    where company_id = v_company_id
    order by updated_at desc
    limit 1
    for update;

    if v_existing_sub.current_period_start is not null then
      v_period_start := v_existing_sub.current_period_start;
    end if;
    if v_existing_sub.current_period_end is not null then
      v_period_end := v_existing_sub.current_period_end;
    end if;
  end if;

  v_provider_subscription_id := coalesce(nullif(v_intent.provider_subscription_id, ''), nullif(v_existing_sub.provider_subscription_id, ''), null);
  v_provider_customer_id := coalesce(nullif(v_intent.provider_customer_id, ''), nullif(v_existing_sub.provider_customer_id, ''), null);
  v_coupon_id := v_quote.coupon_id;
  v_coupon_code := coalesce(nullif(v_quote.coupon_code, ''), nullif(v_coupon_snapshot->>'code', ''), null);
  v_coupon_discount_paise := greatest(coalesce(nullif(v_coupon_snapshot->>'discount_paise', ''), nullif(v_totals_snapshot->>'discount_paise', ''), '0')::integer, 0);

  if v_has_plan then
    if v_existing_sub.id is not null then
      update public.company_subscriptions
      set
        status = 'active',
        plan_template_id = v_quote.plan_id,
        plan_version_id = null,
        billing_cycle = v_billing_cycle,
        current_period_start = v_period_start,
        current_period_end = v_period_end,
        next_billing_at = v_period_end,
        renewal_date = v_period_end,
        start_date = v_period_start,
        provider = 'razorpay',
        provider_subscription_id = v_provider_subscription_id,
        razorpay_subscription_id = v_provider_subscription_id,
        provider_customer_id = v_provider_customer_id,
        activated_at = coalesce(v_existing_sub.activated_at, v_now),
        metadata = coalesce(v_existing_sub.metadata, '{}'::jsonb) || jsonb_build_object(
          'quote_id', p_quote_id,
          'payment_intent_id', v_intent.id,
          'razorpay_order_id', v_intent.razorpay_order_id,
          'razorpay_payment_id', v_intent.razorpay_payment_id,
          'finalized_by', 'rpc',
          'correlation_id', p_correlation_id
        ),
        updated_at = v_now
      where id = v_existing_sub.id;
    else
      insert into public.company_subscriptions (
        company_id,
        status,
        plan_template_id,
        plan_version_id,
        billing_cycle,
        current_period_start,
        current_period_end,
        next_billing_at,
        renewal_date,
        start_date,
        provider,
        provider_subscription_id,
        razorpay_subscription_id,
        provider_customer_id,
        activated_at,
        metadata,
        created_at,
        updated_at
      ) values (
        v_company_id,
        'active',
        v_quote.plan_id,
        null,
        v_billing_cycle,
        v_period_start,
        v_period_end,
        v_period_end,
        v_period_end,
        v_period_start,
        'razorpay',
        v_provider_subscription_id,
        v_provider_subscription_id,
        v_provider_customer_id,
        v_now,
        jsonb_build_object(
          'quote_id', p_quote_id,
          'payment_intent_id', v_intent.id,
          'razorpay_order_id', v_intent.razorpay_order_id,
          'razorpay_payment_id', v_intent.razorpay_payment_id,
          'finalized_by', 'rpc',
          'correlation_id', p_correlation_id
        ),
        v_now,
        v_now
      );
    end if;

    perform public.apply_cycle_reset(v_company_id, v_period_start, v_period_end);

    update public.quota_allocations
    set
      expires_at = v_period_start,
      metadata = jsonb_build_object(
        'reset_by_quote_id', p_quote_id,
        'reset_at', v_period_start,
        'correlation_id', p_correlation_id
      )
    where company_id = v_company_id
      and source = 'subscription'
      and quota_type = 'base'
      and source_quote_id is distinct from p_quote_id
      and expires_at > v_period_start;

    insert into public.quota_allocations (
      company_id,
      source,
      quota_type,
      resource,
      amount,
      expires_at,
      source_quote_id,
      metadata
    )
    select
      v_company_id,
      'subscription',
      'base',
      row_data.resource,
      row_data.amount,
      v_period_end,
      p_quote_id,
      jsonb_build_object(
        'quote_id', p_quote_id,
        'payment_intent_id', v_intent.id,
        'period_start', v_period_start,
        'period_end', v_period_end,
        'correlation_id', p_correlation_id
      )
    from (
      values
        ('unit', greatest(coalesce(nullif(v_plan_snapshot #>> '{quotas,unit}', ''), '0')::integer, 0)),
        ('box', greatest(coalesce(nullif(v_plan_snapshot #>> '{quotas,box}', ''), '0')::integer, 0)),
        ('carton', greatest(coalesce(nullif(v_plan_snapshot #>> '{quotas,carton}', ''), '0')::integer, 0)),
        ('pallet', greatest(coalesce(nullif(v_plan_snapshot #>> '{quotas,pallet}', ''), '0')::integer, 0)),
        ('seats', greatest(coalesce(nullif(v_plan_snapshot #>> '{capacities,seat}', ''), '0')::integer, 0)),
        ('plants', greatest(coalesce(nullif(v_plan_snapshot #>> '{capacities,plant}', ''), '0')::integer, 0)),
        ('handsets', greatest(coalesce(nullif(v_plan_snapshot #>> '{capacities,handset}', ''), '0')::integer, 0))
    ) as row_data(resource, amount)
    where row_data.amount > 0
    on conflict (company_id, source_quote_id, quota_type, resource) do update
      set amount = excluded.amount,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata;
  end if;

  for v_addon_line in
    select value from jsonb_array_elements(coalesce(v_addons_snapshot->'code_addons', '[]'::jsonb))
    union all
    select value from jsonb_array_elements(coalesce(v_addons_snapshot->'capacity_addons', '[]'::jsonb))
  loop
    v_resource := case lower(coalesce(v_addon_line->>'entitlement_key', ''))
      when 'unit' then 'unit'
      when 'box' then 'box'
      when 'carton' then 'carton'
      when 'pallet' then 'pallet'
      when 'seat' then 'seats'
      when 'plant' then 'plants'
      when 'handset' then 'handsets'
      else null
    end;

    if v_resource is null then
      continue;
    end if;

    if v_resource in ('seats', 'plants', 'handsets') then
      v_amount := greatest(coalesce(nullif(v_addon_line->>'allocated_capacity', ''), nullif(v_addon_line->>'quantity', ''), '0')::integer, 0);
    else
      v_amount := greatest(coalesce(nullif(v_addon_line->>'allocated_quota', ''), nullif(v_addon_line->>'quantity', ''), '0')::integer, 0);
    end if;

    if v_amount <= 0 then
      continue;
    end if;

    insert into public.quota_allocations (
      company_id,
      source,
      quota_type,
      resource,
      amount,
      expires_at,
      source_quote_id,
      metadata
    ) values (
      v_company_id,
      'addon',
      case when v_resource in ('seats', 'plants', 'handsets') then 'base' else 'variable' end,
      v_resource,
      v_amount,
      v_period_end,
      p_quote_id,
      jsonb_build_object(
        'quote_id', p_quote_id,
        'payment_intent_id', v_intent.id,
        'addon_id', v_addon_line->>'addon_id',
        'correlation_id', p_correlation_id
      )
    )
    on conflict (company_id, source_quote_id, quota_type, resource) do update
      set amount = excluded.amount,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata;
  end loop;

  for v_addon_line in
    select value from jsonb_array_elements(coalesce(v_addons_snapshot->'capacity_addons', '[]'::jsonb))
  loop
    insert into public.company_addon_subscriptions (
      company_id,
      addon_id,
      quantity,
      status,
      starts_at,
      ends_at,
      source_quote_id,
      metadata
    ) values (
      v_company_id,
      (v_addon_line->>'addon_id')::uuid,
      greatest(coalesce(nullif(v_addon_line->>'quantity', ''), '1')::integer, 1),
      'active',
      v_period_start,
      v_period_end,
      p_quote_id,
      jsonb_build_object(
        'quote_id', p_quote_id,
        'payment_intent_id', v_intent.id,
        'correlation_id', p_correlation_id
      )
    )
    on conflict (company_id, addon_id, source_quote_id) do update
      set quantity = excluded.quantity,
          status = 'active',
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          metadata = excluded.metadata,
          updated_at = v_now;
  end loop;

  insert into public.billing_invoices (
    company_id,
    invoice_type,
    status,
    reference,
    plan,
    amount,
    base_amount,
    addons_amount,
    discount_amount,
    tax_rate,
    tax_amount,
    billing_cycle,
    currency,
    period_start,
    period_end,
    issued_at,
    paid_at,
    provider,
    provider_payment_id,
    provider_subscription_id,
    metadata,
    updated_at
  ) values (
    v_company_id,
    case when v_has_plan then 'subscription' else 'addon_topup' end,
    'paid',
    v_invoice_reference,
    coalesce(nullif(v_plan_snapshot->>'name', ''), 'Subscription'),
    coalesce(nullif(v_totals_snapshot->>'final_total_paise', ''), '0')::numeric / 100.0,
    coalesce(nullif(v_totals_snapshot->>'subscription_paise', ''), '0')::numeric / 100.0,
    coalesce(nullif(v_totals_snapshot->>'addons_paise', ''), '0')::numeric / 100.0,
    coalesce(nullif(v_totals_snapshot->>'discount_paise', ''), '0')::numeric / 100.0,
    0.18,
    coalesce(nullif(v_totals_snapshot->>'gst_paise', ''), '0')::numeric / 100.0,
    v_billing_cycle,
    coalesce(nullif(v_quote.currency, ''), 'INR'),
    v_period_start,
    v_period_end,
    v_now,
    v_now,
    'razorpay',
    nullif(v_intent.razorpay_payment_id, ''),
    v_provider_subscription_id,
    jsonb_build_object(
      'quote_id', p_quote_id,
      'plan_snapshot', v_plan_snapshot,
      'addons_snapshot', jsonb_build_object(
        'capacity_addons', coalesce(v_addons_snapshot->'capacity_addons', '[]'::jsonb),
        'code_addons', coalesce(v_addons_snapshot->'code_addons', '[]'::jsonb)
      ),
      'totals_snapshot', v_totals_snapshot,
      'payment_intent_id', v_intent.id,
      'razorpay_order_id', v_intent.razorpay_order_id,
      'razorpay_payment_id', v_intent.razorpay_payment_id,
      'correlation_id', p_correlation_id
    ),
    v_now
  )
  on conflict (company_id, reference) do update
    set status = excluded.status,
        provider_payment_id = coalesce(excluded.provider_payment_id, public.billing_invoices.provider_payment_id),
        provider_subscription_id = coalesce(excluded.provider_subscription_id, public.billing_invoices.provider_subscription_id),
        metadata = excluded.metadata,
        updated_at = v_now
  returning * into v_invoice;

  if v_coupon_id is not null then
    select usage_limit, used_count
    into v_coupon_usage_limit, v_coupon_used_count
    from public.coupons
    where id = v_coupon_id
    for update;

    if not found then
      raise exception 'COUPON_NOT_FOUND';
    end if;

    if v_coupon_usage_limit is not null and v_coupon_used_count >= v_coupon_usage_limit then
      raise exception 'COUPON_USAGE_LIMIT_EXCEEDED';
    end if;

    insert into public.coupon_redemptions (
      coupon_id,
      company_id,
      quote_id,
      invoice_id,
      code,
      status,
      discount_paise,
      metadata
    ) values (
      v_coupon_id,
      v_company_id,
      p_quote_id,
      v_invoice.id,
      coalesce(v_coupon_code, ''),
      'redeemed',
      v_coupon_discount_paise,
      jsonb_build_object(
        'quote_id', p_quote_id,
        'invoice_id', v_invoice.id,
        'payment_intent_id', v_intent.id,
        'correlation_id', p_correlation_id
      )
    )
    on conflict (quote_id) do nothing;

    if found then
      update public.coupons
      set used_count = used_count + 1,
          updated_at = v_now
      where id = v_coupon_id;
    end if;
  end if;

  update public.quotes
  set fulfilled_at = v_now,
      status = 'used'
  where id = p_quote_id
    and fulfilled_at is null;

  if not found then
    raise exception 'QUOTE_ALREADY_FULFILLED';
  end if;

  return jsonb_build_object(
    'success', true,
    'no_op', false,
    'quote_id', p_quote_id,
    'company_id', v_company_id,
    'invoice_reference', v_invoice_reference,
    'invoice_id', v_invoice.id
  );
end;
$$;

grant execute on function public.finalize_paid_quote(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.finalize_paid_quote(uuid, uuid, uuid, text) to service_role;
