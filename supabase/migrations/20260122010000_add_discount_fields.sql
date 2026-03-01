-- Add discount fields to companies table for admin-managed discounts
-- Discounts can be percentage-based or flat amount
-- Applied to subscriptions and add-ons

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS discount_type TEXT CHECK (discount_type IN ('percentage', 'flat', NULL)),
  ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS discount_applies_to TEXT CHECK (discount_applies_to IN ('subscription', 'addon', 'both', NULL)) DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS discount_notes TEXT;

COMMENT ON COLUMN companies.discount_type IS 'Type of discount: percentage or flat amount';
COMMENT ON COLUMN companies.discount_value IS 'Discount value: percentage (0-100) or flat amount in INR';
COMMENT ON COLUMN companies.discount_applies_to IS 'What the discount applies to: subscription, addon, or both';
COMMENT ON COLUMN companies.discount_notes IS 'Admin notes about the discount (e.g., reason, expiry)';
