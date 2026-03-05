# Billing Phase 5 — Razorpay Webhook → Subscription Snapshot

## Source of truth
- Webhook events are processed atomically in DB via `process_razorpay_webhook_event(...)`.
- Subscription state lives in `company_subscriptions` and is consumed by `get_company_entitlement_snapshot(...)`.

## What Phase 5 ensures
- `company_subscriptions` rows are updated/inserted from `subscription.*` and `invoice.*` Razorpay events.
- Renewal (`invoice.paid`) rolls the billing period and calls `apply_cycle_reset(...)` to reset base-plan usage for the new period.
- Provider snapshot columns stay consistent:
  - `provider = 'razorpay'`
  - `provider_subscription_id` mirrors `razorpay_subscription_id`
  - `provider_customer_id` mirrors `razorpay_customer_id`

## Idempotency
- Webhook idempotency: `webhook_events.event_id` is unique; duplicates are ignored.
- Quota idempotency: `consume_entitlement` replays results via `entitlement_operation_log`.

