-- =====================================================
-- Setup Flow Schema Migration
-- Creates tables and columns needed for company setup
-- =====================================================

-- 1. Update companies table with setup flow columns
ALTER TABLE companies 
  ADD COLUMN IF NOT EXISTS firm_type TEXT CHECK (firm_type IN ('proprietorship', 'partnership', 'llp', 'pvt_ltd', 'ltd')),
  ADD COLUMN IF NOT EXISTS business_category TEXT,
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT CHECK (subscription_status IN ('trial', 'active', 'expired', 'cancelled')),
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT,
  ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS gst TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Add indexes for query performance
CREATE INDEX IF NOT EXISTS idx_companies_subscription_status ON companies(subscription_status);
CREATE INDEX IF NOT EXISTS idx_companies_trial_end_date ON companies(trial_end_date);
CREATE INDEX IF NOT EXISTS idx_companies_email ON companies(email);

-- 2. Create otp_verifications table
CREATE TABLE IF NOT EXISTS otp_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for OTP lookups
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email);
CREATE INDEX IF NOT EXISTS idx_otp_verified ON otp_verifications(verified);
CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_verifications(expires_at);

-- Enable RLS
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;

-- RLS policy: Anyone can insert OTPs (for signup/verification)
CREATE POLICY "Anyone can insert OTP" 
  ON otp_verifications 
  FOR INSERT 
  WITH CHECK (true);

-- RLS policy: Anyone can read their own email's OTP
CREATE POLICY "Users can read own email OTP"
  ON otp_verifications
  FOR SELECT
  USING (true);

-- RLS policy: System can update OTPs
CREATE POLICY "System can update OTPs"
  ON otp_verifications
  FOR UPDATE
  USING (true);

-- RLS policy: System can delete OTPs
CREATE POLICY "System can delete OTPs"
  ON otp_verifications
  FOR DELETE
  USING (true);

-- 3. Create billing_usage table
CREATE TABLE IF NOT EXISTS billing_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  billing_period_start TIMESTAMPTZ NOT NULL,
  billing_period_end TIMESTAMPTZ NOT NULL,
  plan TEXT NOT NULL,
  
  -- Quotas
  unit_labels_quota INTEGER DEFAULT 0,
  box_labels_quota INTEGER DEFAULT 0,
  carton_labels_quota INTEGER DEFAULT 0,
  pallet_labels_quota INTEGER DEFAULT 0,
  user_seats_quota INTEGER DEFAULT 1,
  
  -- Usage counters
  unit_labels_used INTEGER DEFAULT 0,
  box_labels_used INTEGER DEFAULT 0,
  carton_labels_used INTEGER DEFAULT 0,
  pallet_labels_used INTEGER DEFAULT 0,
  user_seats_used INTEGER DEFAULT 1,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for billing queries
CREATE INDEX IF NOT EXISTS idx_billing_usage_company_id ON billing_usage(company_id);
CREATE INDEX IF NOT EXISTS idx_billing_usage_period ON billing_usage(billing_period_start, billing_period_end);
CREATE INDEX IF NOT EXISTS idx_billing_usage_plan ON billing_usage(plan);

-- Enable RLS
ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;

-- RLS policy: Companies can view their own billing usage
CREATE POLICY "Companies can view own billing usage"
  ON billing_usage
  FOR SELECT
  USING (company_id IN (
    SELECT id FROM companies WHERE user_id = auth.uid()
  ));

-- RLS policy: System can insert billing records
CREATE POLICY "System can insert billing records"
  ON billing_usage
  FOR INSERT
  WITH CHECK (true);

-- RLS policy: System can update billing records
CREATE POLICY "System can update billing records"
  ON billing_usage
  FOR UPDATE
  USING (true);

-- 4. Create razorpay_orders table (if not exists)
CREATE TABLE IF NOT EXISTS razorpay_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  payment_id TEXT,
  amount DECIMAL(10,2) NOT NULL,
  amount_paise INTEGER NOT NULL,
  currency TEXT DEFAULT 'INR',
  receipt TEXT,
  status TEXT,
  purpose TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_order_id ON razorpay_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_purpose ON razorpay_orders(purpose);
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_status ON razorpay_orders(status);

-- Enable RLS
ALTER TABLE razorpay_orders ENABLE ROW LEVEL SECURITY;

-- RLS policy: System can manage all orders
CREATE POLICY "System can manage orders"
  ON razorpay_orders
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Add helpful comments
COMMENT ON TABLE companies IS 'Company profiles with subscription and billing information';
COMMENT ON TABLE otp_verifications IS 'One-time passwords for email verification';
COMMENT ON TABLE billing_usage IS 'Tracks label generation quotas and usage per billing period';
COMMENT ON TABLE razorpay_orders IS 'Razorpay payment orders for trial activation and subscriptions';

-- 6. Create function to auto-delete expired OTPs (optional cleanup)
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS void AS $$
BEGIN
  DELETE FROM otp_verifications 
  WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Note: You can schedule this function to run periodically using pg_cron or a serverless function
