-- PART 1: Subscription System Data Model
-- Safe migration - does not break existing data

-- Subscription Plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  base_price DECIMAL(12, 2) NOT NULL CHECK (base_price >= 0),
  razorpay_plan_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON subscription_plans(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_razorpay ON subscription_plans(razorpay_plan_id) WHERE razorpay_plan_id IS NOT NULL;

-- Plan Items (Features)
CREATE TABLE IF NOT EXISTS plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id, display_order);

-- Add-ons
CREATE TABLE IF NOT EXISTS add_ons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(12, 2) NOT NULL CHECK (price >= 0),
  unit TEXT NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT false,
  razorpay_item_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_add_ons_active ON add_ons(is_active, display_order);

-- Company Subscriptions
CREATE TABLE IF NOT EXISTS company_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  razorpay_subscription_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('TRIAL', 'ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED')),
  trial_end TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure all columns exist (handles case where table was partially created)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'razorpay_subscription_id') THEN
    ALTER TABLE company_subscriptions ADD COLUMN razorpay_subscription_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'status') THEN
    ALTER TABLE company_subscriptions ADD COLUMN status TEXT;
    ALTER TABLE company_subscriptions ADD CONSTRAINT company_subscriptions_status_check CHECK (status IN ('TRIAL', 'ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED'));
    ALTER TABLE company_subscriptions ALTER COLUMN status SET DEFAULT 'ACTIVE';
    ALTER TABLE company_subscriptions ALTER COLUMN status SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'trial_end') THEN
    ALTER TABLE company_subscriptions ADD COLUMN trial_end TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'current_period_end') THEN
    ALTER TABLE company_subscriptions ADD COLUMN current_period_end TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'created_at') THEN
    ALTER TABLE company_subscriptions ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'updated_at') THEN
    ALTER TABLE company_subscriptions ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'company_subscriptions_company_id_key'
  ) THEN
    ALTER TABLE company_subscriptions ADD CONSTRAINT company_subscriptions_company_id_key UNIQUE (company_id);
  END IF;
END $$;

-- Create indexes (only if column exists)
CREATE INDEX IF NOT EXISTS idx_company_subscriptions_company ON company_subscriptions(company_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'razorpay_subscription_id') THEN
    CREATE INDEX IF NOT EXISTS idx_company_subscriptions_razorpay ON company_subscriptions(razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_company_subscriptions_status ON company_subscriptions(status);

-- Company Add-ons
CREATE TABLE IF NOT EXISTS company_add_ons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  add_on_id UUID NOT NULL REFERENCES add_ons(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, add_on_id)
);

CREATE INDEX IF NOT EXISTS idx_company_add_ons_company ON company_add_ons(company_id, status);

-- Discounts
CREATE TABLE IF NOT EXISTS discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'flat')),
  value DECIMAL(12, 2) NOT NULL CHECK (value >= 0),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discounts_code ON discounts(code, is_active);
CREATE INDEX IF NOT EXISTS idx_discounts_validity ON discounts(valid_from, valid_to, is_active);

-- Company Discounts (Applied)
CREATE TABLE IF NOT EXISTS company_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  discount_id UUID NOT NULL REFERENCES discounts(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, discount_id)
);

CREATE INDEX IF NOT EXISTS idx_company_discounts_company ON company_discounts(company_id);

-- Credit Notes
CREATE TABLE IF NOT EXISTS credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_company ON credit_notes(company_id, created_at);

-- Refunds
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  razorpay_payment_id TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')),
  razorpay_refund_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_company ON refunds(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_refunds_razorpay ON refunds(razorpay_payment_id);

-- Audit Logs (if not exists, extend if exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    CREATE TABLE audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      old_value JSONB,
      new_value JSONB,
      performed_by UUID REFERENCES auth.users(id),
      performed_by_email TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    CREATE INDEX idx_audit_logs_company ON audit_logs(company_id, created_at);
    CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at);
    CREATE INDEX idx_audit_logs_performed_by ON audit_logs(performed_by, created_at);
  END IF;
END $$;

-- Update triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_subscription_plans_updated_at BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_add_ons_updated_at BEFORE UPDATE ON add_ons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_company_subscriptions_updated_at BEFORE UPDATE ON company_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_company_add_ons_updated_at BEFORE UPDATE ON company_add_ons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_discounts_updated_at BEFORE UPDATE ON discounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_refunds_updated_at BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default plans (safe - only if not exists)
INSERT INTO subscription_plans (name, description, billing_cycle, base_price, display_order, is_active)
SELECT 'Starter', 'Perfect for small businesses', 'monthly', 18000.00, 1, true
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Starter' AND billing_cycle = 'monthly');

INSERT INTO subscription_plans (name, description, billing_cycle, base_price, display_order, is_active)
SELECT 'Starter', 'Perfect for small businesses', 'yearly', 200000.00, 2, true
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Starter' AND billing_cycle = 'yearly');

INSERT INTO subscription_plans (name, description, billing_cycle, base_price, display_order, is_active)
SELECT 'Growth', 'Most popular plan', 'monthly', 49000.00, 3, true
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Growth' AND billing_cycle = 'monthly');

INSERT INTO subscription_plans (name, description, billing_cycle, base_price, display_order, is_active)
SELECT 'Growth', 'Most popular plan', 'yearly', 500000.00, 4, true
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Growth' AND billing_cycle = 'yearly');

INSERT INTO subscription_plans (name, description, billing_cycle, base_price, display_order, is_active)
SELECT 'Enterprise', 'For large enterprises', 'monthly', 200000.00, 5, true
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Enterprise' AND billing_cycle = 'monthly');

INSERT INTO subscription_plans (name, description, billing_cycle, base_price, display_order, is_active)
SELECT 'Enterprise', 'For large enterprises', 'yearly', 2000000.00, 6, true
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Enterprise' AND billing_cycle = 'yearly');

-- Insert default add-ons (safe - only if not exists)
INSERT INTO add_ons (name, description, price, unit, recurring, display_order, is_active)
SELECT 'Extra Unit labels', 'Additional unit labels beyond plan limits', 0.10, 'label', false, 1, true
WHERE NOT EXISTS (SELECT 1 FROM add_ons WHERE name = 'Extra Unit labels');

INSERT INTO add_ons (name, description, price, unit, recurring, display_order, is_active)
SELECT 'Extra Box labels', 'Additional box labels beyond plan limits', 0.30, 'label', false, 2, true
WHERE NOT EXISTS (SELECT 1 FROM add_ons WHERE name = 'Extra Box labels');

INSERT INTO add_ons (name, description, price, unit, recurring, display_order, is_active)
SELECT 'Extra Carton labels', 'Additional carton labels beyond plan limits', 1.00, 'label', false, 3, true
WHERE NOT EXISTS (SELECT 1 FROM add_ons WHERE name = 'Extra Carton labels');

INSERT INTO add_ons (name, description, price, unit, recurring, display_order, is_active)
SELECT 'Extra Pallet labels (SSCC)', 'Additional pallet/SSCC labels beyond plan limits', 2.00, 'label', false, 4, true
WHERE NOT EXISTS (SELECT 1 FROM add_ons WHERE name = 'Extra Pallet labels (SSCC)');

INSERT INTO add_ons (name, description, price, unit, recurring, display_order, is_active)
SELECT 'Additional User ID (Seat)', 'Extra user seat for your team', 3000.00, 'month', true, 5, true
WHERE NOT EXISTS (SELECT 1 FROM add_ons WHERE name = 'Additional User ID (Seat)');
