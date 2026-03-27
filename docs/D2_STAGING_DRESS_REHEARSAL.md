# D2 Staging Dress Rehearsal

## Purpose

This is the production-grade staging execution sheet for the hardened Batch A-D flows.

Do not treat this as a smoke test. Treat it as a release gate.

## Preconditions

All of the following must be true before starting:

- latest app build deployed to staging
- all Batch A/B migrations applied in staging
- Razorpay sandbox credentials configured
- `RAZORPAY_WEBHOOK_SECRET` configured in staging
- staging webhook endpoint registered in Razorpay sandbox
- `INTERNAL_RECONCILE_SECRET` configured
- at least one active recurring plan has a valid `razorpay_plan_id`
- at least one active add-on exists
- at least one active test coupon exists
- one clean staging owner account and company are available

## Operators

Assign these roles before starting:

- driver: executes UI/API steps
- verifier: captures DB evidence
- observer: records issues, timestamps, and correlation ids

## Required identifiers to capture

For every scenario, record:

- `company_id`
- `owner_user_id`
- `correlation_id`
- `quote_id`
- `payment_intent_id`
- `provider_subscription_id`
- `event_id`
- `invoice_id`
- `erp_import_session.id`

Use the evidence sheet at [docs/D2_STAGING_EVIDENCE_TEMPLATE.md](/c:/Users/Thinkpad/Rxtrace%20blockchain/docs/D2_STAGING_EVIDENCE_TEMPLATE.md) while running D2 so every scenario has the same proof structure.

## Environment verification

Run these checks first:

1. Confirm env and secrets
2. Confirm plan mappings
3. Confirm coupon availability
4. Confirm webhook endpoint and secret
5. Confirm reconcile secret

Use the SQL in [docs/sql/d2_staging_verification_queries.sql](/c:/Users/Thinkpad/Rxtrace%20blockchain/docs/sql/d2_staging_verification_queries.sql).

Recommended operator flow:

1. driver executes the UI or API step
2. verifier runs the matching SQL proof queries
3. observer records evidence and marks pass/fail in the evidence sheet

## Scenario 1: Recurring subscription purchase

Steps:

1. Open subscription UI as staging owner
2. Select one recurring plan with no add-ons
3. Create quote
4. Initiate checkout
5. Complete Razorpay sandbox authentication
6. Wait for webhook delivery
7. Refresh subscription summary and dashboard

Expected result:

- recurring flow creates provider subscription
- quote is fulfilled exactly once
- invoice exists exactly once
- base quota allocations exist
- subscription summary shows active status and correct dates

Evidence:

- screenshot of UI before and after payment
- DB proof for `quotes`, `payment_intents`, `company_subscriptions`, `billing_invoices`, `quota_allocations`

## Scenario 2: Add-on only purchase

Steps:

1. Ensure the same company has an active subscription
2. Create add-on only quote
3. Initiate one-time payment
4. Complete Razorpay sandbox payment
5. Wait for webhook

Expected result:

- add-on quote finalizes once
- add-on quota is granted once
- no subscription lifecycle corruption

## Scenario 3: Coupon redemption

Steps:

1. Create eligible quote with active coupon
2. Verify quote snapshot includes coupon
3. Complete payment
4. Retry same flow only where safe to confirm replay behavior

Expected result:

- `coupon_redemptions` has one row for the quote
- coupon `used_count` increments once
- replay does not consume the coupon again

## Scenario 4: Webhook replay

Steps:

1. Identify a real webhook event id from the successful payment flow
2. Replay the exact same event id
3. Inspect webhook audit and downstream state

Expected result:

- webhook response remains successful
- duplicate handling is visible
- no duplicate invoice
- no duplicate quota allocation
- no duplicate structural add-on activation

## Scenario 5: Out-of-order webhook lifecycle

Steps:

1. Send or replay `invoice.payment_failed` or equivalent before a success event where staging flow allows
2. Then process the later success event
3. Refresh summary and inspect DB

Expected result:

- failed event does not wrongly finalize the quote
- later success event repairs state
- final subscription state matches provider

## Scenario 6: Cancel and reconcile

Steps:

1. Cancel active subscription from UI/API
2. Verify provider-side state
3. Run internal reconcile

Expected result:

- local cancel state matches provider
- `cancel_at_period_end` is represented correctly
- reconcile reports unchanged or repaired rows accurately

## Scenario 7: ERP unit import replay

Steps:

1. Upload valid unit CSV with a known `Idempotency-Key`
2. Retry the same upload with the same key
3. Inspect ERP import session audit

Expected result:

- second request replays prior result
- no duplicate `labels_units`
- no duplicate quota consumption
- import session status is stable and inspectable

## Scenario 8: ERP SSCC hierarchy import replay

Steps:

1. Upload a single file containing pallet/carton/box relationships
2. Retry with same key
3. Inspect resulting hierarchy

Expected result:

- parent-child references resolve correctly
- replay creates no duplicate rows
- import session reflects correct counts

## Scenario 9: Generation replay

Steps:

1. Generate units with a fixed idempotency key
2. Retry same generation request
3. Generate SSCC hierarchy with a fixed idempotency key
4. Retry same request

Expected result:

- replay is safe
- no double quota consumption
- no duplicate committed generation rows from the replay

## Failure classification

Record every failure as one of:

- Sev-1: money/correctness/security issue
- Sev-2: replay/recovery/idempotency issue
- Sev-3: UI/performance/operational visibility issue

For every failed step, capture:

- scenario id
- exact step
- timestamp
- correlation id
- expected result
- actual result
- blocking severity

## D2 pass criteria

D2 passes only if all are true:

- no duplicate invoice on replay
- no duplicate quota grants on replay
- no subscription drift after reconcile
- no coupon double-redemption
- no ERP replay duplication
- no generation replay duplication
- no incorrect quote finalization from failed/out-of-order webhook
- all evidence captured and attached

## Exit rule

If any Sev-1 or Sev-2 issue appears, stop D2 and do not proceed to D3.
