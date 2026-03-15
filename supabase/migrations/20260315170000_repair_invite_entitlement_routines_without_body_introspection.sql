-- Repair migration: invite/seat/entitlement routines without reading function bodies.
-- This avoids pg_get_functiondef usage (can fail on malformed function bodies).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Legacy table must not exist in canonical flow.
DROP TABLE IF EXISTS public.company_invites CASCADE;

DO $$
DECLARE
  r record;
BEGIN
  -- Drop known legacy or conflicting function names across all overloads.
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_company_invite',
        'accept_company_invite',
        'invite_user_to_company',
        'accept_seat_invitation_atomic',
        'get_seat_entitlement'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.schema_name, r.proname, r.args);
  END LOOP;
END $$;

-- Canonical wrapper: entitlement source-of-truth is get_company_entitlement_snapshot.
CREATE OR REPLACE FUNCTION public.get_seat_entitlement(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_company_entitlement_snapshot(p_company_id, now());
$$;

-- Canonical invite creator (app signature).
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

-- Compatibility overload requested by ops playbooks.
CREATE OR REPLACE FUNCTION public.create_seat_invitation_atomic(
  p_company_id uuid,
  p_email text,
  p_role text,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plant_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(p.id), '{}'::uuid[])
  INTO v_plant_ids
  FROM public.plants p
  WHERE p.company_id = p_company_id
    AND p.status = 'active';

  IF coalesce(array_length(v_plant_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'PLANT_SELECTION_REQUIRED';
  END IF;

  RETURN public.create_seat_invitation_atomic(
    p_company_id,
    p_email,
    p_created_by,
    v_plant_ids,
    p_role
  );
END;
$$;

-- Canonical acceptor (app signature with email check).
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
  SET status = 'accepted', consumed_at = now()
  WHERE id = v_invite.invitation_id;

  RETURN jsonb_build_object('success', true, 'seat', to_jsonb(v_seat), 'invitation_id', v_invite.invitation_id);
END;
$$;

-- Compatibility overload requested by ops playbooks.
CREATE OR REPLACE FUNCTION public.accept_seat_invitation(
  p_token_hash text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT lower(trim(email::text))
  INTO v_email
  FROM auth.users
  WHERE id = p_user_id;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'EMAIL_REQUIRED';
  END IF;

  RETURN public.accept_seat_invitation(p_token_hash, p_user_id, v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_seat_entitlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_seat_invitation_atomic(uuid, text, uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_seat_invitation_atomic(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_seat_invitation(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_seat_invitation(text, uuid) TO authenticated;

DO $$
DECLARE
  has_token_hash boolean;
  has_company_invites boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='seat_invitations' AND column_name='token_hash'
  ) INTO has_token_hash;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='company_invites'
  ) INTO has_company_invites;

  IF NOT has_token_hash THEN
    RAISE EXCEPTION 'schema_assert_failed: seat_invitations.token_hash missing';
  END IF;
  IF has_company_invites THEN
    RAISE EXCEPTION 'schema_assert_failed: company_invites must not exist';
  END IF;
END $$;
