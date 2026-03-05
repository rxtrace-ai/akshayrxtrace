# Billing Phase 7 — Monitoring Checklist

## Webhooks
- Admin view: `/admin/billing` → Webhooks tab
- API: `GET /api/admin/audit/webhook-events`
- Watch:
  - `processing_status='failed'` count > 0
  - backlog growth (`received`/`processing` not draining)

## Subscription snapshot
- Validate `company_subscriptions.status` changes after `subscription.*` events.
- Validate renewal period roll after `invoice.paid` (period_start/end update).

## Quota consumption
- Admin view: `/admin/billing` → Entitlement Ops tab
- API: `GET /api/admin/audit/entitlement-ops`
- Watch:
  - spikes in `REQUEST_ID_ALREADY_USED` or `MISSING_REQUEST_ID`
  - unexpected `NO_ACTIVE_SUBSCRIPTION` / `TRIAL_EXPIRED`

## Checkout sessions
- Admin view: `/admin/billing` → Checkout Sessions tab
- API: `GET /api/admin/audit/checkout-sessions`
- Watch:
  - sessions stuck in `subscription_initiated` past `expires_at`
  - high replay rates (client retry loops)

## Rate limits
- `/api/razorpay/webhook` is globally rate limited (protects DB).

