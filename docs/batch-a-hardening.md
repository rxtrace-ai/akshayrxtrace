# Batch A Hardening

## Status

- Phase: `A4`
- Scope: `Batch A (A0-A4)`
- Objective: stabilize and harden the billing, subscription, webhook, and finalization flows before modifying runtime behavior

## Batch A Goal

Batch A must eliminate the current production blockers in:

- billing correctness
- webhook safety
- idempotency
- retry safety

Batch A specifically covers:

- `A0`: freeze and baseline
- `A1`: canonical billing model cutover
- `A2`: real Razorpay subscription flow
- `A3`: webhook hardening
- `A4`: atomic checkout finalization

## Active Runtime Billing Flow Map

### Quote creation

- Route: `POST /api/user/subscription/checkout/quote`
- File: `app/api/user/subscription/checkout/quote/route.ts`
- Primary library: `lib/billing/userCheckout.ts`
- Writes:
  - `quotes`
- Reads:
  - `subscription_plan_templates`
  - `subscription_plan_versions`
  - `add_ons`
  - `coupons`

### Payment initiation

- Route: `POST /api/user/subscription/checkout/payment/initiate`
- File: `app/api/user/subscription/checkout/payment/initiate/route.ts`
- Current behavior:
  - reads `quotes`
  - creates `payment_intents`
  - creates Razorpay `order`
  - sets local quote/subscription status to `pending_payment`
- Problem:
  - recurring plans currently use order flow instead of real provider subscription flow

### Client payment completion

- UI file: `app/dashboard/subscription/page.tsx`
- Current behavior:
  - opens Razorpay checkout
  - polls local summary/context after payment
- Note:
  - client-side confirmation route is deprecated and should remain non-authoritative

### Webhook intake

- Route: `POST /api/razorpay/webhook`
- File: `app/api/razorpay/webhook/route.ts`
- Current behavior:
  - verifies signature
  - rate limits globally
  - only processes `payment.captured`
  - calls `process_payment_intent_capture`
  - calls `finalizeQuoteInternal`
  - calls `process_razorpay_webhook_event`
- Problem:
  - event handling is incomplete and current runtime path does not rely on a full subscription lifecycle

### Quote finalization

- Library: `lib/billing/finalizeQuoteInternal.ts`
- Called from:
  - `app/api/razorpay/webhook/route.ts`
  - `app/api/user/subscription/checkout/finalize/route.ts`
- Current behavior:
  - reads `quotes` and `payment_intents`
  - updates `company_subscriptions`
  - writes `quota_allocations`
  - writes `company_addon_subscriptions`
  - writes `billing_invoices`
  - generates invoice PDF
  - sends email
  - marks quote fulfilled
- Problem:
  - not transactional
  - not fully idempotent for all side effects

### Subscription cancel

- Route: `POST /api/user/subscription/cancel`
- File: `app/api/user/subscription/cancel/route.ts`
- Current behavior:
  - updates local `company_subscriptions`
  - does not call Razorpay
- Problem:
  - local-only cancellation is not provider-authoritative

### Provider reconciliation

- Route: `POST /api/internal/reconcile/razorpay`
- File: `app/api/internal/reconcile/razorpay/route.ts`
- Current behavior:
  - scaffold only
  - no external provider fetch
- Problem:
  - cannot repair provider drift

## Active Trial Flow Map

### Trial initiation

- Route: `POST /api/user/trial/activate/initiate`
- File: `app/api/user/trial/activate/initiate/route.ts`
- Current behavior:
  - creates Razorpay order
  - inserts `razorpay_orders`
  - uses idempotency-like receipt reuse pattern
- Problem:
  - race-safe idempotency is not enforced at DB level

### Trial activation webhook

- File: `app/api/razorpay/webhook/route.ts`
- Current behavior:
  - extracts trial payment from order metadata
  - upserts `company_trials`
  - inserts `quota_allocations`
- Problem:
  - partial failure recovery is weak

## Canonical Target Model For Batch A

### Subscription state

- Canonical local table: `company_subscriptions`
- Canonical provider source: Razorpay subscription object for recurring plans
- Rule:
  - local table mirrors provider state
  - provider lifecycle drives renewals, cancellations, payment status

### Quote state

- Canonical table: `quotes`
- Rule:
  - quote is an immutable commercial snapshot
  - quote is fulfilled exactly once

### Payment state

- Canonical local table: `payment_intents`
- Canonical provider source:
  - Razorpay subscription for recurring plans
  - Razorpay order/payment for one-time purchases

### Invoice state

- Canonical table: `billing_invoices`
- Rule:
  - invoice creation must be idempotent
  - invoice references must be stable and unique

### Entitlement grant state

- Canonical table: `quota_allocations`
- Rule:
  - grants come from subscription, add-ons, trial, and admin actions
  - paid quote application must be idempotent

### Trial state

- Canonical table: `company_trials`
- Rule:
  - trial remains independent from paid subscription state

## Source Of Truth Matrix

| Domain | Canonical Source | Notes |
| --- | --- | --- |
| Recurring subscription lifecycle | Razorpay subscription + `company_subscriptions` mirror | Current runtime is not yet compliant |
| One-time payment capture | Razorpay payment/order + `payment_intents` | Used for add-ons and currently also misused for plans |
| Quote commercial snapshot | `quotes` | Must remain immutable after payment start |
| Invoice record | `billing_invoices` | Must be created idempotently |
| Quota grants | `quota_allocations` | Do not derive grants from UI or legacy plan tables |
| Entitlement snapshot | `get_company_entitlement_snapshot` | Must be aligned with latest correct schema |
| Trial state | `company_trials` | Separate from paid subscription |

