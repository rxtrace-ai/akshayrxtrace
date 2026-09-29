# RxTrace Notification System Audit and V1 Changes

Audit scope: repository review of mail providers, email templates, backend trigger paths, Razorpay webhook handling, scheduler routes, dashboard notification utilities, and queue/ledger objects. No billing, subscription, quota allocation, or reset rules were changed.

## Existing notification inventory

| Notification | Trigger | Status before this change | Implementation |
| --- | --- | --- | --- |
| OTP verification | Signup / resend OTP API | Existing | `lib/auth/otp.ts`, `app/api/auth/send-otp/route.ts` |
| Password reset | Password reset API | Existing | `app/api/auth/password-reset/route.ts`, `lib/transactionalEmail.ts` |
| Generic welcome | `POST /api/auth/send-welcome` | Existing; separate from company setup / FREE activation | `app/api/auth/send-welcome/route.ts`, `lib/auth/welcome.ts` |
| Seat invitation | Seat invite API | Existing | `app/api/admin/seats/invite/route.ts`, `lib/email.ts` |
| Subscription invoice / purchase | Paid quote finalization | Existing | `lib/billing/finalizeQuoteInternal.ts`, `lib/billing/invoiceLifecycle.ts`, `lib/transactionalEmail.ts` |
| Subscription cancellation | User cancellation API | Existing | `app/api/user/subscription/cancel/route.ts`, `lib/transactionalEmail.ts` |
| Expiry reminders (7 and 2 days) | Subscription email route | Existing; no cron entry in `vercel.json` | `app/api/internal/cron/subscription-emails/route.ts` |
| Subscription expired | Subscription email route | Existing; no cron entry in `vercel.json` | `app/api/internal/cron/subscription-emails/route.ts` |
| FREE quota reset email | Universal reset cron | Missing; now implemented | `app/api/internal/cron/subscription-reset/route.ts` |
| FREE company setup welcome | FREE activation after company setup | Missing; now implemented | `app/dashboard/company-setup/actions.ts` |
| Upgrade success | Paid invoice confirmed for a plan tier increase | Missing; now implemented | `app/api/razorpay/webhook/route.ts` |
| Paid renewal success | Razorpay invoice paid for a later period | Missing; now implemented | `app/api/razorpay/webhook/route.ts` |
| Renewal payment failure | Razorpay `invoice.payment_failed` | Missing; now implemented | `app/api/razorpay/webhook/route.ts` |
| Operational email alert | Alert-channel utility | Present as SMTP utility, marked PHASE-14 | `lib/alerting/channels.ts` |

Email providers in use are Resend for transactional templates and invite mail, SMTP fallbacks for signup welcome/OTP/invites, and SMTP for the legacy alert utility. No React email sender was found. Dashboard UI uses transient toast messages; there is no persistent in-app notification center. Before this change there was no email notification ledger or email queue. Razorpay webhook event records are payment processing records, not email delivery records.

The Universal Reset Engine cron is configured in `vercel.json` to run daily at `00:05 UTC`. The database reset function grants FREE quota on calendar-month boundaries and is idempotent; the daily scheduler checks the boundary. The separate subscription reminder route is not configured as a Vercel cron in the current repository.

## Changes implemented

### Templates and triggers

| Event / template | Trigger | Idempotency key |
| --- | --- | --- |
| `FREE_WELCOME` | Company setup server action, after confirming active FREE subscription | `free-welcome:<company_id>` |
| `FREE_QUOTA_RESET` | Reset cron, for each FREE period row created for the returned period | `free-quota-reset:<subscription_id>:<period_start>` |
| `SUBSCRIPTION_UPGRADED` | Verified `invoice.paid` where plan tier increases, including FREE to paid | `subscription-upgraded:<subscription_id>:<period_start>:<new_plan>` |
| `SUBSCRIPTION_RENEWED` | Verified `invoice.paid` for the same paid plan and a later subscription period | `subscription-renewed:<razorpay_invoice_id>` |
| `SUBSCRIPTION_PAYMENT_FAILED` | `invoice.payment_failed` | `subscription-payment-failed:<razorpay_invoice_id>` |
| Existing `SUBSCRIPTION_PURCHASED` invoice email | Existing finalization workflow | `subscription-purchase-invoice:<billing_invoice_id>` |

Email HTML is escaped through the existing transactional template shell. FREE welcome includes the company, FREE active status, login, and getting started links and has no invoice. Reset email reports base monthly Unit QR, Box QR, Carton QR, and Pallet SSCC amounts from that period's allocations. Renewal email uses the existing invoice renderer to attach a generated invoice PDF and includes plan, dates, cycle, and remaining quota. The invoice link remains available if PDF attachment generation fails.

The new migration `supabase/migrations/20260928120000_notification_delivery_ledger.sql` adds `notification_delivery_logs`, a unique idempotency key, and service-role-only atomic claim/finalize RPCs. Delivery calls send the same key to Resend as its idempotency header. Failed entries can be retried; stale pending claims can be reclaimed after 15 minutes. Duplicate Razorpay invoice webhooks re-enter the idempotent sync path so a failed notification can be retried. FREE cron repeats are deduplicated by the ledger.

## Database ledger

`notification_delivery_logs` stores event type, company ID, recipient email, status (`pending`, `sent`, or `failed`), sent timestamp, metadata, idempotency key, error, and timestamps. The application service and server-side triggers write it through `claim_notification_delivery` and `finish_notification_delivery`; no browser role can read or write it. There was no previous notification ledger to migrate or reconcile.

## Gaps and boundaries

- No configured subscription grace-period duration or grace-period end field was found. The payment-failed email gives the paid-through date when available; otherwise it states that no grace period is configured. It does not invent a grace period or alter subscription status.
- Notification failures are recorded and do not fail company setup or subscription webhook processing. FREE reset retries are naturally revisited by the daily cron. Paid webhook retries can retry failed/stale deliveries using the same event; if Razorpay never retries that event, there is no separate paid-notification retry scheduler in this change.
- Existing expiry reminders, cancellation, password-reset, OTP, invitation, and legacy operational alert messages remain as they were. The ledger is applied to the new V1 subscription notifications and the existing invoice email relevant to paid purchase/webhook replay; the older unrelated mail paths have not been redesigned.
- Email delivery is not provably exactly-once across an external provider and PostgreSQL. The unique ledger claim prevents concurrent/replayed duplicate sends; provider idempotency uses the same event key to reduce the ambiguity window if the process crashes after provider acceptance.

## Validation

- Template tests cover the five new events, requested subjects/content, and provider idempotency header.
- Delivery tests cover successful ledger completion and duplicate-claim suppression.
- Razorpay webhook regression suite covers payment capture replay, invoice-paid finalization replay, and out-of-order payment failure handling.
- Run result: `npx tsc --noEmit` passed; targeted Vitest suite passed (3 files, 11 tests).
- Not tested against live Resend, Razorpay, or Supabase. The migration must be applied to the target Supabase project before deployment.
