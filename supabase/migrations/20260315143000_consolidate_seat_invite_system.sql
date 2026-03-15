-- Canonical seat invitation system consolidation
-- - Removes legacy company_invites flow
-- - Enforces canonical seat/seat_invitations schema
-- - Replaces invite/accept RPCs with deterministic seat flow
-- - Aligns entitlement wrapper to canonical snapshot service

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS public.company_invites CASCADE;

DO $$
BEGIN
  -- seats.normalized_email must exist
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seats' AND column_name = 'normalized_email'
  ) THEN
    ALTER TABLE public.seats
      ADD COLUMN normalized_email text GENERATED ALWAYS AS (lower(trim(email))) STORED;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_seats_company_id ON public.seats(company_id);
  CREATE INDEX IF NOT EXISTS idx_seats_normalized_email ON public.seats(normalized_email);
END $$;

DO $$
BEGIN
  -- Canonical invitation attributes
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seat_invitations' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.seat_invitations ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seat_invitations' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.seat_invitations ADD COLUMN role text;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seat_invitations' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.seat_invitations ADD COLUMN created_by uuid;
  END IF;
END $$;

UPDATE public.seat_invitations i
SET
  email = COALESCE(i.email, i.sent_to_email, s.email),
  role = COALESCE(i.role, s.role)
FROM public.seats s
WHERE s.id = i.seat_id
  AND (i.email IS NULL OR i.role IS NULL);

-- Normalize in-table copy for canonical behavior
UPDATE public.seat_invitations
SET email = lower(trim(email))
WHERE email IS NOT NULL;

ALTER TABLE public.seat_invitations
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN role SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS seat_invitations_company_email_unique
  ON public.seat_invitations (company_id, email);
CREATE INDEX IF NOT EXISTS seat_invitations_token_hash_idx
  ON public.seat_invitations (token_hash);
CREATE INDEX IF NOT EXISTS seat_invitations_company_idx
  ON public.seat_invitations (company_id);

DO $$
DECLARE
  r record;
