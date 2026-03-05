# Billing Phase 4 — Idempotent Quota Consumption

## Goal
All metered endpoints (unit / SSCC / hierarchy generation) must consume quota **exactly once** when clients retry requests.

## Mechanism
Endpoints derive a canonical `request_id` and pass it into `consume_entitlement(...)` via `enforceEntitlement(..., requestId)`.

## Client contract (recommended)
- Always send `Idempotency-Key: <uuid>` for any request that can be retried.
- If a body-level `request_id` already exists (jobs/hierarchy), it will be used as the request id source.

## Current prefixes
- `unit_create:*`
- `issues_generate:*`
- `sscc_generate:*`
- `sscc_create:*`
- `box_create:*`
- `carton_create:*`
- `pallet_create:*`
- `generate_hierarchy:*` (separate `:unit` and `:sscc` suffixes)

## Notes
- Idempotency is enforced in the DB function `consume_entitlement` (see `supabase/migrations/20260301174500_phase2_consume_idempotent_lock.sql`).
- If a client retries with the same idempotency key, the DB returns the previous consumption result instead of double-charging quota.

