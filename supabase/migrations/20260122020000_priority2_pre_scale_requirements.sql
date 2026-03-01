-- =====================================================
-- PRIORITY 2: PRE-SCALE REQUIREMENTS
-- Performance indexes, audit logging, scan history
-- =====================================================

-- 1. ENSURE SCAN_LOGS TABLE EXISTS
CREATE TABLE IF NOT EXISTS scan_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  handset_id UUID REFERENCES handsets(id) ON DELETE SET NULL,
  raw_scan TEXT NOT NULL,
  parsed JSONB,
  code_id UUID,
  scanner_printer_id TEXT,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  ip TEXT,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'SUCCESS'
);

-- Performance indexes for scan_logs
CREATE INDEX IF NOT EXISTS idx_scan_logs_company_id ON scan_logs(company_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scan_logs'
      AND column_name = 'handset_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_scan_logs_handset_id
      ON scan_logs(handset_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scan_logs'
      AND column_name = 'scanned_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_scan_logs_scanned_at
      ON scan_logs(scanned_at DESC);
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scan_logs'
      AND column_name = 'code_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_scan_logs_code_id
      ON scan_logs(code_id)
      WHERE code_id IS NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scan_logs'
      AND column_name = 'status'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_scan_logs_status
      ON scan_logs(status);
  END IF;
END
$$;

-- ✅ FIXED: Proper JSONB GIN index
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scan_logs'
      AND column_name = 'parsed'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_scan_logs_parsed_jsonb
      ON scan_logs
      USING GIN (parsed jsonb_path_ops);
  END IF;
END
$$;

-- RLS for scan_logs
ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own company scan_logs" ON scan_logs;
CREATE POLICY "Users can view own company scan_logs" ON scan_logs
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT company_id FROM seats 
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

DROP POLICY IF EXISTS "Service role full access scan_logs" ON scan_logs;
CREATE POLICY "Service role full access scan_logs" ON scan_logs
  FOR ALL
  USING (auth.role() = 'service_role');

-- =====================================================
-- 2. AUDIT_LOGS
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  integration_system TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_action ON audit_logs(company_id, action);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own company audit_logs" ON audit_logs;
CREATE POLICY "Users can view own company audit_logs" ON audit_logs
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT company_id FROM seats 
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin')
    )
  );

DROP POLICY IF EXISTS "Service role full access audit_logs" ON audit_logs;
CREATE POLICY "Service role full access audit_logs" ON audit_logs
  FOR ALL
  USING (auth.role() = 'service_role');

-- =====================================================
-- 3. SAFE PERFORMANCE INDEXES FOR EXISTING TABLES
-- =====================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'billing_transactions') THEN
    CREATE INDEX IF NOT EXISTS idx_billing_transactions_company_created 
      ON billing_transactions(company_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_transactions_type 
      ON billing_transactions(type, subtype);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'company_wallets') THEN
    CREATE INDEX IF NOT EXISTS idx_company_wallets_status 
      ON company_wallets(status) WHERE status != 'ACTIVE';
  END IF;
END $$;

-- Remaining tables are assumed safe if they exist