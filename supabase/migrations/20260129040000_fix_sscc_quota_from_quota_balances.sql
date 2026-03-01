-- =====================================================
-- FIX SSCC QUOTA TO USE quota_balances TABLE
-- SSCC quota must be read ONLY from quota_balances (kind = 'sscc')
-- =====================================================

-- 1. Create quota_balances table if it doesn't exist
CREATE TABLE IF NOT EXISTS quota_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('unit', 'sscc')),
  base_quota INTEGER NOT NULL DEFAULT 0,
  addon_quota INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, kind)
);

COMMENT ON TABLE quota_balances IS 'Quota balances for unit and SSCC generation. SSCC quota must be read only from this table.';

-- 2. Create index for performance
CREATE INDEX IF NOT EXISTS idx_quota_balances_company_kind 
  ON quota_balances(company_id, kind);

-- 3. Initialize quota_balances for existing companies (migrate from companies table if needed)
INSERT INTO quota_balances (company_id, kind, base_quota, addon_quota, used)
SELECT 
  id as company_id,
  'unit' as kind,
  COALESCE(unit_quota_balance, 0) as base_quota,
  COALESCE(add_on_unit_balance, 0) as addon_quota,
  0 as used
FROM companies
WHERE id NOT IN (SELECT company_id FROM quota_balances WHERE kind = 'unit')
ON CONFLICT (company_id, kind) DO NOTHING;

INSERT INTO quota_balances (company_id, kind, base_quota, addon_quota, used)
SELECT 
  id as company_id,
  'sscc' as kind,
  COALESCE(sscc_quota_balance, 0) as base_quota,
  COALESCE(add_on_sscc_balance, 0) as addon_quota,
  0 as used
FROM companies
WHERE id NOT IN (SELECT company_id FROM quota_balances WHERE kind = 'sscc')
ON CONFLICT (company_id, kind) DO NOTHING;

