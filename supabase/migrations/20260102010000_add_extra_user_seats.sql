-- Add extra_user_seats to companies so paid add-ons can increase seat limits
ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS extra_user_seats INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.companies.extra_user_seats IS 'Additional paid User ID seats purchased as add-ons (added to plan max_seats)';
