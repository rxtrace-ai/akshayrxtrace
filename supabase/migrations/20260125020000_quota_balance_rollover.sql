-- =====================================================
-- QUOTA BALANCE & ROLLOVER MIGRATION
-- Adds quota balance tracking and rollover support for yearly plans
-- =====================================================

-- 1. Add quota balance columns to companies table
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS unit_quota_balance INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sscc_quota_balance INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_quota_rollover_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS add_on_unit_balance INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS add_on_sscc_balance INTEGER DEFAULT 0;

-- 2. Add consolidated SSCC quota to billing_usage table
ALTER TABLE billing_usage
  ADD COLUMN IF NOT EXISTS sscc_labels_quota INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sscc_labels_used INTEGER DEFAULT 0;

-- 3. Add sscc_level and parent_sscc to SSCC tables (if not exists)
ALTER TABLE boxes
  ADD COLUMN IF NOT EXISTS sscc_level TEXT CHECK (sscc_level IN ('box', 'carton', 'pallet')),
  ADD COLUMN IF NOT EXISTS parent_sscc TEXT;

ALTER TABLE cartons
  ADD COLUMN IF NOT EXISTS sscc_level TEXT CHECK (sscc_level IN ('box', 'carton', 'pallet')),
  ADD COLUMN IF NOT EXISTS parent_sscc TEXT;

ALTER TABLE pallets
  ADD COLUMN IF NOT EXISTS sscc_level TEXT CHECK (sscc_level IN ('box', 'carton', 'pallet')),
  ADD COLUMN IF NOT EXISTS parent_sscc TEXT;

