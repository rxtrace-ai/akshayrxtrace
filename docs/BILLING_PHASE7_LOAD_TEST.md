# Billing Phase 7 — Load Test Checklist (Generation + Quota)

## Goals
- Confirm quota consumption correctness under concurrency.
- Confirm generation endpoint latency remains acceptable under expected throughput.

## Preconditions
- A paid company with active subscription + known limits.
- Known period window in `company_subscriptions.current_period_start/end`.

## Scenarios
1) **Concurrency correctness**
   - Run 20 parallel requests generating 500 units each (same company).
   - Expect: no double-consumption beyond total units inserted; no negative remaining.
2) **Idempotency retry**
   - Repeat the same request with the same `Idempotency-Key`.
   - Expect: quota not double-consumed (objects may regenerate unless response replay is implemented).
3) **Quota boundary**
   - Generate up to limit, then +1 request.
   - Expect: `403 QUOTA_EXCEEDED`.
4) **Mixed workload**
   - Interleave unit generation and SSCC generation in parallel.
   - Expect: independent counters update and no deadlocks.

## Limits (current)
- Units: `MAX_UNITS_PER_REQUEST = 10000` (`/api/unit/create`)
- Unit generation via `/api/issues`: `MAX_CODES_PER_REQUEST = 10000`
- SSCC unified generation: `MAX_CODES_PER_REQUEST = 10000`, `MAX_CODES_PER_ROW = 1000`

