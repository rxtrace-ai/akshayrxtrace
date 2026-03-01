-- Razorpay subscriptions for base plan (post-trial auto-renew)

-- Store Razorpay identifiers on companies so we can cancel/upgrade and sync status.
DO $$
DECLARE
  companies_reg regclass;
  full_table text;
BEGIN
  companies_reg := to_regclass('public.companies');
  IF companies_reg IS NULL THEN
    companies_reg := to_regclass('companies');
  END IF;
  IF companies_reg IS NULL THEN
    RAISE EXCEPTION 'companies table not found';
  END IF;

  full_table := companies_reg::text;

  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS razorpay_subscription_status TEXT', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS razorpay_plan_id TEXT', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT false', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS subscription_cancelled_at TIMESTAMPTZ', full_table);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMPTZ', full_table);
END $$;

-- Optional provider reference columns for internal invoices.
ALTER TABLE IF EXISTS public.billing_invoices
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_invoices_provider_invoice_id
  ON public.billing_invoices (provider_invoice_id);
