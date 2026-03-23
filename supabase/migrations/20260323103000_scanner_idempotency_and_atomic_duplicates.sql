-- Scanner hardening: idempotency + atomic duplicate registry

-- 1) Extend scan_logs for endpoint/idempotency correlation (backward compatible)
ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS endpoint text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_logs_company_endpoint_idempotency
  ON public.scan_logs (company_id, endpoint, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scan_logs_company_endpoint_scanned_at
  ON public.scan_logs (company_id, endpoint, scanned_at DESC);

-- 2) Request idempotency state table for scanner routes
CREATE TABLE IF NOT EXISTS public.scanner_request_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL CHECK (endpoint IN ('/api/scan', '/api/verify')),
  scope_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'COMPLETED')),
  status_code integer,
  response_snapshot_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint, scope_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_scanner_request_idempotency_created_at
  ON public.scanner_request_idempotency (created_at DESC);

ALTER TABLE public.scanner_request_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access scanner_request_idempotency" ON public.scanner_request_idempotency;
CREATE POLICY "Service role full access scanner_request_idempotency"
  ON public.scanner_request_idempotency
  FOR ALL
  USING (auth.role() = 'service_role');

-- 3) Atomic duplicate registry by company + serial
CREATE TABLE IF NOT EXISTS public.scanner_serial_registry (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  serial text NOT NULL,
  first_scanned_at timestamptz NOT NULL DEFAULT now(),
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  scan_count bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, serial)
);

CREATE INDEX IF NOT EXISTS idx_scanner_serial_registry_company_last
  ON public.scanner_serial_registry (company_id, last_scanned_at DESC);

ALTER TABLE public.scanner_serial_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access scanner_serial_registry" ON public.scanner_serial_registry;
CREATE POLICY "Service role full access scanner_serial_registry"
  ON public.scanner_serial_registry
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.record_scanner_serial_scan(
  p_company_id uuid,
  p_serial text
)
RETURNS TABLE(
  is_duplicate boolean,
  first_scanned_at timestamptz,
  scan_count bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.scanner_serial_registry%ROWTYPE;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_COMPANY_ID';
  END IF;
  IF p_serial IS NULL OR btrim(p_serial) = '' THEN
    RAISE EXCEPTION 'MISSING_SERIAL';
  END IF;

  INSERT INTO public.scanner_serial_registry (
    company_id,
    serial,
    first_scanned_at,
    last_scanned_at,
    scan_count
  )
  VALUES (
    p_company_id,
    btrim(p_serial),
    now(),
    now(),
    1
  )
  ON CONFLICT (company_id, serial)
  DO UPDATE
    SET last_scanned_at = now(),
        scan_count = public.scanner_serial_registry.scan_count + 1
  RETURNING * INTO v_row;

  is_duplicate := v_row.scan_count > 1;
  first_scanned_at := v_row.first_scanned_at;
  scan_count := v_row.scan_count;
  RETURN NEXT;
END;
$$;

