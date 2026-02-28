# RXTRACE Phase 1 (Admin Panel) — Locked Contract

## 1) Subscription State Model (single source of truth)
- Allowed values only:
  - `trial`
  - `active`
  - `grace`
  - `suspended`
  - `canceled`
  - `expired`
- Removed from lifecycle model:
  - `trial_status` (separate state field)
  - `upgrade`
  - `pending`

## 2) Data Ownership
- Razorpay is financial source of truth.
- Admin cannot mutate live Razorpay financial configuration:
  - amount
  - billing cycle
  - active plan ID
- Admin can:
  - create internal plan versions
  - adjust limits in internal version model
  - assign versions for future subscriptions

## 3) Plan Versioning (mandatory)
- Templates:
  - `subscription_plan_templates`
- Versions:
  - `subscription_plan_versions`
- Rule:
  - Existing subscriptions remain bound to assigned version.
  - New subscriptions bind to latest active version.

## 4) Company Model
- Add:
  - `deleted_at`
  - `freeze_reason`
- Soft delete only:
  - No hard delete.
  - Preserve billing and audit data.

## 5) RBAC (mandatory)
- Roles:
  - `super_admin`
  - `billing_admin`
  - `support_admin`
- Destructive actions:
  - super_admin only.

## 6) Webhook Safety (mandatory)
- `webhook_events` table with unique `event_id`.
- Duplicate webhook events must be idempotent:
  - replay-safe
  - no double allocation/invoice/state change.

## 7) Immutable Audit Log (mandatory)
- Append-only audit storage.
- No update/delete.
- Must log:
  - freeze
  - reset trial
  - plan version changes
  - bonus quota
  - addon pricing changes
  - coupon creation
  - company soft delete

## 8) Invoice Model
- Primary source: Razorpay invoice data.
- Store:
  - `razorpay_invoice_id`
  - `razorpay_invoice_pdf_url`
  - `status`
  - `amount`
  - `currency`
- Fallback:
  - mark `external_unavailable`.
  - no internal PDF generation in Phase 1.

## 9) API Security Baseline
- Every admin API must enforce:
  - JWT auth
  - role validation
  - tenant scoping
  - schema validation
  - rate limiting
  - correlation ID
  - soft-delete filters
  - idempotency for mutations

## 10) Guardrails
- Freeze:
  - blocks login + API usage
  - does not cancel subscription
- Reset trial:
  - only when status = `trial`
  - not allowed if trial expired beyond policy window
  - max once per company
- Bonus quota:
  - enforce hard system max

## 11) Mutation Idempotency (locked)
- Header required on all admin mutations:
  - `Idempotency-Key: <uuid-v4>`
- Storage:
  - `admin_idempotency_keys`
- Uniqueness:
  - `(admin_id, endpoint, idempotency_key)`
- Behavior:
  - same key + same hash => replay stored response
  - same key + different hash => `409`
- Retention:
  - minimum 24 hours

## 12) Rate Limits (locked)
- Read APIs:
  - `100/min/admin`, burst `120`
- Mutation APIs:
  - `20/min/admin`, burst `30`
- Webhook endpoint:
  - `300/min` global
  - signature check before processing

## 13) Correlation ID Policy (locked)
- Header:
  - `X-Correlation-Id`
- Rules:
  - use incoming value if provided
  - else generate UUID v4
  - always return in response header
  - persist to audit/webhook records

## 14) Out of Scope (Phase 1)
- Audit UI
- Refund UI/workflow management
- Advanced analytics
- Manual invoice generation
- Proration UI
- Multi-tenant admin switching

