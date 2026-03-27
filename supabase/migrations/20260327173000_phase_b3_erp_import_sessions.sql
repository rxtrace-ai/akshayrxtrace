-- Batch B3: ERP ingestion session ledger
-- - Durable idempotency for ERP imports
-- - Exact import outcome snapshot for replay/recovery

CREATE TABLE IF NOT EXISTS public.erp_import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  import_type text NOT NULL CHECK (import_type IN ('unit', 'sscc')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  validated_rows integer NOT NULL DEFAULT 0 CHECK (validated_rows >= 0),
  imported_rows integer NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  duplicate_rows integer NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
  skipped_rows integer NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),
  invalid_rows integer NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  response_status integer NOT NULL DEFAULT 200 CHECK (response_status >= 100 AND response_status <= 599),
  error_message text,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_import_sessions_company_type_key
  ON public.erp_import_sessions (company_id, import_type, idempotency_key);

CREATE INDEX IF NOT EXISTS erp_import_sessions_company_created_idx
  ON public.erp_import_sessions (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS erp_import_sessions_status_idx
  ON public.erp_import_sessions (status, updated_at DESC);
