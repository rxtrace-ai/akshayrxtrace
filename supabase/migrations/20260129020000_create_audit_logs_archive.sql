-- This migration creates the archive table and archival functions for audit logs

-- ============================================================================
-- Ensure audit_logs schema has extended columns used by archival
-- ============================================================================

-- PHASE-13: Extend audit_logs table if older schema is present
-- Some environments only have the minimal columns from 20260101_create_audit_logs.sql.
-- We add the extra columns (old_value, new_value, performed_by, performed_by_email)
-- if they do not already exist, so that this migration and audit logging code work.
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS old_value JSONB,
  ADD COLUMN IF NOT EXISTS new_value JSONB,
  ADD COLUMN IF NOT EXISTS performed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS performed_by_email TEXT;

-- ============================================================================
-- Archive Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs_archive (
  -- Same structure as audit_logs
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  actor TEXT,
  action TEXT NOT NULL,
  status TEXT,
  integration_system TEXT,
  old_value JSONB,
  new_value JSONB,
  performed_by UUID REFERENCES auth.users(id),
  performed_by_email TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  
  -- Archival tracking fields
  archived_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  archive_reason TEXT DEFAULT 'retention_policy',
  original_table TEXT DEFAULT 'audit_logs'
);

-- ============================================================================
-- Indexes for Archive Table
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_company_id ON audit_logs_archive(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_action ON audit_logs_archive(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_created_at ON audit_logs_archive(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_archived_at ON audit_logs_archive(archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_actor ON audit_logs_archive(actor);
CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_performed_by ON audit_logs_archive(performed_by);

-- ============================================================================
-- Archival Function
-- ============================================================================

CREATE OR REPLACE FUNCTION archive_old_audit_logs(
  retention_days INTEGER DEFAULT 90
)
RETURNS TABLE(
  archived_count BIGINT,
  oldest_archived_date TIMESTAMPTZ,
  newest_archived_date TIMESTAMPTZ
) AS $$
DECLARE
  cutoff_date TIMESTAMPTZ;
  archived_count BIGINT;
  oldest_date TIMESTAMPTZ;
  newest_date TIMESTAMPTZ;
BEGIN
  -- Calculate cutoff date
  cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;
  
  -- PHASE-13: Copy old audit logs to archive
  -- Note: We cannot DELETE from audit_logs due to Phase 9 immutability
  -- Instead, we copy records and rely on application-level filtering or views
  INSERT INTO audit_logs_archive (
    id,
    company_id,
    actor,
    action,
    status,
    integration_system,
    old_value,
    new_value,
    performed_by,
    performed_by_email,
    metadata,
    created_at,
    archived_at,
    archive_reason,
    original_table
  )
  SELECT 
    id,
    company_id,
    actor,
    action,
    status,
    integration_system,
    old_value,
    new_value,
    performed_by,
    performed_by_email,
    metadata,
    created_at,
    NOW(),
    'retention_policy',
    'audit_logs'
  FROM audit_logs
  WHERE created_at < cutoff_date
    AND id NOT IN (SELECT id FROM audit_logs_archive);
  
  GET DIAGNOSTICS archived_count = ROW_COUNT;
  
  -- Get date range of archived records
  SELECT MIN(created_at), MAX(created_at)
  INTO oldest_date, newest_date
  FROM audit_logs_archive
  WHERE archived_at >= NOW() - INTERVAL '1 minute';
  
  RETURN QUERY SELECT archived_count, oldest_date, newest_date;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Retention Cleanup Function
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_archived_audit_logs(
  final_retention_years INTEGER DEFAULT 7
)
RETURNS TABLE(
  deleted_count BIGINT,
  oldest_deleted_date TIMESTAMPTZ
) AS $$
DECLARE
  cutoff_date TIMESTAMPTZ;
  deleted_count BIGINT;
  oldest_date TIMESTAMPTZ;
BEGIN
  -- Calculate cutoff date (archived logs older than final retention)
  cutoff_date := NOW() - (final_retention_years || ' years')::INTERVAL;
  
  -- PHASE-13: Delete archived logs beyond final retention period
  -- This is allowed because archive table is not immutable
  DELETE FROM audit_logs_archive
  WHERE archived_at < cutoff_date;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Get oldest deleted date
  SELECT MIN(archived_at)
  INTO oldest_date
  FROM audit_logs_archive
  WHERE archived_at < cutoff_date;
  
  RETURN QUERY SELECT deleted_count, oldest_date;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Unified Query View (Active + Archived)
-- ============================================================================

CREATE OR REPLACE VIEW audit_logs_unified AS
SELECT 
  id,
  company_id,
  actor,
  action,
  status,
  integration_system,
  old_value,
  new_value,
  performed_by,
  performed_by_email,
  metadata,
  created_at,
  'active'::TEXT AS log_source,
  NULL::TIMESTAMPTZ AS archived_at
FROM audit_logs
WHERE id NOT IN (SELECT id FROM audit_logs_archive)

UNION ALL

SELECT 
  id,
  company_id,
  actor,
  action,
  status,
  integration_system,
  old_value,
  new_value,
  performed_by,
  performed_by_email,
  metadata,
  created_at,
  'archived'::TEXT AS log_source,
  archived_at
FROM audit_logs_archive;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE audit_logs_archive IS
'PHASE-13: Archive table for old audit logs. Stores audit logs that have been moved from the active audit_logs table for retention management.';

COMMENT ON FUNCTION archive_old_audit_logs IS
'PHASE-13: Archives audit logs older than retention_days. Copies records to archive table. Returns count and date range of archived records.';

COMMENT ON FUNCTION cleanup_archived_audit_logs IS
'PHASE-13: Deletes archived audit logs older than final_retention_years. This is the final cleanup step after archival.';

COMMENT ON VIEW audit_logs_unified IS
'PHASE-13: Unified view of active and archived audit logs. Use this view to query all audit logs regardless of archival status.';

-- ============================================================================
-- RLS Policies for Archive Table
-- ============================================================================

ALTER TABLE audit_logs_archive ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role can manage audit_logs_archive"
  ON audit_logs_archive
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read archived logs (for admin dashboard)
CREATE POLICY "Authenticated users can read audit_logs_archive"
  ON audit_logs_archive
  FOR SELECT
  TO authenticated
  USING (true);