BEGIN
  -- Remove legacy/duplicate invite RPC names if present (any signature overload)
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_company_invite',
        'accept_company_invite',
        'invite_user_to_company',
        'accept_seat_invitation_atomic'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.schema_name, r.proname, r.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_seat_entitlement(
  p_company_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  allocated integer,
  active integer,
  remaining integer,
  blocked boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_state text;
  v_alloc int;
  v_active int;
  v_remaining int;
BEGIN
  v_snapshot := public.get_company_entitlement_snapshot(p_company_id, p_now);
  v_state := coalesce(v_snapshot->>'state', 'NO_ACTIVE_SUBSCRIPTION');
  v_alloc := coalesce((v_snapshot #>> '{limits,seat}')::int, 0);
  v_active := coalesce((v_snapshot #>> '{usage,seat}')::int, 0);
  v_remaining := coalesce((v_snapshot #>> '{remaining,seat}')::int, 0);

  RETURN QUERY
  SELECT
    greatest(v_alloc, 0),
    greatest(v_active, 0),
    greatest(v_remaining, 0),
    (v_state IN ('TRIAL_EXPIRED', 'NO_ACTIVE_SUBSCRIPTION', 'TRIAL_CANCELLED') OR v_remaining <= 0),
    CASE
      WHEN v_state = 'TRIAL_EXPIRED' THEN 'trial_expired'
      WHEN v_state IN ('NO_ACTIVE_SUBSCRIPTION', 'TRIAL_CANCELLED') THEN 'quota_exceeded'
      WHEN v_remaining <= 0 THEN 'quota_exceeded'
      ELSE NULL
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_seat_invitation_atomic(
  p_company_id uuid,
  p_email text,
  p_invited_by uuid,
  p_plant_ids uuid[],
  p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
  v_snapshot jsonb;
  v_is_owner boolean := false;
  v_is_admin_seat boolean := false;
  v_seat public.seats%ROWTYPE;
  v_email text;
  v_role text;
  v_invitation_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
  v_raw_token text;
  v_token_hash text;
  v_alloc int := 0;
  v_active int := 0;
  v_state text := 'NO_ACTIVE_SUBSCRIPTION';
  v_plant_count integer := 0;
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  v_role := lower(trim(coalesce(p_role, 'operator')));

  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;

  IF v_role NOT IN ('admin', 'operator', 'viewer') THEN
    RAISE EXCEPTION 'INVALID_ROLE';
  END IF;

  IF p_plant_ids IS NULL OR coalesce(array_length(p_plant_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'PLANT_SELECTION_REQUIRED';
  END IF;

  SELECT c.*
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id
  FOR UPDATE;

  IF NOT FOUND OR v_company.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  v_is_owner := (v_company.user_id = p_invited_by);

  SELECT EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = p_company_id
      AND s.user_id = p_invited_by
      AND s.status = 'active'
      AND s.active = true
      AND s.role = 'admin'
  )
  INTO v_is_admin_seat;

  IF NOT v_is_owner AND NOT v_is_admin_seat THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT count(*)::int INTO v_plant_count
  FROM public.plants p
  WHERE p.company_id = p_company_id
    AND p.status = 'active'
    AND p.id = ANY(p_plant_ids);

  IF v_plant_count <> array_length(p_plant_ids, 1) THEN
    RAISE EXCEPTION 'INVALID_PLANT_SELECTION';
  END IF;

  v_snapshot := public.get_company_entitlement_snapshot(p_company_id, now());
  v_state := coalesce(v_snapshot->>'state', 'NO_ACTIVE_SUBSCRIPTION');
  v_alloc := coalesce((v_snapshot #>> '{limits,seat}')::int, 0);

  SELECT count(*)::int INTO v_active
  FROM public.seats s
  WHERE s.company_id = p_company_id
    AND s.status = 'active'
    AND coalesce(s.active, false) = true;

  IF v_state = 'TRIAL_EXPIRED' THEN
    RAISE EXCEPTION 'TRIAL_EXPIRED';
  END IF;

  IF v_state IN ('NO_ACTIVE_SUBSCRIPTION', 'TRIAL_CANCELLED') OR v_active >= v_alloc THEN
    RAISE EXCEPTION 'SEAT_QUOTA_EXCEEDED';
  END IF;

  SELECT *
  INTO v_seat
  FROM public.seats s
  WHERE s.company_id = p_company_id
    AND s.normalized_email = v_email
    AND s.status IN ('active', 'pending')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'SEAT_ALREADY_EXISTS';
  END IF;

  INSERT INTO public.seats (
    company_id,
    user_id,
    email,
    full_name,
    role,
    active,
    status,
    invited_at,
    activated_at,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    NULL,
    v_email,
    NULL,
    v_role,
    false,
    'pending',
    now(),
    NULL,
    now(),
    now()
  )
  RETURNING * INTO v_seat;

  INSERT INTO public.seat_plant_assignments (
    company_id,
    seat_id,
    plant_id,
    status
  )
  SELECT
    p_company_id,
    v_seat.id,
    p_id,
    'active'
  FROM unnest(p_plant_ids) AS p_id;

  v_raw_token := gen_random_uuid()::text;
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  INSERT INTO public.seat_invitations (
    seat_id,
    company_id,
    email,
    role,
    token_hash,
    sent_to_email,
    status,
    expires_at,
    created_at,
    created_by
  )
  VALUES (
    v_seat.id,
    p_company_id,
    v_email,
    v_role,
    v_token_hash,
    v_email,
    'pending',
    v_expires_at,
    now(),
    p_invited_by
  )
  RETURNING id INTO v_invitation_id;

  INSERT INTO public.audit_logs (
    action,
    company_id,
    actor,
    status,
    metadata,
    created_at
  )
  VALUES (
    'SEAT_INVITED',
    p_company_id,
    p_invited_by::text,
    'success',
    jsonb_build_object(
      'seat_id', v_seat.id,
      'invitation_id', v_invitation_id,
      'email', v_email
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'seat', to_jsonb(v_seat),
    'invitation_id', v_invitation_id,
    'token', v_raw_token,
    'invite_url', '/invite/accept?token=' || v_raw_token,
    'expires_at', v_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_seat_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite record;
  v_seat public.seats%ROWTYPE;
  v_email text;
  v_snapshot jsonb;
  v_alloc int := 0;
  v_active int := 0;
  v_state text := 'NO_ACTIVE_SUBSCRIPTION';
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;

  SELECT
    i.id AS invitation_id,
    i.company_id,
    i.seat_id,
    i.email AS invitation_email,
    i.status AS invitation_status,
    i.expires_at,
    i.consumed_at
  INTO v_invite
  FROM public.seat_invitations i
  WHERE i.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND';
  END IF;

  IF v_invite.invitation_status = 'revoked' THEN
    RAISE EXCEPTION 'INVITATION_REVOKED';
  END IF;

  IF v_invite.invitation_status <> 'pending' OR v_invite.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_USED';
  END IF;

  IF now() > v_invite.expires_at THEN
    UPDATE public.seat_invitations
    SET status = 'expired'
    WHERE id = v_invite.invitation_id;
    RAISE EXCEPTION 'INVITATION_EXPIRED';
  END IF;

  IF lower(trim(coalesce(v_invite.invitation_email, ''))) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH';
  END IF;

  SELECT *
  INTO v_seat
  FROM public.seats s
  WHERE s.id = v_invite.seat_id
    AND s.company_id = v_invite.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEAT_NOT_FOUND';
  END IF;

  IF v_seat.status <> 'pending' OR coalesce(v_seat.active, false) = true THEN
    RAISE EXCEPTION 'INVITATION_REVOKED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = v_invite.company_id
      AND s.user_id = p_user_id
      AND s.status = 'active'
      AND coalesce(s.active, false) = true
      AND s.id <> v_seat.id
  ) THEN
    RAISE EXCEPTION 'USER_ALREADY_MEMBER';
  END IF;

  -- Re-check seat capacity at acceptance time to prevent over-subscription races.
  v_snapshot := public.get_company_entitlement_snapshot(v_invite.company_id, now());
  v_state := coalesce(v_snapshot->>'state', 'NO_ACTIVE_SUBSCRIPTION');
  v_alloc := coalesce((v_snapshot #>> '{limits,seat}')::int, 0);

  SELECT count(*)::int INTO v_active
  FROM public.seats s
  WHERE s.company_id = v_invite.company_id
    AND s.status = 'active'
    AND coalesce(s.active, false) = true;

  IF v_state IN ('TRIAL_EXPIRED', 'NO_ACTIVE_SUBSCRIPTION', 'TRIAL_CANCELLED') OR v_active >= v_alloc THEN
    RAISE EXCEPTION 'SEAT_LIMIT_EXCEEDED';
  END IF;

  UPDATE public.seats
  SET
    user_id = p_user_id,
    status = 'active',
    active = true,
    activated_at = now(),
    updated_at = now()
  WHERE id = v_seat.id
  RETURNING * INTO v_seat;

  UPDATE public.seat_invitations
  SET
    status = 'accepted',
    consumed_at = now()
  WHERE id = v_invite.invitation_id;

  INSERT INTO public.audit_logs (
    action,
    company_id,
    actor,
    status,
    metadata,
    created_at
  )
  VALUES (
    'SEAT_ACTIVATED',
    v_invite.company_id,
    p_user_id::text,
    'success',
    jsonb_build_object(
      'seat_id', v_seat.id,
      'invitation_id', v_invite.invitation_id
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'seat', to_jsonb(v_seat),
    'invitation_id', v_invite.invitation_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_seat_invitation_atomic(uuid, text, uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_seat_invitation(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seat_entitlement(uuid, timestamptz) TO authenticated;

DO $$
DECLARE
  has_token_hash boolean;
  has_normalized_email boolean;
  has_subscription_plan boolean;
  has_company_invites boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='seat_invitations' AND column_name='token_hash'
  ) INTO has_token_hash;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='seats' AND column_name='normalized_email'
  ) INTO has_normalized_email;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies' AND column_name='subscription_plan'
  ) INTO has_subscription_plan;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='company_invites'
  ) INTO has_company_invites;

  IF NOT has_token_hash THEN
    RAISE EXCEPTION 'schema_assert_failed: seat_invitations.token_hash missing';
  END IF;
  IF NOT has_normalized_email THEN
    RAISE EXCEPTION 'schema_assert_failed: seats.normalized_email missing';
  END IF;
  IF has_subscription_plan THEN
    RAISE EXCEPTION 'schema_assert_failed: companies.subscription_plan must not exist';
  END IF;
  IF has_company_invites THEN
    RAISE EXCEPTION 'schema_assert_failed: company_invites must not exist';
  END IF;
END $$;
