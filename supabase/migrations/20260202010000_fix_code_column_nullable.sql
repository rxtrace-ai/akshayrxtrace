-- =====================================================
-- FIX code COLUMN TO BE NULLABLE
-- The code column should be nullable (can use sscc as fallback)
-- =====================================================

-- Make code nullable in boxes table if it has NOT NULL constraint
DO $$
BEGIN
  -- Check if code column exists and has NOT NULL constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'boxes' 
    AND column_name = 'code'
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE boxes ALTER COLUMN code DROP NOT NULL;
    RAISE NOTICE 'Removed NOT NULL constraint from boxes.code';
  ELSE
    RAISE NOTICE 'boxes.code is already nullable or does not exist';
  END IF;
END $$;

-- Make code nullable in cartons table if it has NOT NULL constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'cartons' 
    AND column_name = 'code'
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE cartons ALTER COLUMN code DROP NOT NULL;
    RAISE NOTICE 'Removed NOT NULL constraint from cartons.code';
  ELSE
    RAISE NOTICE 'cartons.code is already nullable or does not exist';
  END IF;
END $$;

-- Note: pallets table typically doesn't have a code column, but if it does, make it nullable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'pallets' 
    AND column_name = 'code'
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE pallets ALTER COLUMN code DROP NOT NULL;
    RAISE NOTICE 'Removed NOT NULL constraint from pallets.code';
  ELSE
    RAISE NOTICE 'pallets.code is already nullable or does not exist';
  END IF;
END $$;
