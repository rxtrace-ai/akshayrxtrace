-- ============================================
-- Add INSERT policy for companies table
-- ============================================
-- This allows authenticated users to insert their own company
-- The unique constraint on user_id prevents duplicates

-- Add INSERT policy for companies
CREATE POLICY "Users can insert own company" ON public.companies
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Verify unique constraint exists on user_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'companies_user_id_unique'
  ) THEN
    ALTER TABLE public.companies
    ADD CONSTRAINT companies_user_id_unique UNIQUE (user_id);
  END IF;
END $$;
