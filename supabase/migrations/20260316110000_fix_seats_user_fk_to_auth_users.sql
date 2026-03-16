-- Fix seat acceptance FK failures caused by drifted seats.user_id constraints.
-- Ensures public.seats.user_id always references auth.users(id).

DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'seats'
      AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'schema_assert_failed: public.seats.user_id missing';
  END IF;

  -- Remove any existing FK constraints attached to seats.user_id, regardless of name/target table.
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'seats'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE 'FOREIGN KEY (user_id)%'
  LOOP
    EXECUTE format('ALTER TABLE public.seats DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  -- If bad values exist, null them before re-adding the canonical FK.
  UPDATE public.seats s
  SET user_id = NULL
  WHERE s.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = s.user_id
    );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conname = 'seats_user_id_fk'
      AND c.conrelid = 'public.seats'::regclass
  ) THEN
    ALTER TABLE public.seats
      ADD CONSTRAINT seats_user_id_fk
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_seats_user_id ON public.seats(user_id);
