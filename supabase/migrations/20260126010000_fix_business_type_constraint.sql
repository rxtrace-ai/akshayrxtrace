-- =====================================================
-- FIX BUSINESS_TYPE CONSTRAINT
-- Aligns database constraint with frontend dropdown values
-- =====================================================

-- Drop old constraint if it exists
ALTER TABLE companies
DROP CONSTRAINT IF EXISTS companies_business_type_check;

-- Add updated constraint with all allowed values
ALTER TABLE companies
ADD CONSTRAINT companies_business_type_check
CHECK (
  business_type IN (
    'manufacturer',
    'distributor',
    'wholesaler',
    'exporter',
    'importer',
    'cf_agent'
  )
);

-- Add comment for documentation
COMMENT ON CONSTRAINT companies_business_type_check ON companies
IS 'Allowed business types aligned with frontend dropdown: manufacturer, distributor, wholesaler, exporter, importer, cf_agent';

-- Ensure profile_completed column exists (idempotent)
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN companies.profile_completed
IS 'Company onboarding completion flag';
