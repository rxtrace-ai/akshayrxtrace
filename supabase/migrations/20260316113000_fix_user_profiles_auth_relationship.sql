-- Ensure canonical auth relationships for seat/member joins.
-- 1) public.seats.user_id -> auth.users.id (already enforced by prior migration)
-- 2) public.user_profiles.user_id -> auth.users.id

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD COLUMN IF NOT EXISTS user_id uuid;

    -- Backfill user_id from legacy id column when possible.
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_profiles'
        AND column_name = 'id'
    ) THEN
      UPDATE public.user_profiles
      SET user_id = id
      WHERE user_id IS NULL
        AND id IS NOT NULL;
    END IF;

    -- Null out invalid values before adding FK.
    UPDATE public.user_profiles p
    SET user_id = NULL
    WHERE p.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM auth.users u
        WHERE u.id = p.user_id
      );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conname = 'user_profiles_user_id_fk'
        AND c.conrelid = 'public.user_profiles'::regclass
    ) THEN
      ALTER TABLE public.user_profiles
        ADD CONSTRAINT user_profiles_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES auth.users(id)
        ON DELETE CASCADE;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_user_id_key
      ON public.user_profiles(user_id)
      WHERE user_id IS NOT NULL;
  END IF;
END $$;

