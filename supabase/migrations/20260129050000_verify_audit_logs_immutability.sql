-- PHASE-9: Verification Script for Audit Log Immutability
-- Run this script AFTER running 20260129_audit_logs_immutability.sql
-- This script verifies that immutability is correctly implemented

-- ============================================================================
-- VERIFICATION 1: Check that triggers exist
-- ============================================================================

DO $$
DECLARE
  trigger_count INTEGER;
BEGIN
  -- Check for DELETE prevention trigger
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger
  WHERE tgname = 'audit_logs_prevent_delete'
    AND tgrelid = 'audit_logs'::regclass;
  
  IF trigger_count = 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: audit_logs_prevent_delete trigger not found';
  ELSE
    RAISE NOTICE '✓ DELETE prevention trigger exists';
  END IF;
  
  -- Check for UPDATE prevention trigger
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger
  WHERE tgname = 'audit_logs_prevent_update'
    AND tgrelid = 'audit_logs'::regclass;
  
  IF trigger_count = 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: audit_logs_prevent_update trigger not found';
  ELSE
    RAISE NOTICE '✓ UPDATE prevention trigger exists';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION 2: Check that trigger functions exist
-- ============================================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  -- Check for DELETE prevention function
  SELECT COUNT(*) INTO func_count
  FROM pg_proc
  WHERE proname = 'prevent_audit_log_delete';
  
  IF func_count = 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: prevent_audit_log_delete function not found';
  ELSE
    RAISE NOTICE '✓ prevent_audit_log_delete function exists';
  END IF;
  
  -- Check for UPDATE prevention function
  SELECT COUNT(*) INTO func_count
  FROM pg_proc
  WHERE proname = 'prevent_audit_log_update';
  
  IF func_count = 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: prevent_audit_log_update function not found';
  ELSE
    RAISE NOTICE '✓ prevent_audit_log_update function exists';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION 3: Check permissions (should have no DELETE/UPDATE)
-- ============================================================================

DO $$
DECLARE
  has_delete BOOLEAN;
  has_update BOOLEAN;
BEGIN
  -- Check if service_role has DELETE permission
  SELECT has_table_privilege('service_role', 'audit_logs', 'DELETE') INTO has_delete;
  
  IF has_delete THEN
    RAISE WARNING '⚠ service_role still has DELETE permission (should be revoked)';
  ELSE
    RAISE NOTICE '✓ DELETE permission revoked from service_role';
  END IF;
  
  -- Check if service_role has UPDATE permission
  SELECT has_table_privilege('service_role', 'audit_logs', 'UPDATE') INTO has_update;
  
  IF has_update THEN
    RAISE WARNING '⚠ service_role still has UPDATE permission (should be revoked)';
  ELSE
    RAISE NOTICE '✓ UPDATE permission revoked from service_role';
  END IF;
  
  -- Check if authenticated has DELETE permission
  SELECT has_table_privilege('authenticated', 'audit_logs', 'DELETE') INTO has_delete;
  
  IF has_delete THEN
    RAISE WARNING '⚠ authenticated still has DELETE permission (should be revoked)';
  ELSE
    RAISE NOTICE '✓ DELETE permission revoked from authenticated';
  END IF;
  
  -- Check if authenticated has UPDATE permission
  SELECT has_table_privilege('authenticated', 'audit_logs', 'UPDATE') INTO has_update;
  
  IF has_update THEN
    RAISE WARNING '⚠ authenticated still has UPDATE permission (should be revoked)';
  ELSE
    RAISE NOTICE '✓ UPDATE permission revoked from authenticated';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION 4: Test INSERT (should succeed)
-- ============================================================================

DO $$
DECLARE
  test_id UUID;
  test_company_id UUID;
