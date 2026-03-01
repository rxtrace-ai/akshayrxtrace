-- Fix billing invoice uniqueness constraints for mixed invoice types.
--
-- Original schema used a unique index on (company_id, period_start) to prevent duplicates.
-- That can conflict for add-on invoices that may share timestamps, and isn't as robust
-- as using the provider/reference identifiers.

-- Drop legacy uniqueness (safe if it doesn't exist)
DROP INDEX IF EXISTS public.uniq_billing_invoices_company_period;

-- Prefer uniqueness by reference when present (works for subscription + add-ons)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_billing_invoices_company_reference
  ON public.billing_invoices (company_id, reference)
  WHERE reference IS NOT NULL;

-- Prefer uniqueness by provider invoice id when present (e.g. Razorpay invoice id)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_billing_invoices_provider_invoice
  ON public.billing_invoices (provider, provider_invoice_id)
  WHERE provider IS NOT NULL AND provider_invoice_id IS NOT NULL;
