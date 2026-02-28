# Phase 8 — Billing/Entitlements Testing & Acceptance Matrix (10/10 Gate)

This document is the **manual acceptance checklist** for the canonical Razorpay subscription + add-ons + coupons + entitlement single-source system.

It is written to be executable in **local/dev** without external Razorpay calls by using:
- **API calls** to our Next.js endpoints (where possible)
- **DB assertions** (SQL queries)
- **Webhook simulation** by invoking the DB webhook processor with representative event payloads

> Notes
> - Real “end-to-end payments” requires Razorpay network calls; in this environment we validate correctness via **idempotent event processing + deterministic state transitions**.
> - “Canonical entitlement” means `get_company_entitlement_snapshot(company_id, now())` is the only source used by dashboard/plants/seats/generation UI.

---

## Pre-flight (Required Setup)

### A) Identify test actors
- `OWNER_USER_ID`: user who owns a company (matches `companies.user_id`)
- `COMPANY_ID`: the company being tested

SQL helpers:
```sql
select id as company_id, user_id as owner_user_id
from public.companies
where deleted_at is null
order by created_at desc
limit 5;
```

### B) Ensure canonical plan data exists (at least 1 active plan template + version)
```sql
select t.id, t.name, t.razorpay_plan_id, t.billing_cycle, t.amount_from_razorpay, t.is_active
from public.subscription_plan_templates t
order by t.created_at desc;

select v.id, v.template_id, v.version_number, v.unit_limit, v.box_limit, v.carton_limit, v.pallet_limit, v.seat_limit, v.is_active
from public.subscription_plan_versions v
order by v.created_at desc;
```

### C) Ensure add-ons exist (structural + variable_quota)
```sql
select id, name, addon_kind, entitlement_key, billing_mode, price, is_active
from public.add_ons
order by display_order asc, created_at desc;
```

### D) Ensure discounts/coupons exist (optional for coupon scenarios)
```sql
select id, code, scope, is_active, valid_from, valid_to, usage_limit, usage_count, razorpay_offer_id
from public.discounts
order by created_at desc;
```

---

## Evidence Pack (What to Capture)

For each scenario below, capture:
- API request + response JSON (or screenshot)
- DB proof queries (copy result rows)
- `audit_logs` entries (if applicable)
- `payment_events` / `webhook_events` rows (for replay proof)

Recommended DB proof queries (reuse across scenarios):
```sql
-- subscription contract
select *
from public.company_subscriptions
where company_id = :company_id
order by updated_at desc
limit 5;

-- checkout orchestration
select id, status, idempotency_key, plan_version_id, totals_json, provider_subscription_id, provider_topup_order_id, completed_at, created_at
from public.checkout_sessions
where company_id = :company_id
order by created_at desc
limit 10;

-- recurring add-ons
select *
from public.company_addon_subscriptions
where company_id = :company_id
order by created_at desc
limit 25;

-- one-time topups
select *
from public.company_addon_topups
where company_id = :company_id
order by created_at desc
limit 25;

-- invoices
select invoice_type, status, amount, provider_invoice_id, provider_payment_id, provider_subscription_id, period_start, period_end, invoice_pdf_url, created_at
from public.billing_invoices
where company_id = :company_id
order by created_at desc
limit 25;

-- idempotency keys (user)
select *
from public.user_idempotency_keys
where user_id = :owner_user_id
order by created_at desc
limit 25;

-- audit trail (billing + entitlement)
select action, company_id, actor, status, created_at, metadata
from public.audit_logs
where company_id = :company_id
order by created_at desc
limit 50;

-- entitlement snapshot (single source of truth)
select public.get_company_entitlement_snapshot(:company_id, now()) as snapshot;
```

---

## Scenario 1 — Plan only purchase → subscription activates → quotas visible

### Steps
1. Call `GET /api/user/subscription/checkout/context` as owner.
2. Pick one active `plan_version_id`.
3. Call `POST /api/user/subscription/checkout/quote` with:
   - `plan_version_id`
   - no add-ons
   - no topups
   - no coupon
4. Call `POST /api/user/subscription/checkout/initiate` (send `Idempotency-Key` header).
5. Simulate Razorpay confirmation by triggering webhook events:
   - `subscription.activated` (or equivalent subscription “active” event)
   - optionally `invoice.paid` if your model requires invoice creation for activation
6. Call `GET /api/user/subscription/summary`.

### Pass criteria
- `company_subscriptions.status` becomes active/paid state (as implemented in DB).
- `get_company_entitlement_snapshot` returns `state = 'PAID_ACTIVE'` (or your canonical paid state).
- Summary API shows **limits > 0** for plan metrics and consistent `remaining`.
- Dashboard pages show the same values (no drift).

---

## Scenario 2 — Plan + structural add-ons + variable top-up → entitlements reflect

