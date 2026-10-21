-- Repair scan-log schema drift without rewriting historical records.
ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS handset_id uuid;

-- The handset identifier is the existing public.handsets.id UUID. Keep legacy
-- values untouched and enforce the relationship for new writes when available.
DO $$
BEGIN
  IF to_regclass('public.handsets') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.scan_logs'::regclass
         AND conname = 'scan_logs_handset_id_fkey'
     ) THEN
    ALTER TABLE public.scan_logs
      ADD CONSTRAINT scan_logs_handset_id_fkey
      FOREIGN KEY (handset_id) REFERENCES public.handsets(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- Matches the dashboard query pattern: company scope, optional status, newest first.
CREATE INDEX IF NOT EXISTS idx_scan_logs_company_status_scanned_at
  ON public.scan_logs (company_id, status, scanned_at DESC);
