-- Harden auth -> user_profiles synchronization so signup can never fail
-- because of stale profile rows, email uniqueness collisions, or partial schema drift.

CREATE OR REPLACE FUNCTION public.handle_auth_user_profile_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_user_profiles boolean := false;
  has_id boolean := false;
  has_user_id boolean := false;
  has_email boolean := false;
  has_created_at boolean := false;
  has_updated_at boolean := false;
  normalized_email text := nullif(lower(trim(NEW.email)), '');
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
  )
  INTO has_user_profiles;

  IF NOT has_user_profiles THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'id'
  ) INTO has_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'user_id'
  ) INTO has_user_id;

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

  -- First repair any existing row that already owns this email but is orphaned or stale.
  IF has_email AND normalized_email IS NOT NULL THEN
    BEGIN
      IF has_id AND has_user_id AND has_updated_at THEN
        UPDATE public.user_profiles p
        SET
          id = COALESCE(p.id, NEW.id),
          user_id = NEW.id,
          email = normalized_email,
          updated_at = now()
        WHERE lower(trim(coalesce(p.email, ''))) = normalized_email
          AND (
            p.user_id IS NULL
            OR p.user_id = NEW.id
            OR NOT EXISTS (
              SELECT 1
              FROM auth.users u
              WHERE u.id = p.user_id
            )
          );
      ELSIF has_id AND has_user_id THEN
        UPDATE public.user_profiles p
        SET
          id = COALESCE(p.id, NEW.id),
          user_id = NEW.id,
          email = normalized_email
        WHERE lower(trim(coalesce(p.email, ''))) = normalized_email
          AND (
            p.user_id IS NULL
            OR p.user_id = NEW.id
            OR NOT EXISTS (
              SELECT 1
              FROM auth.users u
              WHERE u.id = p.user_id
            )
          );
      ELSIF has_user_id AND has_updated_at THEN
        UPDATE public.user_profiles p
        SET
          user_id = NEW.id,
          email = normalized_email,
          updated_at = now()
        WHERE lower(trim(coalesce(p.email, ''))) = normalized_email
          AND (
            p.user_id IS NULL
            OR p.user_id = NEW.id
            OR NOT EXISTS (
              SELECT 1
              FROM auth.users u
              WHERE u.id = p.user_id
            )
          );
      ELSIF has_user_id THEN
        UPDATE public.user_profiles p
        SET
          user_id = NEW.id,
          email = normalized_email
        WHERE lower(trim(coalesce(p.email, ''))) = normalized_email
          AND (
            p.user_id IS NULL
            OR p.user_id = NEW.id
            OR NOT EXISTS (
              SELECT 1
              FROM auth.users u
              WHERE u.id = p.user_id
            )
          );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE LOG 'handle_auth_user_profile_create email repair skipped for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- Then ensure a canonical row exists for this auth user without blocking signup on failure.
  BEGIN
    IF has_id AND has_user_id AND has_email AND has_created_at AND has_updated_at THEN
      INSERT INTO public.user_profiles (id, user_id, email, created_at, updated_at)
      VALUES (NEW.id, NEW.id, normalized_email, now(), now())
      ON CONFLICT (user_id) DO UPDATE
      SET
        id = COALESCE(public.user_profiles.id, EXCLUDED.id),
        email = COALESCE(EXCLUDED.email, public.user_profiles.email),
        updated_at = now();
    ELSIF has_id AND has_user_id AND has_email AND has_created_at THEN
      INSERT INTO public.user_profiles (id, user_id, email, created_at)
      VALUES (NEW.id, NEW.id, normalized_email, now())
      ON CONFLICT (user_id) DO UPDATE
      SET
        id = COALESCE(public.user_profiles.id, EXCLUDED.id),
        email = COALESCE(EXCLUDED.email, public.user_profiles.email);
    ELSIF has_id AND has_user_id AND has_email THEN
      INSERT INTO public.user_profiles (id, user_id, email)
      VALUES (NEW.id, NEW.id, normalized_email)
      ON CONFLICT (user_id) DO UPDATE
      SET
        id = COALESCE(public.user_profiles.id, EXCLUDED.id),
        email = COALESCE(EXCLUDED.email, public.user_profiles.email);
    ELSIF has_user_id AND has_email AND has_updated_at THEN
      INSERT INTO public.user_profiles (user_id, email, updated_at)
      VALUES (NEW.id, normalized_email, now())
      ON CONFLICT (user_id) DO UPDATE
      SET
        email = COALESCE(EXCLUDED.email, public.user_profiles.email),
        updated_at = now();
    ELSIF has_user_id AND has_email THEN
      INSERT INTO public.user_profiles (user_id, email)
      VALUES (NEW.id, normalized_email)
      ON CONFLICT (user_id) DO UPDATE
      SET
        email = COALESCE(EXCLUDED.email, public.user_profiles.email);
    ELSIF has_id AND has_user_id THEN
      INSERT INTO public.user_profiles (id, user_id)
      VALUES (NEW.id, NEW.id)
      ON CONFLICT (user_id) DO UPDATE
      SET
        id = COALESCE(public.user_profiles.id, EXCLUDED.id);
    ELSIF has_user_id THEN
      INSERT INTO public.user_profiles (user_id)
      VALUES (NEW.id)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      -- Never block auth signup because of profile uniqueness drift.
      RAISE LOG 'handle_auth_user_profile_create uniqueness fallback for % (%): %', NEW.id, normalized_email, SQLERRM;
    WHEN undefined_table OR undefined_column THEN
      RAISE LOG 'handle_auth_user_profile_create schema drift fallback for %: %', NEW.id, SQLERRM;
    WHEN OTHERS THEN
      RAISE LOG 'handle_auth_user_profile_create unexpected fallback for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_user_profile_create();
