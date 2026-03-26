CREATE TABLE IF NOT EXISTS public.unit_sku_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sku_code TEXT NOT NULL,
  gtin TEXT,
  batch TEXT NOT NULL,
  expiry DATE NOT NULL,
  mfd DATE,
  mrp NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_unit_sku_master_company_id
  ON public.unit_sku_master(company_id);

CREATE INDEX IF NOT EXISTS idx_unit_sku_master_company_active
  ON public.unit_sku_master(company_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_unit_sku_master_company_sku_code
  ON public.unit_sku_master(company_id, sku_code)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_sku_master_active_business_key
  ON public.unit_sku_master (
    company_id,
    lower(btrim(sku_code)),
    lower(btrim(batch)),
    expiry,
    COALESCE(mfd, DATE '0001-01-01'),
    COALESCE(mrp, -1::NUMERIC)
  )
  WHERE deleted_at IS NULL;

ALTER TABLE public.unit_sku_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their company unit sku master" ON public.unit_sku_master;
DROP POLICY IF EXISTS "Users can insert their company unit sku master" ON public.unit_sku_master;
DROP POLICY IF EXISTS "Users can update their company unit sku master" ON public.unit_sku_master;

CREATE POLICY "Users can view their company unit sku master"
  ON public.unit_sku_master
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM public.companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their company unit sku master"
  ON public.unit_sku_master
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT id FROM public.companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their company unit sku master"
  ON public.unit_sku_master
  FOR UPDATE
  USING (
    company_id IN (
      SELECT id FROM public.companies WHERE user_id = auth.uid()
    )
  );
