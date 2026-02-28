-- Phase 1 plant management schema
CREATE TABLE IF NOT EXISTS public.plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  street_address TEXT NOT NULL,
  city_state TEXT NOT NULL,
  location_description TEXT,
  status TEXT NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'active')),
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plants_company_id ON public.plants(company_id);
CREATE INDEX IF NOT EXISTS idx_plants_company_status ON public.plants(company_id, status);

CREATE OR REPLACE FUNCTION public.update_plants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plants_updated_at ON public.plants;
CREATE TRIGGER plants_updated_at
  BEFORE UPDATE ON public.plants
  FOR EACH ROW EXECUTE FUNCTION public.update_plants_updated_at();
