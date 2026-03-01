-- =====================================================
-- ATOMIC UNIT LABEL GENERATION WITH QUOTA CONSUMPTION
-- Ensures quota consumption and label insertion happen atomically
-- =====================================================

-- Create function to atomically consume quota and insert unit labels
-- This function ensures quota is ONLY consumed when labels are successfully created
CREATE OR REPLACE FUNCTION public.consume_quota_and_insert_unit_labels(
  p_company_id UUID,
  p_qty INTEGER,
  p_unit_rows JSONB,
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
  v_company RECORD;
  v_current_unit_balance INTEGER;
  v_current_sscc_balance INTEGER;
  v_current_unit_addon INTEGER;
  v_current_sscc_addon INTEGER;
  v_remaining_qty INTEGER;
  v_deducted_from_balance INTEGER;
  v_deducted_from_addon INTEGER;
  v_row JSONB;
  v_inserted_ids UUID[];
  v_inserted_id UUID;
BEGIN
  -- Validate inputs
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN QUERY SELECT false, 'Quantity must be a positive integer'::TEXT, ARRAY[]::UUID[];
    RETURN;
  END IF;

  IF p_unit_rows IS NULL OR jsonb_array_length(p_unit_rows) != p_qty THEN
    RETURN QUERY SELECT false, 'Unit rows count must match quantity'::TEXT, ARRAY[]::UUID[];
    RETURN;
  END IF;

  -- Apply rollover first (to get latest balance)
  PERFORM apply_quota_rollover(p_company_id, p_now);

  -- Lock company row and get current balances (FOR UPDATE ensures atomicity)
  SELECT 
    unit_quota_balance,
    sscc_quota_balance,
    add_on_unit_balance,
    add_on_sscc_balance
  INTO v_company
  FROM companies
  WHERE id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Company not found'::TEXT, ARRAY[]::UUID[];
    RETURN;
  END IF;

  v_current_unit_balance := COALESCE(v_company.unit_quota_balance, 0);
  v_current_sscc_balance := COALESCE(v_company.sscc_quota_balance, 0);
  v_current_unit_addon := COALESCE(v_company.add_on_unit_balance, 0);
  v_current_sscc_addon := COALESCE(v_company.add_on_sscc_balance, 0);

  -- Check if sufficient quota is available
  IF (v_current_unit_balance + v_current_unit_addon) < p_qty THEN
    RETURN QUERY SELECT 
      false,
      'Insufficient unit quota balance'::TEXT,
      ARRAY[]::UUID[];
    RETURN;
  END IF;

  -- Calculate quota deduction (from balance first, then addon)
  v_remaining_qty := p_qty;
  v_deducted_from_balance := LEAST(v_remaining_qty, v_current_unit_balance);
  v_remaining_qty := v_remaining_qty - v_deducted_from_balance;
  v_deducted_from_addon := v_remaining_qty;

  -- Decrement quota FIRST (before inserting labels)
  UPDATE companies
  SET
    unit_quota_balance = unit_quota_balance - v_deducted_from_balance,
    add_on_unit_balance = add_on_unit_balance - v_deducted_from_addon
  WHERE id = p_company_id;

  -- Now insert unit labels (within same transaction)
  -- If this fails, the entire transaction (including quota update) will rollback
  v_inserted_ids := ARRAY[]::UUID[];
  
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_unit_rows)
  LOOP
    INSERT INTO labels_units (
      company_id,
      sku_id,
      gtin,
      batch,
      mfd,
      expiry,
      mrp,
      serial,
      gs1_payload,
      created_at
    )
    VALUES (
      (v_row->>'company_id')::UUID,
      NULLIF(v_row->>'sku_id', 'null')::UUID,
      v_row->>'gtin',
      v_row->>'batch',
      v_row->>'mfd',
      v_row->>'expiry',
      NULLIF(v_row->>'mrp', 'null')::DECIMAL(10,2),
      v_row->>'serial',
      v_row->>'gs1_payload',
      COALESCE((v_row->>'created_at')::TIMESTAMPTZ, p_now)
    )
    RETURNING id INTO v_inserted_id;
    
    v_inserted_ids := array_append(v_inserted_ids, v_inserted_id);
  END LOOP;

  -- Success: return inserted IDs
  RETURN QUERY SELECT 
    true,
    NULL::TEXT,
    v_inserted_ids;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.consume_quota_and_insert_unit_labels TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_quota_and_insert_unit_labels TO anon;
