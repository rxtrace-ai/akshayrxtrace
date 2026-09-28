# Universal Reset Engine Validation

## Implemented

- Added migration `20260928100000_universal_subscription_reset_engine.sql` with period history, unique per-subscription period keys, a universal daily scheduler RPC, paid-cycle allocation RPC, and a FREE-aware entitlement snapshot.
- Added `/api/internal/cron/subscription-reset`, protected by `CRON_SECRET` or `INTERNAL_SYNC_TOKEN`, and scheduled it daily at 00:05 UTC in `vercel.json`.
- Kept paid quota grants payment-confirmed: invoice-paid/charged webhooks call the idempotent paid-period RPC. The cron never grants paid quotas without a confirmed cycle.
- FREE period quotas are read from the active `subscription_plan_versions` row and allocated for the current UTC calendar month. FREE subscription rows keep null period end and appear lifetime-active.
- New periods expire prior base code-quota allocations. Yearly plan quotas are allocated once for the provider's annual period. No code copies seats, plants, or handsets into monthly quota allocations; current subscription capacity allocations are extended over paid renewal windows without resetting active capacity use.
- Updated dashboard and subscription page to display FREE lifetime access/monthly quota and paid cycle dates/renewal or annual remaining quota. Renew and cancel actions are hidden for FREE.

## Validation Results

- `npx tsc --noEmit`: passed.
- `npm test -- --run`: passed, 27 test files / 69 tests.
- `npm run build`: passed; Next.js compiled, linted, type-checked, generated 88 static pages, and collected build traces. It emitted existing dependency instrumentation warnings and a stale Browserslist database warning.
- Migration was reviewed statically but **not applied to a live or local Supabase database**. Scheduler execution and SQL concurrency behavior therefore still need deployment-level verification after applying the migration.

## Lifecycle Validation Matrix

| Scenario | Implemented behavior | Validation boundary |
|---|---|---|
| FREE month boundary | Daily cron allocates one active-version quota set per UTC calendar month; database unique period key prevents duplicate grants. | Requires migration applied and Vercel cron secret configured. |
| Monthly paid cycle | Provider-confirmed webhook allocates a fresh period from the immutable original quote; prior base quota expires at the new start. | Requires the provider to emit the configured paid-cycle webhook with a valid period window. |
| Yearly paid cycle | Annual amount is allocated for the annual provider window; no scheduler allocation runs during the year. | Requires annual payment webhook and period data. |
| No rollover | Previous base unit/box/carton/pallet allocations are expired at period start. | Add-on lifecycle retains its existing catalog expiry policy. |
| Capacity | Reset RPC only changes unit/box/carton/pallet allocations. Subscription seat/plant/handset amounts are not reallocated monthly; active use stays row-count based. | Paid renewal extends capacity allocation validity; plan changes continue to use the existing quote finalizer. |
| Duplicate scheduler/webhook | `subscription_quota_periods` unique `(subscription_id, period_start)` and quota allocation unique key prevent a second period grant. | Database concurrency test not run without a Supabase instance. |
| Existing paid checkout | Initial paid grant remains owned by existing quote finalization. Webhook RPC detects matching initial period rows and avoids duplicating them. | Existing test suite passes; end-to-end Razorpay sandbox test not run. |

## Deployment Notes

Apply the migration before enabling the cron route. Configure `CRON_SECRET` in the deployment environment; Vercel scheduled requests must carry `Authorization: Bearer <CRON_SECRET>`. Then run a database-backed check for FREE month rollover, webhook paid-period allocation, idempotent replay, yearly expiration, and capacity preservation. The app build cannot validate SQL execution against the production schema.
