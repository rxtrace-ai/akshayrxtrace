# D2 Staging Evidence Template

Fill one section per scenario while running the staging dress rehearsal.

## Run Metadata

- date:
- environment:
- app commit:
- migrations applied through:
- driver:
- verifier:
- observer:

## Shared Identifiers

- company_id:
- owner_user_id:
- correlation_id:
- quote_id:
- payment_intent_id:
- provider_subscription_id:
- event_id:
- invoice_id:
- erp_import_session_id:
- idempotency_key:

## Scenario Record Template

### Scenario

- scenario id:
- title:
- start time:
- end time:
- status: `pass` / `fail` / `blocked`

### Steps executed

1. 
2. 
3. 

### Expected result

- 

### Actual result

- 

### Evidence captured

- UI screenshots:
- API responses:
- SQL query ids used:
- DB row ids confirmed:
- logs / webhook ids:

### Verification notes

- invoice uniqueness:
- quota correctness:
- subscription/provider state alignment:
- replay/idempotency result:
- audit trail present:

### Failure classification

- severity: `sev-1` / `sev-2` / `sev-3` / `n/a`
- blocking issue:
- follow-up owner:

## Scenario List

Fill the template above once for each:

1. recurring subscription purchase
2. add-on only purchase
3. coupon redemption
4. webhook replay
5. out-of-order webhook lifecycle
6. cancel and reconcile
7. ERP unit import replay
8. ERP SSCC hierarchy import replay
9. generation replay

## D2 Signoff

- any sev-1 found:
- any sev-2 found:
- proceed to D3: `yes` / `no`
- final reviewer:
- final notes:
