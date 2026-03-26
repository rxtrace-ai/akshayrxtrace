CREATE INDEX IF NOT EXISTS idx_unit_sku_master_company_active_gtin
  ON public.unit_sku_master(company_id, gtin)
  WHERE deleted_at IS NULL AND gtin IS NOT NULL AND btrim(gtin) <> '';
