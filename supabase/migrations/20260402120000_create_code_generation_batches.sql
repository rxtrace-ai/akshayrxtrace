CREATE TABLE IF NOT EXISTS public.code_generation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_no TEXT NOT NULL UNIQUE,
  generation_family TEXT NOT NULL CHECK (generation_family IN ('UNIT', 'SSCC')),
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'CSV', 'ERP', 'API')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED')),
  unit_sku_master_id UUID REFERENCES public.unit_sku_master(id) ON DELETE SET NULL,
  sku_id UUID REFERENCES public.skus(id) ON DELETE SET NULL,
  sku_code_snapshot TEXT NOT NULL,
  product_batch_snapshot TEXT,
  code_mode public.code_mode_enum,
  symbol_type TEXT CHECK (symbol_type IN ('QR', 'DATAMATRIX')),
  requested_qty INTEGER NOT NULL CHECK (requested_qty > 0),
  generated_qty INTEGER NOT NULL DEFAULT 0 CHECK (generated_qty >= 0),
  failed_qty INTEGER NOT NULL DEFAULT 0 CHECK (failed_qty >= 0),
  request_id TEXT,
  created_by UUID,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_code_generation_batches_company_created_at
  ON public.code_generation_batches (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_generation_batches_company_status_created_at
  ON public.code_generation_batches (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_generation_batches_company_family_created_at
  ON public.code_generation_batches (company_id, generation_family, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_generation_batches_company_sku_created_at
  ON public.code_generation_batches (company_id, sku_code_snapshot, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_generation_batches_company_batch_created_at
  ON public.code_generation_batches (company_id, product_batch_snapshot, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_generation_batches_request_id
  ON public.code_generation_batches (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.labels_units
  ADD COLUMN IF NOT EXISTS generation_batch_id UUID REFERENCES public.code_generation_batches(id) ON DELETE SET NULL;

ALTER TABLE public.boxes
  ADD COLUMN IF NOT EXISTS generation_batch_id UUID REFERENCES public.code_generation_batches(id) ON DELETE SET NULL;

ALTER TABLE public.cartons
  ADD COLUMN IF NOT EXISTS generation_batch_id UUID REFERENCES public.code_generation_batches(id) ON DELETE SET NULL;

ALTER TABLE public.pallets
  ADD COLUMN IF NOT EXISTS generation_batch_id UUID REFERENCES public.code_generation_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_labels_units_generation_batch_id
  ON public.labels_units(generation_batch_id);

CREATE INDEX IF NOT EXISTS idx_boxes_generation_batch_id
  ON public.boxes(generation_batch_id);

CREATE INDEX IF NOT EXISTS idx_cartons_generation_batch_id
  ON public.cartons(generation_batch_id);

CREATE INDEX IF NOT EXISTS idx_pallets_generation_batch_id
  ON public.pallets(generation_batch_id);

ALTER TABLE public.code_generation_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own company code generation batches" ON public.code_generation_batches;
CREATE POLICY "Users can view own company code generation batches" ON public.code_generation_batches
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM public.companies WHERE user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT company_id FROM public.seats
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin')
    )
  );

DROP POLICY IF EXISTS "Service role full access code generation batches" ON public.code_generation_batches;
CREATE POLICY "Service role full access code generation batches" ON public.code_generation_batches
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS set_code_generation_batches_updated_at ON public.code_generation_batches;
CREATE TRIGGER set_code_generation_batches_updated_at
BEFORE UPDATE ON public.code_generation_batches
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
