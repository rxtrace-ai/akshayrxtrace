-- Seat management hardening (phase 2):
-- - ensure invitation acceptance cannot reactivate revoked/deactivated seats
-- - provide atomic seat deactivation that revokes pending invites + assignments

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

CREATE OR REPLACE FUNCTION public.deactivate_seat_atomic(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_seat_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company record;
  v_seat public.seats%ROWTYPE;
BEGIN
  SELECT c.id, c.user_id, c.deleted_at
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id
  FOR UPDATE;

  IF NOT FOUND OR v_company.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company.user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT *
  INTO v_seat
  FROM public.seats s
  WHERE s.id = p_seat_id
    AND s.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEAT_NOT_FOUND';
  END IF;

  IF v_seat.user_id IS NOT NULL AND v_seat.user_id = p_actor_user_id THEN
    RAISE EXCEPTION 'OWNER_SEAT_CANNOT_BE_DEACTIVATED';
  END IF;

  UPDATE public.seats
  SET
    status = 'deactivated',
    active = false,
    user_id = NULL,
    updated_at = now()
  WHERE id = p_seat_id
  RETURNING * INTO v_seat;

  UPDATE public.seat_plant_assignments
  SET
    status = 'deactivated',
    updated_at = now()
  WHERE company_id = p_company_id
    AND seat_id = p_seat_id
    AND status = 'active';

  UPDATE public.seat_invitations
  SET status = 'revoked'
  WHERE company_id = p_company_id
    AND seat_id = p_seat_id
    AND status = 'pending';

  INSERT INTO public.audit_logs (
    action,
    company_id,
    actor,
    status,
    metadata,
    created_at
  )
  VALUES (
    'SEAT_DEACTIVATED',
    p_company_id,
    p_actor_user_id::text,
    'success',
    jsonb_build_object(
      'seat_id', p_seat_id
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'seat', to_jsonb(v_seat)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_seat_invitation_atomic(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_seat_atomic(uuid, uuid, uuid) TO authenticated;
