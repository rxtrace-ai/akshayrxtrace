-- ============================================================
-- PHASE 2: Dual-mode (GS1 + PIC) schema normalization (DB only)
-- ============================================================
-- Goals:
-- - Introduce skus.gtin (nullable) with partial uniqueness per company
-- - Normalize labels_units to store (code_mode, payload) independent of gtin
-- - Remove sentinel GTIN hacks and drop GTIN-dependent uniqueness
-- - Add company-scoped serial uniqueness invariant
-- - Add ack_logs for compliance consent/audit
--
-- Notes:
-- - Keeps labels_units.gs1_payload temporarily for backward compatibility.
-- - This migration intentionally does NOT change any application code.

-- 0) Create ENUM type for code_mode (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'code_mode_enum') THEN
    CREATE TYPE code_mode_enum AS ENUM ('GS1', 'PIC');
  END IF;
END $$;

-- 1) SKU master: add skus.gtin + partial uniqueness per company
ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS gtin TEXT;

-- Partial unique index: one GTIN per company (nullable)
CREATE UNIQUE INDEX IF NOT EXISTS idx_skus_company_id_gtin_unique
  ON skus(company_id, gtin)
  WHERE gtin IS NOT NULL;

-- 2) Units: make gtin nullable (remove NOT NULL dependency)
ALTER TABLE labels_units
  ALTER COLUMN gtin DROP NOT NULL;

-- 3) Units normalization: add code_mode + payload (add nullable first for safe backfill)
ALTER TABLE labels_units
  ADD COLUMN IF NOT EXISTS code_mode code_mode_enum,
  ADD COLUMN IF NOT EXISTS payload TEXT;

-- 4) Backfill code_mode + payload
-- Rules:
-- - If gtin is all digits => GS1
-- - If gtin starts with 'PIC:' => PIC
-- - Otherwise: if gtin is NULL/empty => PIC, else default GS1 (legacy/unknown)
UPDATE labels_units
SET
  code_mode = CASE
    WHEN gtin ~ '^[0-9]+$' THEN 'GS1'::code_mode_enum
    WHEN gtin ILIKE 'PIC:%' THEN 'PIC'::code_mode_enum
    WHEN gtin IS NULL OR btrim(gtin) = '' THEN 'PIC'::code_mode_enum
    ELSE 'GS1'::code_mode_enum
  END,
  payload = COALESCE(payload, gs1_payload)
WHERE
  code_mode IS NULL
  OR payload IS NULL;

-- Remove Phase 1 sentinel GTIN values now that code_mode/payload exist
UPDATE labels_units
SET gtin = NULL
WHERE gtin ILIKE 'PIC:%';

-- 5) Enforce NOT NULL after backfill
ALTER TABLE labels_units
  ALTER COLUMN code_mode SET NOT NULL,
  ALTER COLUMN payload SET NOT NULL;

-- 6) Consent/Audit: ack_logs table
CREATE TABLE IF NOT EXISTS ack_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  code_mode code_mode_enum NOT NULL,
  ack_text_version TEXT NOT NULL,
  request_id TEXT,
  ack_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ack_logs_company_id ON ack_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_ack_logs_user_id ON ack_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ack_logs_request_id ON ack_logs(company_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ack_logs_ack_at ON ack_logs(ack_at DESC);

-- 7) Serial uniqueness: replace GTIN-dependent uniqueness with company-scoped serial uniqueness
-- 7a) Safety check: fail migration if duplicates exist for (company_id, serial)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM labels_units
    GROUP BY company_id, serial
    HAVING COUNT(*) > 1
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Phase 2 migration blocked: duplicate (company_id, serial) exists in labels_units. Resolve duplicates before applying UNIQUE(company_id, serial).';
  END IF;
END $$;

-- 7b) Drop old constraint if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'labels_units_unique_company_gtin_batch_serial'
  ) THEN
    ALTER TABLE labels_units
      DROP CONSTRAINT labels_units_unique_company_gtin_batch_serial;
  END IF;
END $$;

-- 7c) Add new uniqueness invariant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'labels_units_unique_company_serial'
  ) THEN
    ALTER TABLE labels_units
      ADD CONSTRAINT labels_units_unique_company_serial
      UNIQUE (company_id, serial);
  END IF;
END $$;

-- Optional (recommended): keep index for query perf if missing (non-unique)
CREATE INDEX IF NOT EXISTS idx_labels_units_company_serial
  ON labels_units(company_id, serial);

-- ============================================================
-- Rollback (manual; do NOT run automatically)
-- ============================================================
-- Soft rollback (keep Phase 2 columns, revert invariants):
--   1) ALTER TABLE labels_units DROP CONSTRAINT IF EXISTS labels_units_unique_company_serial;
--   2) Recreate old constraint only if gtin is NOT NULL and data is compatible:
--        ALTER TABLE labels_units
--          ADD CONSTRAINT labels_units_unique_company_gtin_batch_serial
--          UNIQUE (company_id, gtin, batch, serial);
--
-- Hard rollback (data-loss risk for Phase 2 columns):
--   DROP TABLE IF EXISTS ack_logs;
--   ALTER TABLE labels_units DROP COLUMN IF EXISTS payload;
--   ALTER TABLE labels_units DROP COLUMN IF EXISTS code_mode;
--   DROP TYPE IF EXISTS code_mode_enum;
--   DROP INDEX IF EXISTS idx_skus_company_id_gtin_unique;
--   ALTER TABLE skus DROP COLUMN IF EXISTS gtin;
--   -- Re-apply labels_units.gtin SET NOT NULL only after you’ve repopulated NULLs
--   -- (PIC rows would need a real value or a different design).
