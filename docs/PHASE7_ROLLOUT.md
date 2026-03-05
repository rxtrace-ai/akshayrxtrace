# Phase 7 — Migration, Testing, Rollout (Dual-mode GS1 + PIC)

## 1) Preflight checks (run before applying Phase 2 migration)

### A. Duplicate unit serials per company (will block migration)
```sql
select company_id, serial, count(*) as n
from labels_units
group by company_id, serial
having count(*) > 1
order by n desc;
```

### B. Duplicate GTIN per company in SKU master (should be resolved before enabling uniqueness)
```sql
select company_id, gtin, count(*) as n
from skus
where gtin is not null
group by company_id, gtin
having count(*) > 1
order by n desc;
```

## 2) Apply migrations

- Apply `supabase/migrations/20260303090000_phase2_dualmode_schema_normalization.sql`.

## 3) Post-migration verification

### A. Ensure all units have mode + payload
```sql
select
  count(*) filter (where code_mode is null) as code_mode_null,
  count(*) filter (where payload is null) as payload_null
from labels_units;
```

### B. Ensure no sentinel GTIN values remain
```sql
select count(*) as n
from labels_units
where gtin ilike 'PIC:%';
```

## 4) App checks (recommended)

- Run unit tests (if CI available): `npm test`
- Smoke test:
  - Unit generation: GS1 (with GTIN) + PIC (without GTIN)
  - SSCC generation: confirm blocked until a SKU has `gtin`
  - Scan + verify: both payload types

## 5) Rollout approach

- Canary: enable for a small set of tenants first.
- Monitor:
  - rejected generations (compliance_ack missing)
  - scan payload mismatch errors
  - SSCC eligibility rejections

## 6) Rollback (manual)

See the rollback comment block at the end of:
`supabase/migrations/20260303090000_phase2_dualmode_schema_normalization.sql`

