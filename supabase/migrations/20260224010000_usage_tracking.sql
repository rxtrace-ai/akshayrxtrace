-- PART 1: Usage Tracking Tables
-- Safe migration - does not break existing data

-- Usage Counters (aggregated monthly usage)
CREATE TABLE IF NOT EXISTS usage_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('UNIT', 'BOX', 'CARTON', 'SSCC', 'API')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  used_quantity INTEGER NOT NULL DEFAULT 0 CHECK (used_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, metric_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_company ON usage_counters(company_id, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_counters_metric ON usage_counters(metric_type, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_counters_period ON usage_counters(period_start, period_end);

-- Usage Events (individual generation events)
CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('UNIT', 'BOX', 'CARTON', 'SSCC', 'API')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  source TEXT NOT NULL CHECK (source IN ('ui', 'csv', 'api')),
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_company ON usage_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_metric ON usage_events(metric_type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);

-- PART 2: Extend plan_items with limits
DO $$
BEGIN
  -- Add limit_value column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'plan_items' 
    AND column_name = 'limit_value'
  ) THEN
    ALTER TABLE plan_items ADD COLUMN limit_value INTEGER;
  END IF;

  -- Add limit_type column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'plan_items' 
    AND column_name = 'limit_type'
  ) THEN
    ALTER TABLE plan_items ADD COLUMN limit_type TEXT CHECK (limit_type IN ('HARD', 'SOFT', 'NONE'));
    ALTER TABLE plan_items ALTER COLUMN limit_type SET DEFAULT 'NONE';
  END IF;
END $$;

-- PART 3: Add max_users to subscription_plans
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'subscription_plans' 
    AND column_name = 'max_users'
  ) THEN
    ALTER TABLE subscription_plans ADD COLUMN max_users INTEGER DEFAULT 1 CHECK (max_users > 0);
  END IF;
END $$;

-- Update triggers for updated_at
CREATE OR REPLACE FUNCTION update_usage_counters_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_usage_counters_updated_at BEFORE UPDATE ON usage_counters
  FOR EACH ROW EXECUTE FUNCTION update_usage_counters_updated_at();

-- Function to aggregate usage events into counters
CREATE OR REPLACE FUNCTION aggregate_usage_events()
RETURNS TRIGGER AS $$
DECLARE
  period_start_date DATE;
  period_end_date DATE;
BEGIN
  -- Calculate month start/end for the event
  period_start_date := DATE_TRUNC('month', NEW.created_at)::DATE;
  period_end_date := (DATE_TRUNC('month', NEW.created_at) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Upsert usage counter
  INSERT INTO usage_counters (company_id, metric_type, period_start, period_end, used_quantity)
  VALUES (NEW.company_id, NEW.metric_type, period_start_date, period_end_date, NEW.quantity)
  ON CONFLICT (company_id, metric_type, period_start)
  DO UPDATE SET
    used_quantity = usage_counters.used_quantity + NEW.quantity,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-aggregate events
CREATE TRIGGER aggregate_usage_on_insert
  AFTER INSERT ON usage_events
  FOR EACH ROW
  EXECUTE FUNCTION aggregate_usage_events();

-- Additional performance indexes
CREATE INDEX IF NOT EXISTS idx_usage_events_company_metric_created ON usage_events(company_id, metric_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_counters_company_period ON usage_counters(company_id, period_start DESC, metric_type);
