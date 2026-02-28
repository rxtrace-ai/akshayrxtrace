-- Seat management phase 1:
-- - normalize seat lifecycle for invite/accept flow
-- - centralize entitlement in one RPC
-- - support many-to-many seat <-> plant assignments
-- - provide atomic invitation + acceptance RPCs

ALTER TABLE public.seats
  ADD COLUMN IF NOT EXISTS full_name text;

ALTER TABLE public.seats
  ADD COLUMN IF NOT EXISTS normalized_email text GENERATED ALWAYS AS (
    lower(trim(email))
  ) STORED;

UPDATE public.seats
SET status = 'deactivated',
    active = false
WHERE status IN ('inactive', 'revoked');

ALTER TABLE public.seats
  DROP CONSTRAINT IF EXISTS seats_status_check;

ALTER TABLE public.seats
  ADD CONSTRAINT seats_status_check
  CHECK (status IN ('pending', 'active', 'deactivated', 'expired'));

DROP INDEX IF EXISTS idx_seats_company_email_unique;
CREATE UNIQUE INDEX IF NOT EXISTS seats_company_normalized_email_active_key
  ON public.seats (company_id, normalized_email)
  WHERE status IN ('pending', 'active');

CREATE TABLE IF NOT EXISTS public.seat_limit_profiles (
  plan_code text PRIMARY KEY,
  seat_limit integer NOT NULL CHECK (seat_limit >= 0),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.seat_limit_profiles (plan_code, seat_limit, is_active)
VALUES
  ('starter', 1, true),
  ('starter_monthly', 1, true),
  ('starter_yearly', 2, true),
  ('growth', 5, true),
  ('growth_monthly', 5, true),
  ('growth_yearly', 8, true),
  ('enterprise', 20, true),
  ('enterprise_monthly', 20, true),
  ('enterprise_quarterly', 30, true)
ON CONFLICT (plan_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.company_seat_entitlement_overrides (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  admin_override_limit integer CHECK (admin_override_limit IS NULL OR admin_override_limit >= 0),
  enterprise_override_limit integer CHECK (enterprise_override_limit IS NULL OR enterprise_override_limit >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seat_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id uuid NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  sent_to_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seat_invitations_token_hash_key
  ON public.seat_invitations (token_hash);
CREATE INDEX IF NOT EXISTS seat_invitations_company_status_idx
  ON public.seat_invitations (company_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS seat_invitations_seat_id_idx
  ON public.seat_invitations (seat_id);

CREATE TABLE IF NOT EXISTS public.seat_plant_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  seat_id uuid NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seat_plant_assignments_unique_active
  ON public.seat_plant_assignments (seat_id, plant_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS seat_plant_assignments_company_idx
  ON public.seat_plant_assignments (company_id, seat_id);
CREATE INDEX IF NOT EXISTS seat_plant_assignments_plant_idx
  ON public.seat_plant_assignments (company_id, plant_id);

CREATE OR REPLACE FUNCTION public.validate_seat_plant_assignment_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_seat_company_id uuid;
  v_plant_company_id uuid;
BEGIN
  SELECT s.company_id INTO v_seat_company_id
  FROM public.seats s
  WHERE s.id = NEW.seat_id;

  SELECT p.company_id INTO v_plant_company_id
  FROM public.plants p
  WHERE p.id = NEW.plant_id;

  IF v_seat_company_id IS NULL OR v_plant_company_id IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_ENTITY_NOT_FOUND';
  END IF;

  IF NEW.company_id IS DISTINCT FROM v_seat_company_id
     OR NEW.company_id IS DISTINCT FROM v_plant_company_id THEN
    RAISE EXCEPTION 'ASSIGNMENT_TENANT_MISMATCH';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seat_plant_assignments_tenant_guard ON public.seat_plant_assignments;
CREATE TRIGGER seat_plant_assignments_tenant_guard
BEFORE INSERT OR UPDATE ON public.seat_plant_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_seat_plant_assignment_tenant();

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
  v_company record;
  v_override record;
  v_plan_code text;
  v_alloc integer := 0;
  v_active integer := 0;
  v_blocked boolean := false;
  v_reason text := NULL;
BEGIN
  SELECT
    c.id,
    c.subscription_plan,
    c.trial_started_at,
    c.trial_expires_at,
    c.deleted_at,
    coalesce(c.extra_user_seats, 0) AS extra_user_seats
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company.deleted_at IS NOT NULL THEN
    SELECT count(*)::int INTO v_active
    FROM public.seats s
    WHERE s.company_id = p_company_id
      AND s.status = 'active'
      AND s.active = true;

    RETURN QUERY SELECT 0, v_active, 0, true, 'quota_exceeded';
    RETURN;
  END IF;

  IF v_company.trial_started_at IS NOT NULL THEN
    IF v_company.trial_expires_at IS NULL OR p_now > v_company.trial_expires_at THEN
      v_alloc := 0;
      v_blocked := true;
      v_reason := 'trial_expired';
    ELSE
      v_alloc := 5;
    END IF;
  ELSE
    SELECT
      o.admin_override_limit,
      o.enterprise_override_limit
    INTO v_override
    FROM public.company_seat_entitlement_overrides o
    WHERE o.company_id = p_company_id;

    IF COALESCE(v_override.admin_override_limit, v_override.enterprise_override_limit) IS NOT NULL THEN
      v_alloc := COALESCE(v_override.admin_override_limit, v_override.enterprise_override_limit);
    ELSE
      v_plan_code := lower(coalesce(trim(v_company.subscription_plan), 'starter'));

      SELECT p.seat_limit
      INTO v_alloc
      FROM public.seat_limit_profiles p
      WHERE p.plan_code = v_plan_code
        AND p.is_active = true
      LIMIT 1;

      IF v_alloc IS NULL THEN
        IF v_plan_code LIKE 'growth%' THEN
          v_alloc := 5;
        ELSIF v_plan_code LIKE 'enterprise%' THEN
          v_alloc := 20;
        ELSE
          v_alloc := 1;
        END IF;
      END IF;
    END IF;
  END IF;

  v_alloc := greatest(v_alloc + coalesce(v_company.extra_user_seats, 0), 0);

  SELECT count(*)::int INTO v_active
  FROM public.seats s
  WHERE s.company_id = p_company_id
    AND s.status = 'active'
    AND s.active = true;

  IF NOT v_blocked AND v_active >= v_alloc THEN
    v_blocked := true;
    v_reason := 'quota_exceeded';
  END IF;

  RETURN QUERY
  SELECT
    v_alloc,
    v_active,
    greatest(v_alloc - v_active, 0),
    v_blocked,
    v_reason;
END;
$$;

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
  v_company record;
  v_entitlement record;
  v_wallet_status text;
  v_seat public.seats%ROWTYPE;
  v_email text;
  v_role text;
  v_full_name text;
  v_consumed integer := 0;
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

  SELECT c.id, c.user_id, c.deleted_at
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND';
  END IF;

  IF v_company.user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT cw.status
  INTO v_wallet_status
  FROM public.company_wallets cw
  WHERE cw.company_id = p_company_id
  LIMIT 1;

  IF coalesce(v_wallet_status, 'ACTIVE') = 'FROZEN' THEN
    RAISE EXCEPTION 'COMPANY_FROZEN';
  END IF;

  PERFORM 1
  FROM public.seats s
  WHERE s.company_id = p_company_id
    AND s.status IN ('active', 'pending')
  FOR UPDATE;

  SELECT * INTO v_entitlement
  FROM public.get_seat_entitlement(p_company_id, now());

  IF v_entitlement.reason = 'trial_expired' THEN
    RAISE EXCEPTION 'TRIAL_EXPIRED';
  END IF;

  SELECT count(*)::int INTO v_consumed
  FROM public.seats s
  WHERE s.company_id = p_company_id
    AND s.status IN ('active', 'pending');

  IF v_consumed >= v_entitlement.allocated THEN
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

ALTER TABLE public.seat_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seat_plant_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Seat invitations owner read" ON public.seat_invitations;
CREATE POLICY "Seat invitations owner read"
ON public.seat_invitations
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = seat_invitations.company_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Seat plant assignments own company read" ON public.seat_plant_assignments;
CREATE POLICY "Seat plant assignments own company read"
ON public.seat_plant_assignments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = seat_plant_assignments.company_id
      AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = seat_plant_assignments.company_id
      AND s.user_id = auth.uid()
      AND s.status = 'active'
  )
);

GRANT EXECUTE ON FUNCTION public.get_seat_entitlement(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_seat_invitation_atomic(uuid, uuid, text, text, text, uuid[], text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_seat_invitation_atomic(text, uuid, text) TO authenticated;
