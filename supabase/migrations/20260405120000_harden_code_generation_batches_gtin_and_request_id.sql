ALTER TABLE public.code_generation_batches
  ADD COLUMN IF NOT EXISTS gtin_snapshot TEXT;

CREATE INDEX IF NOT EXISTS idx_code_generation_batches_company_gtin_created_at
  ON public.code_generation_batches (company_id, gtin_snapshot, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_generation_batches_company_request_id_unique
  ON public.code_generation_batches (company_id, request_id)
  WHERE request_id IS NOT NULL;
