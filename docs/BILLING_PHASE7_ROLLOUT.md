# Billing Phase 7 — Migration, Testing, Rollout

## 1) Preflight checks (run before enabling paid billing)

### A. Duplicate company subscription rows (should be 0 or clearly historical)
```sql
select company_id, count(*) as n
from company_subscriptions
group by company_id
having count(*) > 1
order by n desc;
```

### B. Webhook backlog
```sql
select processing_status, count(*) as n
from webhook_events
group by processing_status;
```

### C. Entitlement idempotency collisions
```sql
select company_id, request_id, count(*) as n
from entitlement_operation_log
group by company_id, request_id
having count(*) > 1
order by n desc;
```

## 2) Apply migrations (in order)
- Ensure Phase 5 webhook migrations exist/applied (already in repo):
  - `supabase/migrations/20260301190000_phase5_webhook_coverage.sql`
  - `supabase/migrations/20260301191000_phase5_activation_quota_application.sql`
  - `supabase/migrations/20260301192000_phase5_renewal_model.sql`
- Apply provider sync trigger:
  - `supabase/migrations/20260305123000_phase5_company_subscriptions_provider_sync.sql`

## 3) Post-migration verification

### A. Provider fields aligned
```sql
select
  count(*) filter (where provider_subscription_id is null and razorpay_subscription_id is not null) as missing_provider_sub_id,
  count(*) filter (where provider_customer_id is null and razorpay_customer_id is not null) as missing_provider_customer_id
from company_subscriptions;
```

### B. Renewal cycle windows present for paid companies
```sql
select count(*) as missing_period_end
from company_subscriptions
where lower(coalesce(status,'')) in ('active','past_due','paused')
  and current_period_end is null;
```

## 4) Smoke tests (recommended)
- Checkout initiate → Razorpay payment → webhook → `company_subscriptions` updated.
- Invoice paid webhook rolls cycle: `current_period_start/end` updated and base usage counters reset for the new period.
- Idempotency: retry generation call with same `Idempotency-Key` does not double-consume quota.

## 5) Rollout approach
- Canary: enable paid checkout for 1–3 internal companies.
- Monitor:
  - webhook processing failures (`webhook_events.processing_status='failed'`)
  - spikes in `NO_ACTIVE_SUBSCRIPTION` / `PAST_DUE` in generation endpoints
  - entitlement consumption errors (`entitlement_operation_log` volume)

## 6) Rollback strategy
- Disable checkout UI routes (feature flag or route guard) while keeping webhook ingestion running.
- No destructive DB rollback recommended; all changes are additive.

