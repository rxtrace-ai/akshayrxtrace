-- ============================================
-- 8. HANDSETS TABLE
-- ============================================

DO $$
BEGIN
  -- Ensure table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'handsets'
  )
  THEN

    ALTER TABLE public.handsets ENABLE ROW LEVEL SECURITY;

    -- Ensure company_id column exists before creating policies
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'handsets'
        AND column_name = 'company_id'
    )
    THEN

      DROP POLICY IF EXISTS "Users can view own company handsets" ON public.handsets;
      DROP POLICY IF EXISTS "Users can manage own company handsets" ON public.handsets;
      DROP POLICY IF EXISTS "Service role full access handsets" ON public.handsets;

      CREATE POLICY "Users can view own company handsets"
        ON public.handsets
        FOR SELECT
        USING (
          company_id IN (
            SELECT id FROM public.companies WHERE user_id = auth.uid()
          )
          OR
          company_id IN (
            SELECT company_id FROM public.seats
            WHERE user_id = auth.uid() AND status = 'active'
          )
        );

      CREATE POLICY "Users can manage own company handsets"
        ON public.handsets
        FOR ALL
        USING (
          company_id IN (
            SELECT id FROM public.companies WHERE user_id = auth.uid()
          )
          OR
          company_id IN (
            SELECT company_id FROM public.seats
            WHERE user_id = auth.uid()
              AND status = 'active'
              AND role IN ('admin', 'manager')
          )
        );

      CREATE POLICY "Service role full access handsets"
        ON public.handsets
        FOR ALL
        USING (auth.role() = 'service_role');

    END IF;

  END IF;
END
$$;