## Legacy Or Unsafe Paths To Disable Or Replace

### Replace

- Recurring plan purchase through Razorpay order flow
- Local-only subscription cancellation
- Scaffold-only reconciliation route
- Non-transactional quote finalization

### Remove runtime dependency

- Legacy plan/quota reads in `lib/usage/tracking.ts`
- Hard-coded provider plan fallback in `app/api/admin/subscription-plans/route.ts`
- Any logic that treats `payment.captured` as the only meaningful subscription event

### Keep only as compatibility shell until replaced

- `POST /api/user/subscription/checkout/finalize`
  - may remain as a compatibility endpoint
  - must not become the authoritative activation path over webhook/provider state

## Known Batch A Blocking Findings

1. recurring plans are not implemented as real provider subscriptions
2. subscription cancel does not cancel at provider
3. webhook runtime path is incomplete and only handles `payment.captured`
4. finalization is multi-step and non-atomic
5. coupon usage is not redeemed
6. trial order idempotency is race-unsafe
7. reconciliation is not implemented as an actual provider sync

## Batch A Non-Negotiables

- recurring plans must create real Razorpay subscriptions
- subscription cancel must be provider-aware
- webhook processing must be replay-safe and lifecycle-complete
- quote finalization must be atomic and idempotent
- provider drift must be repairable through reconciliation

## A1 Implementation Boundary

A1 must only establish the canonical billing model and remove active split-brain behavior.

### A1 implementation notes

- recurring plan quotes are now explicitly modeled as `recurring_plan`
- add-on only quotes are explicitly modeled as `one_time_addon`
- the payment initiation route now blocks recurring plan checkout through the one-time Razorpay order path
- admin plan creation no longer auto-links new plans to a placeholder provider plan id
- provider plan ids must now be explicit in admin plan management

### A1 tasks

- classify every active billing route as `keep`, `replace`, or `remove`
- enforce recurring-vs-one-time purchase mode split
- remove hard-coded default provider plan linkage
- remove runtime dependency on legacy plan/quota sources where they affect live billing logic
- document target subscription state machine

### A1 route disposition

| Route/File | Disposition |
| --- | --- |
| `app/api/user/subscription/checkout/quote/route.ts` | keep |
| `app/api/user/subscription/checkout/payment/initiate/route.ts` | replace recurring-plan behavior |
| `app/api/user/subscription/cancel/route.ts` | replace |
| `app/api/razorpay/webhook/route.ts` | replace/harden |
| `app/api/internal/reconcile/razorpay/route.ts` | replace |
| `app/api/user/subscription/checkout/finalize/route.ts` | keep as compatibility wrapper only |

## A2-A4 Dependency Sequence

1. A1 canonical cutover
2. A2 real provider subscription creation/cancel/reconcile
3. A3 webhook event coverage and replay-safe processing
4. A4 transactional finalization

## A2 Implementation Notes

- recurring plan checkout now creates a real Razorpay subscription instead of a Razorpay order
- recurring subscription ids are persisted on `payment_intents` for quote-to-provider correlation
- add-ons only checkout remains on the one-time Razorpay order flow
- recurring plan checkout now rejects mixed carts that include add-ons
- subscription cancel now calls Razorpay first and mirrors provider state locally
- internal reconciliation now performs a real provider fetch and repairs local subscription drift

## A3 Implementation Notes

- webhook intake now accepts recurring lifecycle and invoice events instead of ignoring everything except `payment.captured`
- webhook dedupe now uses the Razorpay webhook event id header when available, with a deterministic fallback key
- quote-backed recurring subscriptions are now synchronized from webhook events using `payment_intents.provider_subscription_id`
- recurring webhook success updates local subscription mirrors and marks quote payment intents paid before finalization
- supported webhook processing now returns `500` on internal failures so Razorpay can retry instead of silently swallowing broken state

## A4 Implementation Notes

- authoritative quote fulfillment now moves through the `finalize_paid_quote` database function instead of a multi-call TypeScript write sequence
- structural add-on subscriptions now have quote-scoped idempotency through `company_addon_subscriptions.source_quote_id`
- the TypeScript finalizer is now a post-commit wrapper that only runs invoice PDF generation and transactional email after the database transaction succeeds
- quote, subscription, quota, structural add-on, invoice, and fulfilled markers are now applied together inside one SQL transaction boundary

## Batch A Acceptance Checklist

Batch A cannot close until all are true:

- recurring plan checkout creates a real Razorpay subscription
- add-on only checkout remains one-time and isolated from recurring plan flow
- local cancel route propagates to Razorpay and local state matches provider
- webhook handles full recurring lifecycle events
- webhook replay produces no duplicate invoices, quotas, or add-on subscriptions
- quote finalization is transactional or equivalent via single authoritative RPC
- quote replay is a no-op
- reconciliation performs real provider sync
- billing tables and runtime code have one canonical source-of-truth model

## Out Of Scope For Batch A

- ERP ingestion rewrite
- coupon redemption ledger implementation
- frontend performance polish
- full observability/runbook rollout

These remain Batch B or later unless they block Batch A correctness work.

## A0 Exit Criteria

A0 is complete when:

- active billing and trial routes are inventoried
- canonical target model is written down
- route disposition is defined
- non-negotiables for Batch A are explicit
- A1-A4 execution order is fixed