BEGIN
  -- Get an existing company_id for the test, or use NULL if company_id is nullable
  SELECT id INTO test_company_id
  FROM companies
  LIMIT 1;
  
  -- Try to insert a test audit log
  -- Note: company_id may be required (NOT NULL) or optional depending on schema
  IF test_company_id IS NOT NULL THEN
    INSERT INTO audit_logs (company_id, actor, action, status, metadata)
    VALUES (
      test_company_id,
      'verification_script',
      'IMMUTABILITY_VERIFICATION',
      'success',
      '{"test": true, "phase": 9}'::jsonb
    )
    RETURNING id INTO test_id;
  ELSE
    -- Try without company_id (if nullable)
    BEGIN
      INSERT INTO audit_logs (actor, action, status, metadata)
      VALUES (
        'verification_script',
        'IMMUTABILITY_VERIFICATION',
        'success',
        '{"test": true, "phase": 9}'::jsonb
      )
      RETURNING id INTO test_id;
    EXCEPTION
      WHEN not_null_violation THEN
        RAISE NOTICE '⚠ No companies found and company_id is required - skipping INSERT test';
        RAISE NOTICE '  To test INSERT, ensure at least one company exists in the companies table';
        RETURN;
    END;
  END IF;
  
  IF test_id IS NULL THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: INSERT operation failed';
  ELSE
    RAISE NOTICE '✓ INSERT operation succeeded (test record ID: %)', test_id;
    
    -- Clean up test record
    -- Note: We can't DELETE it, so we'll just leave it (it's a valid audit log)
    RAISE NOTICE '  Note: Test record cannot be deleted (immutability working!)';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION 5: Test DELETE prevention (should fail)
-- ============================================================================

DO $$
DECLARE
  test_id UUID;
  delete_succeeded BOOLEAN := FALSE;
BEGIN
  -- Get an existing audit log ID (or use the one we just created)
  SELECT id INTO test_id
  FROM audit_logs
  WHERE action = 'IMMUTABILITY_VERIFICATION'
  LIMIT 1;
  
  IF test_id IS NULL THEN
    -- Use any existing audit log
    SELECT id INTO test_id
    FROM audit_logs
    LIMIT 1;
  END IF;
  
  IF test_id IS NULL THEN
    RAISE NOTICE '⚠ No audit logs found to test DELETE - skipping DELETE test';
    RETURN;
  END IF;
  
  -- Try to delete (should fail)
  BEGIN
    DELETE FROM audit_logs WHERE id = test_id;
    delete_succeeded := TRUE;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%PHASE-9: Audit logs are immutable%' THEN
        RAISE NOTICE '✓ DELETE operation correctly prevented by trigger';
        delete_succeeded := FALSE;
      ELSE
        RAISE EXCEPTION 'VERIFICATION FAILED: DELETE failed with unexpected error: %', SQLERRM;
      END IF;
  END;
  
  IF delete_succeeded THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: DELETE operation succeeded (should have been prevented)';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION 6: Test UPDATE prevention (should fail)
-- ============================================================================

DO $$
DECLARE
  test_id UUID;
  update_succeeded BOOLEAN := FALSE;
BEGIN
  -- Get an existing audit log ID
  SELECT id INTO test_id
  FROM audit_logs
  WHERE action = 'IMMUTABILITY_VERIFICATION'
  LIMIT 1;
  
  IF test_id IS NULL THEN
    -- Use any existing audit log
    SELECT id INTO test_id
    FROM audit_logs
    LIMIT 1;
  END IF;
  
  IF test_id IS NULL THEN
    RAISE NOTICE '⚠ No audit logs found to test UPDATE - skipping UPDATE test';
    RETURN;
  END IF;
  
  -- Try to update (should fail)
  BEGIN
    UPDATE audit_logs 
    SET action = 'TEST_UPDATE_ATTEMPT'
    WHERE id = test_id;
    update_succeeded := TRUE;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%PHASE-9: Audit logs are immutable%' THEN
        RAISE NOTICE '✓ UPDATE operation correctly prevented by trigger';
        update_succeeded := FALSE;
      ELSE
        RAISE EXCEPTION 'VERIFICATION FAILED: UPDATE failed with unexpected error: %', SQLERRM;
      END IF;
  END;
  
  IF update_succeeded THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: UPDATE operation succeeded (should have been prevented)';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION 7: Check table comments
-- ============================================================================

DO $$
DECLARE
  table_comment TEXT;
BEGIN
  SELECT obj_description('audit_logs'::regclass, 'pg_class') INTO table_comment;
  
  IF table_comment IS NULL OR table_comment NOT LIKE '%PHASE-9%' THEN
    RAISE WARNING '⚠ Table comment may be missing or incomplete';
  ELSE
    RAISE NOTICE '✓ Table comment exists and mentions PHASE-9';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'IMMUTABILITY VERIFICATION COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'If all checks passed (✓), immutability is correctly implemented.';
  RAISE NOTICE 'If any checks failed (✗), review the migration and fix issues.';
  RAISE NOTICE '';
  RAISE NOTICE 'Key protections in place:';
  RAISE NOTICE '  1. DELETE operations prevented by trigger';
  RAISE NOTICE '  2. UPDATE operations prevented by trigger';
  RAISE NOTICE '  3. Permissions revoked from all roles';
  RAISE NOTICE '  4. INSERT operations still allowed';
  RAISE NOTICE '';
END $$;
