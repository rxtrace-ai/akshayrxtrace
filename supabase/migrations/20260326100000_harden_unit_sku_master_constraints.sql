DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unit_sku_master_sku_code_not_blank'
  ) THEN
    ALTER TABLE public.unit_sku_master
      ADD CONSTRAINT unit_sku_master_sku_code_not_blank
      CHECK (btrim(sku_code) <> '');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unit_sku_master_batch_not_blank'
  ) THEN
    ALTER TABLE public.unit_sku_master
      ADD CONSTRAINT unit_sku_master_batch_not_blank
      CHECK (btrim(batch) <> '');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unit_sku_master_gtin_not_blank'
  ) THEN
    ALTER TABLE public.unit_sku_master
      ADD CONSTRAINT unit_sku_master_gtin_not_blank
      CHECK (gtin IS NULL OR btrim(gtin) <> '');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unit_sku_master_mrp_nonnegative'
  ) THEN
    ALTER TABLE public.unit_sku_master
      ADD CONSTRAINT unit_sku_master_mrp_nonnegative
      CHECK (mrp IS NULL OR mrp >= 0);
  END IF;
END $$;
