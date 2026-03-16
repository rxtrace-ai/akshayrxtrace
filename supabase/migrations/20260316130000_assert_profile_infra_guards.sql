-- Non-destructive assertion migration for invite -> profile -> seat safeguards.
-- Fails deployment if required profile infrastructure is missing.

DO $$
DECLARE
  has_profile_function boolean;
  has_profile_trigger boolean;
  has_user_id_unique boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_auth_user_profile_create'
  )
  INTO has_profile_function;

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created_profile'
  )
  INTO has_profile_trigger;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'user_profiles'
      AND c.contype = 'u'
      AND a.attname = 'user_id'
  ) OR EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'user_profiles'
      AND i.indisunique = true
      AND a.attname = 'user_id'
  )
  INTO has_user_id_unique;

  IF NOT has_profile_function THEN
    RAISE EXCEPTION 'required profile trigger/function missing: public.handle_auth_user_profile_create';
  END IF;
  IF NOT has_profile_trigger THEN
    RAISE EXCEPTION 'required profile trigger/function missing: auth.users trigger on_auth_user_created_profile';
  END IF;
  IF NOT has_user_id_unique THEN
    RAISE EXCEPTION 'required profile constraint missing: unique user_profiles.user_id';
  END IF;
END $$;

