-- Align seat invite token hashing with accept API:
-- - raw token: generated in DB (uuid text)
-- - stored hash: sha256 hex
-- - accept API already computes sha256 hex for incoming token

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  v_entitlement record;
  v_is_owner boolean := false;
  v_is_admin_seat boolean := false;
  v_is_frozen boolean := false;

  v_seat public.seats%ROWTYPE;
  v_email text;
  v_role text;

  v_active_consumed integer := 0;
  v_plant_count integer := 0;
  v_invitation_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';

  v_raw_token text;
  v_token_hash text;
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

  v_is_frozen := coalesce(v_company.is_frozen, false);
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

  -- Raw token returned once to API/email. Persist only sha256 hex hash.
  v_raw_token := gen_random_uuid()::text;
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

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
    v_token_hash,
    v_email,
    'pending',
    v_expires_at,
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
    'invite_url', '/accept-invite?token=' || v_raw_token,
    'expires_at', v_expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_seat_invitation_atomic(uuid, text, uuid, uuid[], text) TO authenticated;
