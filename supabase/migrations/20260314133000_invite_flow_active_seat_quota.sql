-- Invite flow fixes:
-- - allow owner OR active admin seat to invite
-- - count only active seats for seat quota enforcement
-- - prevent duplicate member activation for the same company/user

CREATE OR REPLACE FUNCTION public.create_seat_invitation_atomic(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_plant_ids uuid[],
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
  v_entitlement record;
  v_is_frozen boolean;
  v_is_owner boolean := false;
  v_is_admin_seat boolean := false;
  v_seat public.seats%ROWTYPE;
  v_email text;
  v_role text;
  v_full_name text;
  v_active_consumed integer := 0;
  v_plant_count integer := 0;
  v_invitation_id uuid;
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  v_full_name := nullif(trim(coalesce(p_full_name, '')), '');
  v_role := lower(trim(coalesce(p_role, 'operator')));

  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;

  IF p_token_hash IS NULL OR length(trim(p_token_hash)) < 32 THEN
    RAISE EXCEPTION 'INVALID_TOKEN_HASH';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'INVALID_INVITE_EXPIRY';
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

  v_is_owner := (v_company.user_id = p_actor_user_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = p_company_id
      AND s.user_id = p_actor_user_id
      AND s.status = 'active'
      AND s.active = true
      AND s.role = 'admin'
  )
  INTO v_is_admin_seat;

  IF NOT v_is_owner AND NOT v_is_admin_seat THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_is_frozen := COALESCE(v_company.is_frozen, false);
  IF v_is_frozen THEN
    RAISE EXCEPTION 'COMPANY_FROZEN';
  END IF;

  PERFORM 1
  FROM public.seats s
  WHERE s.company_id = p_company_id
    AND s.status IN ('active', 'pending')
  FOR UPDATE;

  SELECT *
  INTO v_entitlement
  FROM public.get_seat_entitlement(p_company_id, now());

  IF v_entitlement.reason = 'trial_expired' THEN
    RAISE EXCEPTION 'TRIAL_EXPIRED';
  END IF;

  -- Seat quota must only count active users; pending invites do not consume active seats.
  SELECT count(*)::int INTO v_active_consumed
  FROM public.seats s
  WHERE s.company_id = p_company_id
    AND s.status = 'active'
    AND coalesce(s.active, false) = true;

  IF v_active_consumed >= v_entitlement.allocated THEN
    RAISE EXCEPTION 'SEAT_QUOTA_EXCEEDED';
  END IF;

  SELECT count(*)::int INTO v_plant_count
  FROM public.plants p
  WHERE p.company_id = p_company_id
    AND p.status = 'active'
    AND p.id = ANY(p_plant_ids);

  IF v_plant_count <> array_length(p_plant_ids, 1) THEN
    RAISE EXCEPTION 'INVALID_PLANT_SELECTION';
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
    v_full_name,
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

  INSERT INTO public.seat_invitations (
    seat_id,
    company_id,
    token_hash,
    sent_to_email,
    status,
    expires_at,
    created_at
  )
  VALUES (
    v_seat.id,
    p_company_id,
    p_token_hash,
    v_email,
    'pending',
    p_expires_at,
    now()
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
    p_actor_user_id::text,
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
    'invitation_id', v_invitation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_seat_invitation_atomic(
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
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;

  SELECT
    i.id AS invitation_id,
    i.company_id,
    i.seat_id,
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

  SELECT *
  INTO v_seat
  FROM public.seats s
  WHERE s.id = v_invite.seat_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEAT_NOT_FOUND';
  END IF;

  IF v_seat.status <> 'pending' OR coalesce(v_seat.active, false) = true THEN
    RAISE EXCEPTION 'INVITATION_REVOKED';
  END IF;

  IF v_seat.normalized_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH';
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
    'seat', to_jsonb(v_seat)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_seat_invitation_atomic(uuid, uuid, text, text, text, uuid[], text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_seat_invitation_atomic(text, uuid, text) TO authenticated;
