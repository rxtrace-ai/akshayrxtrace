-- Add invoice breakdown + wallet payment fields
-- Keeps existing `amount` as the invoice gross total (plan base + monthly add-ons).

ALTER TABLE IF EXISTS public.billing_invoices
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS addons_amount NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS wallet_applied NUMERIC(18, 2) NOT NULL DEFAULT 0;

-- Best-effort backfill from metadata.pricing (written by cron runner)
UPDATE public.billing_invoices
SET
  base_amount = COALESCE(base_amount, NULLIF((metadata->'pricing'->>'base'), '')::numeric),
  addons_amount = COALESCE(addons_amount, NULLIF((metadata->'pricing'->>'addons'), '')::numeric)
WHERE
  (base_amount IS NULL OR addons_amount IS NULL)
  AND metadata ? 'pricing';
