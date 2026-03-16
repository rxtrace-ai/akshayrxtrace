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

    -- Drop any existing FK first so we can safely clean/backfill.
    ALTER TABLE public.user_profiles
      DROP CONSTRAINT IF EXISTS user_profiles_user_id_fk;

    -- Backfill user_id from legacy id column only when auth user exists.
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

      UPDATE public.user_profiles p
      SET user_id = NULL
      WHERE p.user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM auth.users u
          WHERE u.id = p.user_id
        );

      UPDATE public.user_profiles p
      SET user_id = p.id
      WHERE p.user_id IS NULL
        AND p.id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM auth.users u
          WHERE u.id = p.id
        );
    END IF;

    -- Null out invalid values before adding canonical FK.
    UPDATE public.user_profiles p
    SET user_id = NULL
    WHERE p.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM auth.users u
        WHERE u.id = p.user_id
      );

    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_user_id_fk
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;

    -- Use a true UNIQUE CONSTRAINT so ON CONFLICT (user_id) is valid.
    DROP INDEX IF EXISTS public.user_profiles_user_id_key;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conname = 'user_profiles_user_id_unique'
        AND c.conrelid = 'public.user_profiles'::regclass
    ) THEN
      ALTER TABLE public.user_profiles
        ADD CONSTRAINT user_profiles_user_id_unique UNIQUE (user_id);
    END IF;
  END IF;
END $$;

-- One-time backfill: ensure every existing seat member has a user_profiles row.
DO $$
DECLARE
  has_email boolean;
  has_created_at boolean;
  has_updated_at boolean;
  has_id boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
  ) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'email'
  ) INTO has_email;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'created_at'
  ) INTO has_created_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'updated_at'
  ) INTO has_updated_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'id'
  ) INTO has_id;

  IF has_id AND has_email AND has_created_at AND has_updated_at THEN
    INSERT INTO public.user_profiles (id, user_id, email, created_at, updated_at)
    SELECT
      s.user_id,
      s.user_id,
      lower(trim(s.email)),
      now(),
      now()
    FROM public.seats s
    LEFT JOIN public.user_profiles p ON p.user_id = s.user_id
    WHERE s.user_id IS NOT NULL
      AND p.user_id IS NULL
    ON CONFLICT DO NOTHING;
  ELSIF has_id AND has_email AND has_created_at THEN
    INSERT INTO public.user_profiles (id, user_id, email, created_at)
    SELECT
      s.user_id,
      s.user_id,
      lower(trim(s.email)),
      now()
    FROM public.seats s
    LEFT JOIN public.user_profiles p ON p.user_id = s.user_id
    WHERE s.user_id IS NOT NULL
      AND p.user_id IS NULL
    ON CONFLICT DO NOTHING;
  ELSIF has_id AND has_email THEN
    INSERT INTO public.user_profiles (id, user_id, email)
    SELECT
      s.user_id,
      s.user_id,
      lower(trim(s.email))
    FROM public.seats s
    LEFT JOIN public.user_profiles p ON p.user_id = s.user_id
    WHERE s.user_id IS NOT NULL
      AND p.user_id IS NULL
    ON CONFLICT DO NOTHING;
  ELSIF has_id THEN
    INSERT INTO public.user_profiles (id, user_id)
    SELECT
      s.user_id,
      s.user_id
    FROM public.seats s
    LEFT JOIN public.user_profiles p ON p.user_id = s.user_id
    WHERE s.user_id IS NOT NULL
      AND p.user_id IS NULL
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_profiles (user_id)
    SELECT s.user_id
    FROM public.seats s
    LEFT JOIN public.user_profiles p ON p.user_id = s.user_id
    WHERE s.user_id IS NOT NULL
      AND p.user_id IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Auto-create profile rows for all future auth user creations.
CREATE OR REPLACE FUNCTION public.handle_auth_user_profile_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, user_id, email, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.id,
    lower(trim(NEW.email)),
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = COALESCE(EXCLUDED.email, public.user_profiles.email),
    updated_at = now();

  RETURN NEW;
EXCEPTION
  WHEN undefined_column THEN
    INSERT INTO public.user_profiles (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_user_profile_create();
