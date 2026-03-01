DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'labels_units_unique_company_gtin_batch_serial'
  ) THEN
    ALTER TABLE labels_units
    ADD CONSTRAINT labels_units_unique_company_gtin_batch_serial
    UNIQUE (company_id, gtin, batch, serial);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_labels_units_company_serial 
ON labels_units(company_id, serial);

CREATE INDEX IF NOT EXISTS idx_labels_units_company_gtin_batch 
ON labels_units(company_id, gtin, batch);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'labels_units_unique_company_gtin_batch_serial'
  ) THEN
    COMMENT ON CONSTRAINT labels_units_unique_company_gtin_batch_serial ON labels_units IS 
    'Ensures uniqueness of serial numbers within same company, GTIN, and batch for pharmaceutical traceability compliance';
  END IF;
END $$;
