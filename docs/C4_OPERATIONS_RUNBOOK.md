# C4 Operations Runbook

## Scope

This runbook covers the critical production flows hardened in Batch A-C:

- Razorpay webhook processing
- Quote finalization and invoice generation
- ERP import recovery
- Subscription reconciliation and quota mismatch investigation

## Core lookup keys

Always collect these first before touching state:

- `correlation_id`
- `quote_id`
- `payment_intent_id`
- `provider_subscription_id`
- `event_id`
- `invoice_id`
- `erp_import_session.id`
- `company_id`

## 1. Razorpay webhook failure

Symptoms:

- payment completed at Razorpay but subscription not active
- invoice missing
- duplicate retries visible from provider

Check:

1. Query webhook audit surface:
   - `GET /api/admin/audit/webhook-events?q=<event_id or correlation_id>`
2. Confirm `processing_status`, `retry_count`, and `error_message`
3. Confirm `payment_intents.status='paid'`
4. Confirm quote state and invoice reference:
   - `billing_invoices.reference = quote:<quote_id>`

Recovery:

1. If provider subscription state is correct but local state drifted:
   - call `POST /api/internal/reconcile/razorpay`
2. If payment is paid and quote is still not fulfilled:
   - replay finalization through the compatibility finalize path or reprocess the webhook with the same event id
3. If webhook row shows repeated failure:
   - fix root cause first
   - then retry processing using the same provider event identity so idempotency remains intact

Do not:

- manually insert invoices
- manually grant quotas without documenting correlation to the payment or quote

## 2. Quote finalization incident

Symptoms:

- invoice exists but email/PDF missing
- subscription active but operator wants proof finalization completed
- payment paid but quote remains unfulfilled

Check:

1. Search logs by `correlation_id` and `quote_id`
2. Confirm RPC result from `finalize_paid_quote(...)`
3. Confirm:
   - `quotes.fulfilled_at`
   - `billing_invoices.reference='quote:<quote_id>'`
   - `quota_allocations.source_quote_id=<quote_id>`

Recovery:

1. Re-run finalization safely for the same `quote_id`
2. If invoice PDF is missing:
   - fetch `/api/billing/invoice/<invoice_id>/pdf`
3. If email failed:
   - regenerate PDF if needed, then resend through the transactional email flow

Expected behavior:

- replay should be a no-op
- duplicate invoice or duplicate quota grants should not occur

## 3. ERP import recovery

Symptoms:

- user retries same upload
- import finished partially
- support needs exact imported/duplicate/invalid counts

Check:

1. Query admin audit surface:
   - `GET /api/admin/audit/erp-import-sessions`
   - filter by `company_id`, `idempotency_key`, or session id
2. Review:
   - `status`
   - `response_status`
   - `validated_rows`
   - `imported_rows`
   - `duplicate_rows`
   - `invalid_rows`
   - `error_message`

Recovery:

1. If same payload was retried with same idempotency key:
   - system should replay prior result
2. If session is stuck in `processing`:
   - inspect route logs and DB row timestamps
   - re-run only after confirming the original request is not still active
3. If import failed after partial inserts:
   - use session counts plus DB records to verify exact committed rows before reattempting

## 4. Subscription reconciliation drift

Symptoms:

- customer claims provider shows active/cancelled state but app disagrees
- renewal date differs from Razorpay

Check:

1. Inspect local `company_subscriptions`
2. Run `POST /api/internal/reconcile/razorpay`
3. Compare repaired vs unchanged rows in the response

Recovery:

1. Reconcile first
2. If still mismatched, inspect provider subscription id linkage on:
   - `company_subscriptions`
   - `payment_intents`
   - recent webhook payloads

## 5. Quota mismatch investigation

Symptoms:

- customer reports missing quota after payment
- ERP import or generation used more/less quota than expected

Check:

1. Confirm entitlement snapshot for the company
2. Inspect `quota_allocations` by:
   - `source`
   - `source_quote_id`
   - recent `metadata.correlation_id`
3. For ERP imports, inspect `erp_import_sessions`
4. For generation, inspect request idempotency and route logs by `correlation_id`

Recovery:

1. Determine whether issue is:
   - missing grant
   - duplicate grant
   - bad consumption
   - stale snapshot
2. Fix source-of-truth data first, then refresh summary/state

## Operator checklist

- Never mutate billing/quota rows blind
- Always capture `correlation_id` before remediation
- Prefer replay/reconcile over manual inserts
- Record incident notes with affected `company_id`, `quote_id`, and provider identifiers