### Steps
1. Create quote with:
   - plan version
   - structural add-ons quantities (e.g., seats/plants/handsets)
   - variable top-ups for `unit/box/carton/pallet`
2. Initiate checkout session (idempotent key required).
3. Simulate:
   - subscription event to mark subscription paid/active
   - order/payment event to mark top-up paid (mapped to `checkout_sessions.provider_topup_order_id`)
4. Fetch summary.

### Pass criteria
- `company_addon_subscriptions` has rows for structural add-ons created from the checkout session (no duplicates).
- `company_addon_topups` has rows for each variable top-up applied exactly once.
- Entitlement snapshot shows:
  - structural allocations added to seat/plant/handset limits
  - top-up balances present under `topups`

---

## Scenario 3 — Coupon valid in scope → discount applied

### Steps
1. Pick a discount row where:
   - `is_active = true`
   - `valid_from <= now <= valid_to`
   - `usage_limit` not exceeded
   - correct `scope` for the purchase
2. Create quote with `coupon_code`.

### Pass criteria
- Quote response includes discounted totals and the coupon is attached/snapshotted into `checkout_sessions.coupon_snapshot_json` (or equivalent).
- Initiate rejects if coupon is invalid for that scope.

---

## Scenario 4 — Coupon invalid/expired/limit reached → rejected before initiate

### Steps
Try:
- expired coupon
- inactive coupon
- usage_limit reached
- wrong scope

### Pass criteria
- `POST /quote` or `POST /initiate` returns a deterministic error code/message.
- No new `checkout_sessions` row is created for a rejected request (or it is created but **immediately** marked failed/expired with reason, consistently).

---

## Scenario 5 — Webhook duplicate replay → no double entitlement/invoice

### Steps
1. Pick a real processed webhook event row (or simulate one).
2. Re-submit the **same event_id** to the webhook processor twice.

### Pass criteria
- Second processing is a no-op:
  - `payment_events.processing_status = 'ignored_duplicate'` (or equivalent)
  - no additional `company_addon_topups`, `billing_invoices`, `audit_logs` rows are created

---

## Scenario 6 — Partial success: subscription paid, top-up fail → pending retry supported

### Steps
1. Initiate combined checkout with both legs.
2. Simulate subscription success event only.
3. Do **not** simulate top-up payment event (or simulate failure).
4. Resume flow from UI or by calling initiate again with the same idempotency key.

### Pass criteria
- `company_subscriptions` is active.
- Checkout session is `partial_success` (or equivalent).
- No top-ups applied.
- Subsequent `initiate` is replay-safe and continues the top-up leg without mutating the subscription leg again.

---

## Scenario 7 — Renewal success → base cycle reset + recurring add-ons persist

### Steps
1. Ensure company has an active subscription + nonzero usage (consume entitlement at least once).
2. Simulate renewal event (`subscription.charged` and/or `invoice.paid`) with a new period window.
3. Query usage counters and entitlement snapshot.

### Pass criteria
- Base usage resets to zero for the new period (per `apply_cycle_reset` scope).
- Recurring structural add-ons remain allocated (no lost allocations).
- One-time top-up balances remain unchanged (top-ups are not reset).

---

## Scenario 8 — Renewal fail → status transition + entitlement restriction behavior

### Steps
1. Simulate `invoice.payment_failed`.
2. Fetch summary and attempt a quota-consuming call (generation/plant/seat activation).

### Pass criteria
- Subscription status transitions consistently (as implemented).
- Entitlement snapshot reflects blocked reason consistently.

> If you want a **grace → past_due** model (5 days grace then hard restrict), ensure it’s implemented explicitly; otherwise treat this scenario as “fail transitions exist but grace is not yet enforced.”

---

## Scenario 9 — Concurrency: no quota overshoot (generation + seat + plant)

### Steps (DB-level proof)
1. Ensure plan limits are small (e.g., unit_limit=1 or seat_limit=1) for the test plan version.
2. Fire two parallel requests that consume the same metric at the same time.

### Pass criteria
- Exactly one succeeds; the other fails with `QUOTA_EXHAUSTED`/blocked reason.
- No metric remaining becomes negative.
- `entitlement_operation_log` shows deterministic idempotency handling where applicable.

---

## Scenario 10 — Admin publishes new plan version → new checkout uses new version, existing stays on old

### Steps
1. For a plan template, insert a new version (version_number+1) and mark active.
2. Start a new checkout: confirm it references the new `plan_version_id`.
3. Confirm an existing company subscription continues referencing the older `plan_version_id` until upgraded.

### Pass criteria
- New checkouts bind to current active version.
- Existing subscriptions are stable (no forced migration).

---

## 8.2 Negative / Security Tests

### A) Cross-tenant access attempts

Goal: a logged-in user cannot read or mutate another company’s billing/subscription state.

Steps:
1. Identify `COMPANY_A_ID` owned by `USER_A`, and `COMPANY_B_ID` owned by `USER_B`.
2. As `USER_A`, call:
   - `GET /api/user/subscription/summary` → must return only Company A.
   - Plants/Seats listing endpoints → must only show Company A resources.
