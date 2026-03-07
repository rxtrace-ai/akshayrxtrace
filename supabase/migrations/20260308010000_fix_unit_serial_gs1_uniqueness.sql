-- =====================================================
-- GS1 unit serial compliance and uniqueness
-- - Enforce UNIQUE(company_id, gtin, serial) for GS1 rows
-- - Remove broader company-scoped serial uniqueness
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM labels_units
    WHERE gtin IS NOT NULL
    GROUP BY company_id, gtin, serial
    HAVING COUNT(*) > 1
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Migration blocked: duplicate (company_id, gtin, serial) exists in labels_units for GS1 rows.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'labels_units_unique_company_serial'
  ) THEN
    ALTER TABLE labels_units
      DROP CONSTRAINT labels_units_unique_company_serial;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'labels_units_unique_company_gtin_batch_serial'
  ) THEN
    ALTER TABLE labels_units
      DROP CONSTRAINT labels_units_unique_company_gtin_batch_serial;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'labels_units_unique_company_gtin_serial'
  ) THEN
    ALTER TABLE labels_units
      ADD CONSTRAINT labels_units_unique_company_gtin_serial
      UNIQUE (company_id, gtin, serial);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_labels_units_company_gtin_serial
  ON labels_units(company_id, gtin, serial);

COMMENT ON CONSTRAINT labels_units_unique_company_gtin_serial ON labels_units IS
  'Ensures GS1 serial uniqueness per company and GTIN for unit-level pharmaceutical traceability.';
