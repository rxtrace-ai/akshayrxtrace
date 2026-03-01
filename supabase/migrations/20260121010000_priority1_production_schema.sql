-- =====================================================
-- PRIORITY 1: PRODUCTION GO-LIVE BLOCKERS
-- Multi-tenant isolation, GS1 compliance, data integrity
-- =====================================================

-- 1. ENSURE COMPANIES TABLE HAS REQUIRED COLUMNS AND CONSTRAINTS
ALTER TABLE companies 
  ADD COLUMN IF NOT EXISTS contact_person_name TEXT,
  ADD COLUMN IF NOT EXISTS firm_type TEXT CHECK (firm_type IN ('proprietorship', 'partnership', 'llp', 'pvt_ltd', 'ltd')),
  ADD COLUMN IF NOT EXISTS business_category TEXT CHECK (business_category IN ('pharma', 'food', 'dairy', 'logistics')),
  ADD COLUMN IF NOT EXISTS business_type TEXT CHECK (business_type IN ('manufacturer', 'exporter', 'distributor', 'wholesaler')),
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT,
  ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS gst TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Prevent duplicate companies per user
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'companies_user_id_unique'
  ) THEN
    ALTER TABLE companies
    ADD CONSTRAINT companies_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- Prevent duplicate company names (optional but recommended for audit)
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_unique 
ON companies(LOWER(TRIM(company_name)));

-- Company indexes for performance
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);
CREATE INDEX IF NOT EXISTS idx_companies_subscription_status ON companies(subscription_status);
CREATE INDEX IF NOT EXISTS idx_companies_trial_end_date ON companies(trial_end_date);
CREATE INDEX IF NOT EXISTS idx_companies_email ON companies(email);
CREATE INDEX IF NOT EXISTS idx_companies_pan ON companies(pan) WHERE pan IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_gst ON companies(gst) WHERE gst IS NOT NULL;

-- 2. ENSURE LABELS_UNITS TABLE EXISTS WITH GS1 FIELDS
CREATE TABLE IF NOT EXISTS labels_units (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
  box_id UUID REFERENCES boxes(id) ON DELETE SET NULL,
  gtin TEXT NOT NULL,
  batch TEXT NOT NULL,
  mfd TEXT NOT NULL,
  expiry TEXT NOT NULL,
  mrp DECIMAL(10,2),
  serial TEXT NOT NULL,
  gs1_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GS1 Uniqueness: Serial must be unique per company/GTIN/batch
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'labels_units_unique_company_gtin_batch_serial'
  ) THEN
    ALTER TABLE labels_units
    ADD CONSTRAINT labels_units_unique_company_gtin_batch_serial
    UNIQUE (company_id, gtin, batch, serial);
  END IF;
END $$;

-- GTIN uniqueness per company (one GTIN per company for product master)
CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_units_company_gtin_unique
ON labels_units(company_id, gtin);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_labels_units_company_id ON labels_units(company_id);
CREATE INDEX IF NOT EXISTS idx_labels_units_company_serial ON labels_units(company_id, serial);
CREATE INDEX IF NOT EXISTS idx_labels_units_company_gtin_batch ON labels_units(company_id, gtin, batch);
CREATE INDEX IF NOT EXISTS idx_labels_units_sku_id ON labels_units(sku_id);
CREATE INDEX IF NOT EXISTS idx_labels_units_box_id ON labels_units(box_id);
CREATE INDEX IF NOT EXISTS idx_labels_units_created_at ON labels_units(created_at DESC);

-- 3. ENSURE BOXES TABLE EXISTS
CREATE TABLE IF NOT EXISTS boxes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  carton_id UUID REFERENCES cartons(id) ON DELETE SET NULL,
  pallet_id UUID REFERENCES pallets(id) ON DELETE SET NULL,
  sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
  sscc VARCHAR(18) UNIQUE,
  sscc_with_ai TEXT,
  code TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boxes_company_id ON boxes(company_id);
CREATE INDEX IF NOT EXISTS idx_boxes_carton_id ON boxes(carton_id);
CREATE INDEX IF NOT EXISTS idx_boxes_pallet_id ON boxes(pallet_id);
CREATE INDEX IF NOT EXISTS idx_boxes_sscc ON boxes(sscc) WHERE sscc IS NOT NULL;

