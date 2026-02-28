-- Add trial timestamp columns for Phase 1 trial control
-- Ensures the system captures when each company starts and ends the built-in 15-day trial.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_companies_trial_started_at
  ON public.companies (trial_started_at);

CREATE INDEX IF NOT EXISTS idx_companies_trial_expires_at
  ON public.companies (trial_expires_at);
