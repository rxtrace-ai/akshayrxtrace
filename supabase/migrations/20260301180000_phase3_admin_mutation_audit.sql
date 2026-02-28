-- Phase 3.1 admin control-plane audit hardening
-- Immutable audit ledger for admin mutation APIs

CREATE TABLE IF NOT EXISTS public.admin_mutation_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  endpoint text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_state_json jsonb,
  after_state_json jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_mutation_audit_events_admin_created_idx
  ON public.admin_mutation_audit_events (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_mutation_audit_events_entity_idx
  ON public.admin_mutation_audit_events (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_mutation_audit_events_correlation_idx
  ON public.admin_mutation_audit_events (correlation_id);

CREATE OR REPLACE FUNCTION public.block_admin_mutation_audit_modifications()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_AUDIT_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_admin_mutation_audit_update ON public.admin_mutation_audit_events;
CREATE TRIGGER trg_block_admin_mutation_audit_update
  BEFORE UPDATE ON public.admin_mutation_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.block_admin_mutation_audit_modifications();

DROP TRIGGER IF EXISTS trg_block_admin_mutation_audit_delete ON public.admin_mutation_audit_events;
CREATE TRIGGER trg_block_admin_mutation_audit_delete
  BEFORE DELETE ON public.admin_mutation_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.block_admin_mutation_audit_modifications();

ALTER TABLE public.admin_mutation_audit_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin_rbac_user(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_role_name boolean := false;
  v_has_role boolean := false;
  v_has_is_active boolean := false;
  v_allowed boolean := false;
  v_sql text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF to_regclass('public.admin_users') IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_users'
      AND column_name = 'role_name'
  )
  INTO v_has_role_name;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_users'
      AND column_name = 'role'
  )
  INTO v_has_role;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_users'
      AND column_name = 'is_active'
  )
  INTO v_has_is_active;

  IF NOT v_has_role_name AND NOT v_has_role THEN
    RETURN false;
  END IF;

  v_sql := 'SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE (au.user_id = $1 OR au.id = $1)';

  IF v_has_is_active THEN
    v_sql := v_sql || ' AND coalesce(au.is_active, true) = true';
  END IF;

  IF v_has_role_name AND v_has_role THEN
    v_sql := v_sql || ' AND lower(coalesce(au.role_name, au.role, '''')) IN (''super_admin'', ''superadmin'', ''billing_admin'', ''support_admin'')';
  ELSIF v_has_role_name THEN
    v_sql := v_sql || ' AND lower(coalesce(au.role_name, '''')) IN (''super_admin'', ''superadmin'', ''billing_admin'', ''support_admin'')';
  ELSE
    v_sql := v_sql || ' AND lower(coalesce(au.role, '''')) IN (''super_admin'', ''superadmin'', ''billing_admin'', ''support_admin'', ''admin'')';
  END IF;

  v_sql := v_sql || ')';
  EXECUTE v_sql INTO v_allowed USING p_user_id;
  RETURN coalesce(v_allowed, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_rbac_user(uuid) TO authenticated;

DROP POLICY IF EXISTS "Admin mutation audits read by admins" ON public.admin_mutation_audit_events;
CREATE POLICY "Admin mutation audits read by admins"
ON public.admin_mutation_audit_events
FOR SELECT
USING (
  public.is_admin_rbac_user(auth.uid())
);