-- 4. ENSURE CARTONS TABLE EXISTS
CREATE TABLE IF NOT EXISTS cartons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pallet_id UUID REFERENCES pallets(id) ON DELETE SET NULL,
  sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
  sscc VARCHAR(18) UNIQUE,
  sscc_with_ai TEXT,
  code TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cartons_company_id ON cartons(company_id);
CREATE INDEX IF NOT EXISTS idx_cartons_pallet_id ON cartons(pallet_id);
CREATE INDEX IF NOT EXISTS idx_cartons_sscc ON cartons(sscc) WHERE sscc IS NOT NULL;

-- 5. ENSURE PALLETS TABLE EXISTS
CREATE TABLE IF NOT EXISTS pallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
  sscc VARCHAR(18) UNIQUE NOT NULL,
  sscc_with_ai TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pallets_company_id ON pallets(company_id);
CREATE INDEX IF NOT EXISTS idx_pallets_sscc ON pallets(sscc);
CREATE INDEX IF NOT EXISTS idx_pallets_sku_id ON pallets(sku_id);

-- 6. ENSURE SKUS TABLE HAS UNIQUENESS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'skus_company_id_sku_code_key'
  ) THEN
    ALTER TABLE skus
    ADD CONSTRAINT skus_company_id_sku_code_key UNIQUE (company_id, sku_code);
  END IF;
END $$;

-- 7. ENABLE ROW LEVEL SECURITY ON ALL CORE TABLES
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cartons ENABLE ROW LEVEL SECURITY;
ALTER TABLE pallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;

-- 8. RLS POLICIES FOR COMPANIES
DROP POLICY IF EXISTS "Users can view own company" ON companies;
CREATE POLICY "Users can view own company" ON companies
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own company" ON companies;
CREATE POLICY "Users can update own company" ON companies
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access companies" ON companies;
CREATE POLICY "Service role full access companies" ON companies
  FOR ALL
  USING (auth.role() = 'service_role');

-- 9. RLS POLICIES FOR LABELS_UNITS
DROP POLICY IF EXISTS "Users can view own company labels_units" ON labels_units;
CREATE POLICY "Users can view own company labels_units" ON labels_units
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

DROP POLICY IF EXISTS "Users can insert own company labels_units" ON labels_units;
CREATE POLICY "Users can insert own company labels_units" ON labels_units
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT company_id FROM seats 
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Service role full access labels_units" ON labels_units;
CREATE POLICY "Service role full access labels_units" ON labels_units
  FOR ALL
  USING (auth.role() = 'service_role');

-- 10. RLS POLICIES FOR BOXES
DROP POLICY IF EXISTS "Users can view own company boxes" ON boxes;
CREATE POLICY "Users can view own company boxes" ON boxes
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

DROP POLICY IF EXISTS "Users can manage own company boxes" ON boxes;
CREATE POLICY "Users can manage own company boxes" ON boxes
  FOR ALL
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT company_id FROM seats 
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Service role full access boxes" ON boxes;
CREATE POLICY "Service role full access boxes" ON boxes
  FOR ALL
  USING (auth.role() = 'service_role');

-- 11. RLS POLICIES FOR CARTONS
DROP POLICY IF EXISTS "Users can view own company cartons" ON cartons;
CREATE POLICY "Users can view own company cartons" ON cartons
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

DROP POLICY IF EXISTS "Users can manage own company cartons" ON cartons;
CREATE POLICY "Users can manage own company cartons" ON cartons
  FOR ALL
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT company_id FROM seats 
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Service role full access cartons" ON cartons;
CREATE POLICY "Service role full access cartons" ON cartons
  FOR ALL
  USING (auth.role() = 'service_role');

-- 12. RLS POLICIES FOR PALLETS
DROP POLICY IF EXISTS "Users can view own company pallets" ON pallets;
CREATE POLICY "Users can view own company pallets" ON pallets
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

DROP POLICY IF EXISTS "Users can manage own company pallets" ON pallets;
CREATE POLICY "Users can manage own company pallets" ON pallets
  FOR ALL
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT company_id FROM seats 
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Service role full access pallets" ON pallets;
CREATE POLICY "Service role full access pallets" ON pallets
  FOR ALL
  USING (auth.role() = 'service_role');
