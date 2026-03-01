-- PHASE-9: Audit Log Immutability
-- This migration implements database-level immutability for audit_logs table
-- to ensure audit logs cannot be deleted or modified once created.

-- ============================================================================
-- STEP 1: Revoke DELETE and UPDATE permissions from all roles
-- ============================================================================

-- Revoke DELETE permission from all roles
REVOKE DELETE ON audit_logs FROM PUBLIC;
REVOKE DELETE ON audit_logs FROM authenticated;
REVOKE DELETE ON audit_logs FROM anon;
REVOKE DELETE ON audit_logs FROM service_role;

-- Revoke UPDATE permission from all roles
REVOKE UPDATE ON audit_logs FROM PUBLIC;
REVOKE UPDATE ON audit_logs FROM authenticated;
REVOKE UPDATE ON audit_logs FROM anon;
REVOKE UPDATE ON audit_logs FROM service_role;

-- Note: INSERT permission is kept for service_role and system operations
-- SELECT permission is kept for authorized users via RLS policies

-- ============================================================================
-- STEP 2: Create trigger function to prevent DELETE operations
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_audit_log_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PHASE-9: Audit logs are immutable. DELETE operations are not allowed on audit_logs table.';
END;
$$ LANGUAGE plpgsql;

-- Create trigger to prevent DELETE
DROP TRIGGER IF EXISTS audit_logs_prevent_delete ON audit_logs;
CREATE TRIGGER audit_logs_prevent_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_delete();

-- ============================================================================
-- STEP 3: Create trigger function to prevent UPDATE operations
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PHASE-9: Audit logs are immutable. UPDATE operations are not allowed on audit_logs table.';
END;
$$ LANGUAGE plpgsql;

-- Create trigger to prevent UPDATE
DROP TRIGGER IF EXISTS audit_logs_prevent_update ON audit_logs;
CREATE TRIGGER audit_logs_prevent_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_update();

-- ============================================================================
-- STEP 4: Add table comment documenting immutability
-- ============================================================================

COMMENT ON TABLE audit_logs IS 
'PHASE-9: Immutable audit log table. All entries are write-once, read-many. 
DELETE and UPDATE operations are prevented at the database level via triggers and revoked permissions.
This ensures a tamper-proof audit trail for compliance and security purposes.';

COMMENT ON FUNCTION prevent_audit_log_delete() IS 
'PHASE-9: Trigger function that prevents DELETE operations on audit_logs table. 
Raises an exception if DELETE is attempted.';

COMMENT ON FUNCTION prevent_audit_log_update() IS 
'PHASE-9: Trigger function that prevents UPDATE operations on audit_logs table. 
Raises an exception if UPDATE is attempted.';

-- ============================================================================
-- STEP 5: Verify immutability (commented out - run manually for testing)
-- ============================================================================

-- Test DELETE prevention (should fail):
-- DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs LIMIT 1);
-- Expected: ERROR: PHASE-9: Audit logs are immutable. DELETE operations are not allowed on audit_logs table.

-- Test UPDATE prevention (should fail):
-- UPDATE audit_logs SET action = 'TEST' WHERE id = (SELECT id FROM audit_logs LIMIT 1);
-- Expected: ERROR: PHASE-9: Audit logs are immutable. UPDATE operations are not allowed on audit_logs table.

-- Test INSERT (should succeed):
-- INSERT INTO audit_logs (actor, action, status) VALUES ('test', 'TEST_ACTION', 'success');
-- Expected: Success (1 row inserted)