-- 3a. Create function to ensure quota_balances exists for a company
-- This function initializes quota_balances from billing_usage or plan defaults
CREATE OR REPLACE FUNCTION public.ensure_quota_balances(
  p_company_id UUID,
  p_plan_type TEXT DEFAULT 'starter'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_unit_quota INTEGER;
  v_sscc_quota INTEGER;
  v_billing_usage RECORD;
BEGIN
  -- Get quotas from active billing_usage or use plan defaults
  SELECT 
    COALESCE(unit_labels_quota, 0),
    COALESCE(sscc_labels_quota, COALESCE(pallet_labels_quota, 0) + COALESCE(carton_labels_quota, 0) + COALESCE(box_labels_quota, 0), 0)
  INTO v_billing_usage
  FROM billing_usage
  WHERE company_id = p_company_id
    AND billing_period_start <= NOW()
    AND billing_period_end > NOW()
  ORDER BY billing_period_start DESC
  LIMIT 1;

  IF FOUND THEN
    v_unit_quota := COALESCE(v_billing_usage.unit_labels_quota, 0);
    -- SSCC quota = sscc_labels_quota if exists, otherwise pallet_labels_quota (primary SSCC level)
    v_sscc_quota := COALESCE(v_billing_usage.sscc_labels_quota, v_billing_usage.pallet_labels_quota, 0);
  ELSE
    -- Use plan defaults (Starter plan: 200K units, 500 SSCC)
    v_unit_quota := CASE 
      WHEN p_plan_type = 'starter' THEN 200000
      WHEN p_plan_type = 'growth' THEN 1000000
      WHEN p_plan_type = 'enterprise' THEN 10000000
      ELSE 200000
    END;
    v_sscc_quota := CASE 
      WHEN p_plan_type = 'starter' THEN 500
      WHEN p_plan_type = 'growth' THEN 2000
      WHEN p_plan_type = 'enterprise' THEN 10000
      ELSE 500
    END;
  END IF;

  -- Insert or update unit quota_balance
  INSERT INTO quota_balances (company_id, kind, base_quota, addon_quota, used)
  VALUES (p_company_id, 'unit', v_unit_quota, 0, 0)
  ON CONFLICT (company_id, kind) DO UPDATE
  SET base_quota = GREATEST(quota_balances.base_quota, v_unit_quota);

  -- Insert or update SSCC quota_balance
  INSERT INTO quota_balances (company_id, kind, base_quota, addon_quota, used)
  VALUES (p_company_id, 'sscc', v_sscc_quota, 0, 0)
  ON CONFLICT (company_id, kind) DO UPDATE
  SET base_quota = GREATEST(quota_balances.base_quota, v_sscc_quota);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_quota_balances TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_quota_balances TO anon;

-- 4. Create atomic RPC function for SSCC quota consumption and label insertion
-- This ensures quota is ONLY consumed when SSCC labels are successfully created
CREATE OR REPLACE FUNCTION public.consume_quota_and_insert_sscc_labels(
  p_company_id UUID,
  p_qty INTEGER,
  p_sscc_rows JSONB,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(
  ok BOOLEAN,
  error TEXT,
  inserted_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quota_balance RECORD;
  v_current_base_quota INTEGER;
  v_current_addon_quota INTEGER;
  v_current_used INTEGER;
  v_row JSONB;
  v_inserted_ids UUID[];
  v_inserted_id UUID;
  v_table_name TEXT;
  v_sscc_level TEXT;
BEGIN
  -- Validate inputs
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN QUERY SELECT false, 'Quantity must be a positive integer'::TEXT, ARRAY[]::UUID[];
    RETURN;
  END IF;

  IF p_sscc_rows IS NULL OR jsonb_array_length(p_sscc_rows) != p_qty THEN
    RETURN QUERY SELECT false, 'SSCC rows count must match quantity'::TEXT, ARRAY[]::UUID[];
    RETURN;
  END IF;

  -- Lock quota_balances row for SSCC (FOR UPDATE ensures atomicity)
  SELECT 
    base_quota,
    addon_quota,
    used
  INTO v_quota_balance
  FROM quota_balances
  WHERE company_id = p_company_id
    AND kind = 'sscc'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SSCC quota not initialized for company'::TEXT, ARRAY[]::UUID[];
    RETURN;
  END IF;

  v_current_base_quota := COALESCE(v_quota_balance.base_quota, 0);
  v_current_addon_quota := COALESCE(v_quota_balance.addon_quota, 0);
  v_current_used := COALESCE(v_quota_balance.used, 0);

  -- Check if sufficient quota is available
  -- Remaining quota = base_quota + addon_quota - used
  -- Block generation only if remaining <= 0
  IF (v_current_base_quota + v_current_addon_quota - v_current_used) <= 0 THEN
    RETURN QUERY SELECT 
      false,
      'Insufficient SSCC quota balance'::TEXT,
      ARRAY[]::UUID[];
    RETURN;
  END IF;

  -- Check if requested quantity exceeds remaining quota
  IF (v_current_base_quota + v_current_addon_quota - v_current_used) < p_qty THEN
    RETURN QUERY SELECT 
      false,
      'Insufficient SSCC quota balance'::TEXT,
      ARRAY[]::UUID[];
    RETURN;
  END IF;

  -- Increment used quota FIRST (before inserting labels)
  -- If label insertion fails, transaction will rollback and used will revert
  UPDATE quota_balances
  SET
    used = used + p_qty,
    updated_at = p_now
  WHERE company_id = p_company_id
    AND kind = 'sscc';

  -- Now insert SSCC labels (within same transaction)
  -- If this fails, the entire transaction (including quota update) will rollback
  v_inserted_ids := ARRAY[]::UUID[];
  
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_sscc_rows)
  LOOP
    -- Determine target table based on sscc_level
    v_sscc_level := v_row->>'sscc_level';
    v_table_name := CASE 
      WHEN v_sscc_level = 'box' THEN 'boxes'
      WHEN v_sscc_level = 'carton' THEN 'cartons'
      WHEN v_sscc_level = 'pallet' THEN 'pallets'
      ELSE 'pallets' -- Default to pallets
    END;

    -- Insert into appropriate table
    IF v_table_name = 'boxes' THEN
      INSERT INTO boxes (
        company_id,
        sku_id,
        sscc,
        sscc_with_ai,
        sscc_level,
        parent_sscc,
        meta,
        created_at
      )
      VALUES (
        (v_row->>'company_id')::UUID,
        NULLIF(v_row->>'sku_id', 'null')::UUID,
        v_row->>'sscc',
        v_row->>'sscc_with_ai',
        v_row->>'sscc_level',
        NULLIF(v_row->>'parent_sscc', 'null')::TEXT,
        (v_row->>'meta')::JSONB,
        COALESCE((v_row->>'created_at')::TIMESTAMPTZ, p_now)
      )
      RETURNING id INTO v_inserted_id;
    ELSIF v_table_name = 'cartons' THEN
      INSERT INTO cartons (
        company_id,
        sku_id,
        sscc,
        sscc_with_ai,
        sscc_level,
        parent_sscc,
        meta,
        created_at
      )
      VALUES (
        (v_row->>'company_id')::UUID,
        NULLIF(v_row->>'sku_id', 'null')::UUID,
        v_row->>'sscc',
        v_row->>'sscc_with_ai',
        v_row->>'sscc_level',
        NULLIF(v_row->>'parent_sscc', 'null')::TEXT,
        (v_row->>'meta')::JSONB,
        COALESCE((v_row->>'created_at')::TIMESTAMPTZ, p_now)
      )
      RETURNING id INTO v_inserted_id;
    ELSE -- pallets
      INSERT INTO pallets (
        company_id,
        sku_id,
        sscc,
        sscc_with_ai,
        sscc_level,
        parent_sscc,
        meta,
        created_at
      )
      VALUES (
        (v_row->>'company_id')::UUID,
        NULLIF(v_row->>'sku_id', 'null')::UUID,
        v_row->>'sscc',
        v_row->>'sscc_with_ai',
        v_row->>'sscc_level',
        NULLIF(v_row->>'parent_sscc', 'null')::TEXT,
        (v_row->>'meta')::JSONB,
        COALESCE((v_row->>'created_at')::TIMESTAMPTZ, p_now)
      )
      RETURNING id INTO v_inserted_id;
    END IF;
    
    v_inserted_ids := array_append(v_inserted_ids, v_inserted_id);
  END LOOP;

  -- Success: return inserted IDs
  RETURN QUERY SELECT 
    true,
    NULL::TEXT,
    v_inserted_ids;
EXCEPTION
  WHEN OTHERS THEN
    -- Rollback quota on any error
    UPDATE quota_balances
    SET used = used - p_qty
    WHERE company_id = p_company_id
      AND kind = 'sscc';
    
    RETURN QUERY SELECT 
      false,
      SQLERRM::TEXT,
      ARRAY[]::UUID[];
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.consume_quota_and_insert_sscc_labels TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_quota_and_insert_sscc_labels TO anon;

-- 5. Update consume_quota_balance RPC to read SSCC quota from quota_balances table
CREATE OR REPLACE FUNCTION public.consume_quota_balance(
  p_company_id UUID,
  p_kind TEXT, -- 'unit' or 'sscc'
  p_qty INTEGER,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(
  ok BOOLEAN,
  unit_balance INTEGER,
  sscc_balance INTEGER,
  unit_addon_balance INTEGER,
  sscc_addon_balance INTEGER,
  error TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_quota_balance RECORD;
  v_current_base_quota INTEGER;
  v_current_addon_quota INTEGER;
  v_current_used INTEGER;
  v_remaining INTEGER;
  v_unit_balance INTEGER;
  v_sscc_balance INTEGER;
  v_unit_addon INTEGER;
  v_sscc_addon INTEGER;
BEGIN
  -- Validate kind
  IF p_kind NOT IN ('unit', 'sscc') THEN
    RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Invalid kind. Must be unit or sscc'::TEXT;
    RETURN;
  END IF;

  -- For SSCC, read from quota_balances table
  IF p_kind = 'sscc' THEN
    -- Lock quota_balances row for SSCC
    SELECT 
      base_quota,
      addon_quota,
      used
    INTO v_quota_balance
    FROM quota_balances
    WHERE company_id = p_company_id
      AND kind = 'sscc'
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'SSCC quota not initialized for company'::TEXT;
      RETURN;
    END IF;

    v_current_base_quota := COALESCE(v_quota_balance.base_quota, 0);
    v_current_addon_quota := COALESCE(v_quota_balance.addon_quota, 0);
    v_current_used := COALESCE(v_quota_balance.used, 0);

    -- Check available quota: remaining = base_quota + addon_quota - used
    v_remaining := (v_current_base_quota + v_current_addon_quota) - v_current_used;
    
    IF v_remaining < p_qty THEN
      -- Get unit balances for return (read-only, no lock needed)
      SELECT 
        COALESCE(base_quota, 0) - COALESCE(used, 0),
        COALESCE(addon_quota, 0)
      INTO v_unit_balance, v_unit_addon
      FROM quota_balances
      WHERE company_id = p_company_id
        AND kind = 'unit'
      LIMIT 1;

      RETURN QUERY SELECT 
        false,
        COALESCE(v_unit_balance, 0),
        v_remaining,
        COALESCE(v_unit_addon, 0),
        v_current_addon_quota,
        'Insufficient SSCC quota balance'::TEXT;
      RETURN;
    END IF;

    -- Update quota_balances: increment used
    UPDATE quota_balances
    SET
      used = used + p_qty,
      updated_at = p_now
    WHERE company_id = p_company_id
      AND kind = 'sscc';

    -- Get unit balances for return (read-only)
    SELECT 
      COALESCE(base_quota, 0) - COALESCE(used, 0),
      COALESCE(addon_quota, 0)
    INTO v_unit_balance, v_unit_addon
    FROM quota_balances
    WHERE company_id = p_company_id
      AND kind = 'unit'
    LIMIT 1;

    -- Calculate new SSCC remaining after consumption
    v_sscc_balance := (v_current_base_quota + v_current_addon_quota) - (v_current_used + p_qty);

    RETURN QUERY SELECT 
      true,
      COALESCE(v_unit_balance, 0),
      v_sscc_balance,
      COALESCE(v_unit_addon, 0),
      v_current_addon_quota,
      NULL::TEXT;

  ELSE
    -- For unit, keep existing logic (read from companies table for now)
    -- This maintains backward compatibility
    PERFORM apply_quota_rollover(p_company_id, p_now);

    SELECT 
      unit_quota_balance,
      sscc_quota_balance,
      add_on_unit_balance,
      add_on_sscc_balance
    INTO v_quota_balance
    FROM companies
    WHERE id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Company not found'::TEXT;
      RETURN;
    END IF;

    v_current_base_quota := COALESCE(v_quota_balance.unit_quota_balance, 0);
    v_current_addon_quota := COALESCE(v_quota_balance.add_on_unit_balance, 0);

    IF (v_current_base_quota + v_current_addon_quota) < p_qty THEN
      -- Get SSCC balance from quota_balances
      SELECT 
        COALESCE(base_quota, 0) - COALESCE(used, 0),
        COALESCE(addon_quota, 0)
      INTO v_sscc_balance, v_sscc_addon
      FROM quota_balances
      WHERE company_id = p_company_id
        AND kind = 'sscc'
      LIMIT 1;

      RETURN QUERY SELECT 
        false,
        v_current_base_quota,
        COALESCE(v_sscc_balance, 0),
        v_current_addon_quota,
        COALESCE(v_sscc_addon, 0),
        'Insufficient unit quota balance'::TEXT;
      RETURN;
    END IF;

    UPDATE companies
    SET
      unit_quota_balance = unit_quota_balance - LEAST(p_qty, v_current_base_quota),
      add_on_unit_balance = add_on_unit_balance - GREATEST(0, p_qty - v_current_base_quota)
    WHERE id = p_company_id;

    -- Get SSCC balance from quota_balances
    SELECT 
      COALESCE(base_quota, 0) - COALESCE(used, 0),
      COALESCE(addon_quota, 0)
    INTO v_sscc_balance, v_sscc_addon
    FROM quota_balances
    WHERE company_id = p_company_id
      AND kind = 'sscc'
    LIMIT 1;

    RETURN QUERY SELECT 
      true,
      v_current_base_quota - LEAST(p_qty, v_current_base_quota),
      COALESCE(v_sscc_balance, 0),
      v_current_addon_quota - GREATEST(0, p_qty - v_current_base_quota),
      COALESCE(v_sscc_addon, 0),
      NULL::TEXT;
  END IF;
END;
$$;

-- 6. Update refund_quota_balance to handle SSCC from quota_balances
CREATE OR REPLACE FUNCTION public.refund_quota_balance(
  p_company_id UUID,
  p_kind TEXT, -- 'unit' or 'sscc'
  p_qty INTEGER
)
RETURNS TABLE(
  ok BOOLEAN,
  error TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate kind
  IF p_kind NOT IN ('unit', 'sscc') THEN
    RETURN QUERY SELECT false, 'Invalid kind. Must be unit or sscc'::TEXT;
    RETURN;
  END IF;

  -- For SSCC, refund from quota_balances table
  IF p_kind = 'sscc' THEN
    UPDATE quota_balances
    SET
      used = GREATEST(0, used - p_qty),
      updated_at = NOW()
    WHERE company_id = p_company_id
      AND kind = 'sscc';

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'SSCC quota not initialized for company'::TEXT;
      RETURN;
    END IF;
  ELSE
    -- For unit, keep existing logic (refund to companies table)
    UPDATE companies
    SET add_on_unit_balance = add_on_unit_balance + p_qty
    WHERE id = p_company_id;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

COMMENT ON FUNCTION public.consume_quota_and_insert_sscc_labels IS 'Atomically consumes SSCC quota from quota_balances table and inserts SSCC labels. Quota is only consumed if labels are successfully inserted.';
COMMENT ON FUNCTION public.consume_quota_balance IS 'Consumes quota. For SSCC, reads from quota_balances table. For unit, reads from companies table (backward compatibility).';
COMMENT ON FUNCTION public.refund_quota_balance IS 'Refunds quota. For SSCC, updates quota_balances table. For unit, updates companies table.';
