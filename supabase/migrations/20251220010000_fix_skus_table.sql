-- Fix SKUs table structure - remove category and description columns
-- Create table if it doesn't exist with proper structure

-- Create SKUs table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sku_code text NOT NULL,
  sku_name text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT skus_company_id_sku_code_key UNIQUE (company_id, sku_code)
);

-- Drop category and description columns if they exist
ALTER TABLE public.skus DROP COLUMN IF EXISTS category;
ALTER TABLE public.skus DROP COLUMN IF EXISTS description;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS skus_company_id_idx ON public.skus(company_id);
CREATE INDEX IF NOT EXISTS skus_company_active_idx 
  ON public.skus(company_id) 
  WHERE deleted_at IS NULL;

-- Enable RLS
ALTER TABLE public.skus ENABLE ROW LEVEL SECURITY;

-- Drop existing policies safely (Postgres supports this)
DROP POLICY IF EXISTS "Users can view their company SKUs" ON public.skus;
DROP POLICY IF EXISTS "Users can insert their company SKUs" ON public.skus;
DROP POLICY IF EXISTS "Users can update their company SKUs" ON public.skus;
DROP POLICY IF EXISTS "Users can delete their company SKUs" ON public.skus;

-- Policy: Users can view SKUs from their company
CREATE POLICY "Users can view their company SKUs"
  ON public.skus
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM public.companies WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can insert SKUs for their company
CREATE POLICY "Users can insert their company SKUs"
  ON public.skus
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT id FROM public.companies WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can update SKUs from their company
CREATE POLICY "Users can update their company SKUs"
  ON public.skus
  FOR UPDATE
  USING (
    company_id IN (
      SELECT id FROM public.companies WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can delete SKUs from their company
CREATE POLICY "Users can delete their company SKUs"
  ON public.skus
  FOR DELETE
  USING (
    company_id IN (
      SELECT id FROM public.companies WHERE user_id = auth.uid()
    )
  );