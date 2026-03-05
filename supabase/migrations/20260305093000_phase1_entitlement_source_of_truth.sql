-- ============================================================
-- PHASE 1: Entitlement Source of Truth (Schema + Invariants only)
-- ============================================================
-- Objective:
-- - Represent trial, paid subscription snapshot (Razorpay), add-ons, and quota usage in DB
-- - Keep changes additive and compatible with existing subscription/quota tables
--
-- Notes:
-- - This repo already contains:
--   - subscription_plans, add_ons
--   - company_subscriptions, company_add_ons
--   - usage_events, usage_counters
-- - This migration EXTENDS those tables rather than creating parallel ones.

-- 1) Trial fields on companies (one-trial-per-company enforced in backend later)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS trial_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_activated_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS trial_activated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Optional consistency check: if both timestamps are present, end must be >= start
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_trial_window_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_trial_window_check
      CHECK (
        trial_start_at IS NULL
        OR trial_end_at IS NULL
        OR trial_end_at >= trial_start_at
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_trial_end_at ON companies(trial_end_at) WHERE trial_end_at IS NOT NULL;

-- 2) Paid subscription snapshot extension (Razorpay -> DB)
-- Existing table: company_subscriptions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_subscriptions'
  ) THEN
    ALTER TABLE company_subscriptions
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'razorpay',
      ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS plan_code TEXT,
      ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
  END IF;
END $$;

-- Back-compat: mirror existing razorpay_subscription_id into provider_subscription_id when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'razorpay_subscription_id'
  ) THEN
    UPDATE company_subscriptions
    SET provider_subscription_id = COALESCE(provider_subscription_id, razorpay_subscription_id)
    WHERE razorpay_subscription_id IS NOT NULL
      AND (provider_subscription_id IS NULL OR provider_subscription_id = '');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_subscriptions'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_company_subscriptions_provider_subscription_id_unique
      ON company_subscriptions(provider_subscription_id)
      WHERE provider_subscription_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_company_subscriptions_status_period_end
      ON company_subscriptions(status, current_period_end);
  END IF;
END $$;

-- 3) Webhook/event inbox for provider events (idempotency + audit)
-- Prefer existing `public.webhook_events` if your schema already has it.
-- Create `billing_events` only when `webhook_events` does not exist (avoid parallel inbox tables).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'webhook_events'
  ) THEN
    CREATE TABLE IF NOT EXISTS billing_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      process_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (process_status IN ('pending', 'processed', 'failed')),
      error TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_provider_event_id_unique
      ON billing_events(provider, event_id);

    CREATE INDEX IF NOT EXISTS idx_billing_events_status_received
      ON billing_events(process_status, received_at DESC);
  END IF;
END $$;

-- 4) Plan quota definitions
-- This repo commonly uses the template/version model:
-- - subscription_plan_templates
-- - subscription_plan_versions (with unit_limit/box_limit/etc)
-- Add limits_json on versions (optional) so the entitlement engine can read a single JSON blob later.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'subscription_plan_versions'
  ) THEN
    ALTER TABLE subscription_plan_versions
      ADD COLUMN IF NOT EXISTS limits_json JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 5) Add-on quota definitions (store incremental limits_json on add_ons)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'add_ons'
  ) THEN
    ALTER TABLE add_ons
      ADD COLUMN IF NOT EXISTS limits_json JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Extend company_add_ons with time-window fields for stacking logic (backend later)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_add_ons'
  ) THEN
    ALTER TABLE company_add_ons
      ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_company_add_ons_company_status_ends
      ON company_add_ons(company_id, status, ends_at)
      WHERE ends_at IS NOT NULL;
  END IF;
END $$;

-- 6) Usage ledger extensions for idempotent quota consumption
-- Existing table: usage_events(metric_type, source, reference_id, created_at)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'usage_events'
  ) THEN
    ALTER TABLE usage_events
      ADD COLUMN IF NOT EXISTS request_id TEXT,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

    -- Idempotency index (partial so legacy rows without request_id remain valid)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_company_metric_request_id_unique
      ON usage_events(company_id, metric_type, request_id)
      WHERE request_id IS NOT NULL;

    -- Helpful query index for current-period reads
    CREATE INDEX IF NOT EXISTS idx_usage_events_company_metric_created_at_desc
      ON usage_events(company_id, metric_type, created_at DESC);
  END IF;
END $$;

-- ============================================================
-- Rollback (manual; do NOT run automatically)
-- ============================================================
-- This migration is additive. Safe rollback is:
--   - DROP INDEX/TABLE billing_events
--   - DROP indexes added here
--   - DROP columns added here (companies trial columns, company_subscriptions provider cols,
--     subscription_plans/add_ons limits_json, company_add_ons starts_at/ends_at, usage_events request_id/metadata)
-- Ensure no application code depends on these columns before dropping.
