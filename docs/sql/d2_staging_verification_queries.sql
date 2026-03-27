-- D2 staging dress rehearsal verification queries
-- Replace :company_id, :quote_id, :event_id, :subscription_id, :invoice_id, :owner_user_id, :idempotency_key as needed.

-- 1. Active plan templates and provider mappings
select
  id,
  name,
  billing_cycle,
  razorpay_plan_id,
  is_active,
  created_at
from public.subscription_plan_templates
order by created_at desc;

-- 2. Active add-ons
select
  id,
  name,
  addon_kind,
  entitlement_key,
  billing_mode,
  is_active,
  created_at
from public.add_ons
order by created_at desc;

-- 3. Active coupons / discounts
select
  id,
  code,
  is_active,
  valid_from,
  valid_to,
  usage_limit,
  used_count,
  created_at
from public.coupons
order by created_at desc;

-- 4. Company subscription state
select
  id,
  company_id,
  status,
  plan_template_id,
  billing_cycle,
  provider,
  provider_subscription_id,
  provider_customer_id,
  current_period_start,
  current_period_end,
  next_billing_at,
  renewal_date,
  cancel_at_period_end,
  updated_at
from public.company_subscriptions
where company_id = :company_id
order by updated_at desc
limit 10;

-- 5. Quote state
select
  id,
  company_id,
  user_id,
  status,
  fulfilled_at,
  expires_at,
  coupon_id,
  coupon_code,
  created_at
from public.quotes
where company_id = :company_id
order by created_at desc
limit 20;

-- 6. Single quote proof
select
  *
from public.quotes
where id = :quote_id;

-- 7. Payment intent proof
select
  id,
  quote_id,
  status,
  amount_paise,
  provider,
  provider_subscription_id,
  provider_customer_id,
  razorpay_order_id,
  razorpay_payment_id,
  processed_at,
  processed_correlation_id,
  updated_at
from public.payment_intents
where company_id = :company_id
   or quote_id = :quote_id
order by updated_at desc
limit 20;

-- 8. Invoice proof
select
  id,
  company_id,
  invoice_type,
  status,
  reference,
  amount,
  base_amount,
  addons_amount,
  discount_amount,
  tax_amount,
  provider,
  provider_payment_id,
  provider_subscription_id,
  invoice_pdf_url,
  created_at
from public.billing_invoices
where company_id = :company_id
order by created_at desc
limit 20;

-- 9. Single invoice proof
select
  *
from public.billing_invoices
where id = :invoice_id;

-- 10. Quote-scoped invoice uniqueness
select
  reference,
  count(*) as invoice_count
from public.billing_invoices
where company_id = :company_id
  and reference = concat('quote:', :quote_id)
group by reference;

-- 11. Quota grants for a quote
select
  company_id,
  source,
  quota_type,
  resource,
  amount,
  expires_at,
  source_quote_id,
  metadata,
  created_at
from public.quota_allocations
where company_id = :company_id
  and source_quote_id = :quote_id
order by created_at asc, resource asc;

-- 12. Coupon redemption proof
select
  *
from public.coupon_redemptions
where company_id = :company_id
order by created_at desc
limit 20;

-- 13. Coupon usage proof
select
  id,
  code,
  usage_limit,
  used_count,
  is_active,
  updated_at
from public.coupons
where id in (
  select coupon_id
  from public.coupon_redemptions
  where company_id = :company_id
);

-- 14. Webhook event proof
select
  id,
  event_id,
  event_type,
  processing_status,
  retry_count,
  correlation_id,
  received_at,
  processed_at,
  error_message
from public.webhook_events
where event_id = :event_id
   or correlation_id = :event_id
order by received_at desc
limit 20;

-- 15. Provider subscription linkage proof
select
  id,
  quote_id,
  provider_subscription_id,
  provider_customer_id,
  status,
  updated_at
from public.payment_intents
where provider_subscription_id = :subscription_id
order by updated_at desc;

-- 16. ERP import session proof
select
  id,
  company_id,
  actor,
  import_type,
  idempotency_key,
  request_hash,
  status,
  total_rows,
  validated_rows,
  imported_rows,
  duplicate_rows,
  skipped_rows,
  invalid_rows,
  response_status,
  error_message,
  created_at,
  updated_at
from public.erp_import_sessions
where company_id = :company_id
order by updated_at desc
limit 20;

-- 17. ERP replay by idempotency key
select
  *
from public.erp_import_sessions
where company_id = :company_id
  and idempotency_key = :idempotency_key
order by updated_at desc;

-- 18. Entitlement snapshot
select public.get_company_entitlement_snapshot(:company_id, now()) as snapshot;

-- 19. Structural add-on subscription proof
select
  id,
  company_id,
  addon_id,
  quantity,
  status,
  starts_at,
  ends_at,
  source_quote_id,
  created_at,
  updated_at
from public.company_addon_subscriptions
where company_id = :company_id
order by created_at desc
limit 20;

-- 20. Detect duplicate quote-scoped add-on application
select
  company_id,
  addon_id,
  source_quote_id,
  count(*) as row_count
from public.company_addon_subscriptions
where company_id = :company_id
  and source_quote_id = :quote_id
group by company_id, addon_id, source_quote_id
having count(*) > 1;

-- 21. Owner idempotency proof for generation / checkout
select
  *
from public.user_idempotency_keys
where user_id = :owner_user_id
order by created_at desc
limit 50;

-- 22. Audit trail around payment/import/generation
select
  action,
  company_id,
  actor,
  status,
  metadata,
  created_at
from public.audit_logs
where company_id = :company_id
order by created_at desc
limit 100;