3. Attempt to force Company B via query/body parameters (if any exist). All endpoints must ignore client-supplied `company_id`.

Pass criteria:
- No endpoint returns Company B data when authenticated as User A.
- Mutations never accept `company_id` from client.
- RLS prevents cross-tenant reads/writes for billing tables.

---

### B) Tampered quote payload (anti-tamper signature)

Goal: quote is signed server-side and cannot be modified client-side.

Steps:
1. Call `POST /api/user/subscription/checkout/quote` and capture `quote` + `quote_signature`.
2. Modify the quote locally (change quantities or `plan_version_id`).
3. Call `POST /api/user/subscription/checkout/initiate` using the modified `quote` but the original `quote_signature`.

Pass criteria:
- Initiate fails with a deterministic error (400/401).
- No entitlements/subscription rows are created from the tampered request.

---

### C) Reused `Idempotency-Key` with changed payload

Goal: idempotency keys cannot be replayed with different bodies.

Applies to:
- `POST /api/user/subscription/checkout/initiate`
- `POST /api/user/subscription/checkout/confirm-client`
- `POST /api/user/subscription/cancel`

Steps:
1. Send a valid request with header `Idempotency-Key: KEY1`.
2. Re-send the same endpoint with `Idempotency-Key: KEY1` but a different payload.

Pass criteria:
- Server returns a deterministic conflict error or replays the original response.
- DB proof: only one row exists for `(user_id, endpoint, KEY1)` in `public.user_idempotency_keys`.

---

### D) Stale checkout session replay

Goal: expired/completed sessions cannot be reused to create additional entitlements.

Steps:
1. Create a checkout session and let it expire (or set `checkout_sessions.expires_at` to the past for a test row).
2. Attempt:
   - `initiate` replay
   - `confirm-client` on expired/completed session
3. Replay the same webhook event again.

Pass criteria:
- API returns a clear error (`CHECKOUT_EXPIRED` / invalid state) and does not mutate subscription/add-ons/topups.
- Webhook replay remains a no-op (duplicate detection).

---

### E) Webhook signature invalid

Goal: `/api/razorpay/webhook` rejects invalid signatures before hitting DB RPC.

Steps:
```bash
curl -i -X POST http://localhost:3000/api/razorpay/webhook \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: invalid" \
  --data '{"event":"subscription.activated","event_id":"evt_bad_sig_001","payload":{}}'
```

Pass criteria:
- HTTP 401 with `Invalid signature` (plus correlation id header/body).

---

### F) Webhook rate limit

Goal: webhook endpoint rate limits to protect DB.

Current config: `burst=300`, `refillPerMinute=300` (global key).

Steps:
- Send >300 requests quickly (scripted).

Pass criteria:
- At least one request returns HTTP 429 with `Retry-After`.
- Rate-limited requests do not produce partial entitlements.

---

## Sanity Queries (Common “Is it correct?” checks)

---

## Webhook Simulation (DB-only)

If you don’t want to call the HTTP webhook route, you can simulate Razorpay events by invoking the DB processor directly.

1) Find the current function signature:
```sql
select n.nspname as schema, p.proname as fn, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'process_razorpay_webhook_event';
```

2) Call it with a representative payload. The payload must include a stable `event_id` (or equivalent) so replay detection works.

Example skeleton (adjust fields to match your implementation):
```sql
select public.process_razorpay_webhook_event(
  jsonb_build_object(
    'event_id', 'evt_test_001',
    'event', 'subscription.activated',
    'payload', jsonb_build_object(
      'subscription', jsonb_build_object(
        'id', 'sub_test_001'
      )
    )
  )
);
```

Replay test:
```sql
select public.process_razorpay_webhook_event(
  jsonb_build_object('event_id','evt_test_001','event','subscription.activated','payload', jsonb_build_object())
);
```

### A) No duplicates per checkout session
```sql
select checkout_session_id, addon_id, count(*)
from public.company_addon_subscriptions
where company_id = :company_id
group by 1,2
having count(*) > 1;
```

### B) No duplicate top-ups by provider payment id
```sql
select provider_payment_id, count(*)
from public.company_addon_topups
where company_id = :company_id
  and provider_payment_id is not null
group by 1
having count(*) > 1;
```

### C) Snapshot consistency shape check
```sql
select
  (public.get_company_entitlement_snapshot(:company_id, now()) ->> 'state') as state,
  (public.get_company_entitlement_snapshot(:company_id, now()) -> 'limits') as limits,
  (public.get_company_entitlement_snapshot(:company_id, now()) -> 'usage') as usage,
  (public.get_company_entitlement_snapshot(:company_id, now()) -> 'topups') as topups,
  (public.get_company_entitlement_snapshot(:company_id, now()) -> 'remaining') as remaining;
```