-- 4. Create function to apply quota rollover for yearly plans
CREATE OR REPLACE FUNCTION public.apply_quota_rollover(
  p_company_id UUID,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(
  ok BOOLEAN,
  unit_balance INTEGER,
  sscc_balance INTEGER,
  months_elapsed INTEGER,
  error TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_company RECORD;
  v_plan_type TEXT;
  v_is_yearly BOOLEAN;
  v_last_rollover TIMESTAMPTZ;
  v_months_elapsed INTEGER;
  v_unit_quota_per_month INTEGER;
  v_sscc_quota_per_month INTEGER;
  v_new_unit_balance INTEGER;
  v_new_sscc_balance INTEGER;
BEGIN
  -- Get company and plan info
  SELECT 
    c.unit_quota_balance,
    c.sscc_quota_balance,
    c.last_quota_rollover_at,
    c.subscription_plan,
    bu.unit_labels_quota,
    bu.sscc_labels_quota
  INTO v_company
  FROM companies c
  LEFT JOIN LATERAL (
    SELECT unit_labels_quota, sscc_labels_quota
    FROM billing_usage
    WHERE company_id = c.id
      AND billing_period_start <= p_now
      AND billing_period_end > p_now
    ORDER BY billing_period_start DESC
    LIMIT 1
  ) bu ON true
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Company not found'::TEXT;
    RETURN;
  END IF;

  -- Check if plan is yearly
  v_plan_type := COALESCE(v_company.subscription_plan, '');
  v_is_yearly := v_plan_type ILIKE '%annual%' OR v_plan_type ILIKE '%yearly%' OR v_plan_type ILIKE '%year%';

  -- If not yearly, no rollover needed
  IF NOT v_is_yearly THEN
    RETURN QUERY SELECT 
      true,
      COALESCE(v_company.unit_quota_balance, 0),
      COALESCE(v_company.sscc_quota_balance, 0),
      0,
      NULL::TEXT;
    RETURN;
  END IF;

  -- Calculate months elapsed since last rollover
  v_last_rollover := COALESCE(v_company.last_quota_rollover_at, p_now);
  
  -- Calculate months between last rollover and now
  v_months_elapsed := EXTRACT(EPOCH FROM (DATE_TRUNC('month', p_now) - DATE_TRUNC('month', v_last_rollover))) / 2592000;
  v_months_elapsed := GREATEST(0, FLOOR(v_months_elapsed));

  -- If no months elapsed, return current balance
  IF v_months_elapsed = 0 THEN
    RETURN QUERY SELECT 
      true,
      COALESCE(v_company.unit_quota_balance, 0),
      COALESCE(v_company.sscc_quota_balance, 0),
      0,
      NULL::TEXT;
    RETURN;
  END IF;

  -- Get monthly quota from billing_usage or use defaults
  v_unit_quota_per_month := COALESCE(v_company.unit_labels_quota, 0);
  v_sscc_quota_per_month := COALESCE(v_company.sscc_labels_quota, 0);

  -- Calculate new balances (accumulate unused quota)
  v_new_unit_balance := COALESCE(v_company.unit_quota_balance, 0) + (v_unit_quota_per_month * v_months_elapsed);
  v_new_sscc_balance := COALESCE(v_company.sscc_quota_balance, 0) + (v_sscc_quota_per_month * v_months_elapsed);

  -- Update company with new balances and rollover timestamp
  UPDATE companies
  SET
    unit_quota_balance = v_new_unit_balance,
    sscc_quota_balance = v_new_sscc_balance,
    last_quota_rollover_at = DATE_TRUNC('month', p_now)
  WHERE id = p_company_id;

  RETURN QUERY SELECT 
    true,
    v_new_unit_balance,
    v_new_sscc_balance,
    v_months_elapsed,
    NULL::TEXT;
END;
$$;

-- 5. Create function to consume quota from balance
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
  v_company RECORD;
  v_current_unit_balance INTEGER;
  v_current_sscc_balance INTEGER;
  v_current_unit_addon INTEGER;
  v_current_sscc_addon INTEGER;
  v_remaining_qty INTEGER;
  v_deducted_from_balance INTEGER;
  v_deducted_from_addon INTEGER;
BEGIN
  -- Validate kind
  IF p_kind NOT IN ('unit', 'sscc') THEN
    RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Invalid kind. Must be unit or sscc'::TEXT;
    RETURN;
  END IF;

  -- Apply rollover first
  PERFORM apply_quota_rollover(p_company_id, p_now);

  -- Get current balances
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
    RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Company not found'::TEXT;
    RETURN;
  END IF;

  v_current_unit_balance := COALESCE(v_company.unit_quota_balance, 0);
  v_current_sscc_balance := COALESCE(v_company.sscc_quota_balance, 0);
  v_current_unit_addon := COALESCE(v_company.add_on_unit_balance, 0);
  v_current_sscc_addon := COALESCE(v_company.add_on_sscc_balance, 0);

  -- Check available quota
  IF p_kind = 'unit' THEN
    IF (v_current_unit_balance + v_current_unit_addon) < p_qty THEN
      RETURN QUERY SELECT 
        false,
        v_current_unit_balance,
        v_current_sscc_balance,
        v_current_unit_addon,
        v_current_sscc_addon,
        'Insufficient unit quota balance'::TEXT;
      RETURN;
    END IF;

    -- Deduct from balance first, then addon
    v_remaining_qty := p_qty;
    v_deducted_from_balance := LEAST(v_remaining_qty, v_current_unit_balance);
    v_remaining_qty := v_remaining_qty - v_deducted_from_balance;
    v_deducted_from_addon := v_remaining_qty;

    -- Update balances
    UPDATE companies
    SET
      unit_quota_balance = unit_quota_balance - v_deducted_from_balance,
      add_on_unit_balance = add_on_unit_balance - v_deducted_from_addon
    WHERE id = p_company_id;

    RETURN QUERY SELECT 
      true,
      v_current_unit_balance - v_deducted_from_balance,
      v_current_sscc_balance,
      v_current_unit_addon - v_deducted_from_addon,
      v_current_sscc_addon,
      NULL::TEXT;

  ELSIF p_kind = 'sscc' THEN
    IF (v_current_sscc_balance + v_current_sscc_addon) < p_qty THEN
      RETURN QUERY SELECT 
        false,
        v_current_unit_balance,
        v_current_sscc_balance,
        v_current_unit_addon,
        v_current_sscc_addon,
        'Insufficient SSCC quota balance'::TEXT;
      RETURN;
    END IF;

    -- Deduct from balance first, then addon
    v_remaining_qty := p_qty;
    v_deducted_from_balance := LEAST(v_remaining_qty, v_current_sscc_balance);
    v_remaining_qty := v_remaining_qty - v_deducted_from_balance;
    v_deducted_from_addon := v_remaining_qty;

    -- Update balances
    UPDATE companies
    SET
      sscc_quota_balance = sscc_quota_balance - v_deducted_from_balance,
      add_on_sscc_balance = add_on_sscc_balance - v_deducted_from_addon
    WHERE id = p_company_id;

    RETURN QUERY SELECT 
      true,
      v_current_unit_balance,
      v_current_sscc_balance - v_deducted_from_balance,
      v_current_unit_addon,
      v_current_sscc_addon - v_deducted_from_addon,
      NULL::TEXT;
  END IF;
END;
$$;

-- 6. Create function to refund quota to balance
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

  -- Refund to addon balance first (if it was consumed from there), otherwise to base balance
  IF p_kind = 'unit' THEN
    UPDATE companies
    SET add_on_unit_balance = add_on_unit_balance + p_qty
    WHERE id = p_company_id;
  ELSIF p_kind = 'sscc' THEN
    UPDATE companies
    SET add_on_sscc_balance = add_on_sscc_balance + p_qty
    WHERE id = p_company_id;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

-- 7. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_companies_quota_rollover 
  ON companies(last_quota_rollover_at) 
  WHERE last_quota_rollover_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_boxes_sscc_level 
  ON boxes(sscc_level) 
  WHERE sscc_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cartons_sscc_level 
  ON cartons(sscc_level) 
  WHERE sscc_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pallets_sscc_level 
  ON pallets(sscc_level) 
  WHERE sscc_level IS NOT NULL;
