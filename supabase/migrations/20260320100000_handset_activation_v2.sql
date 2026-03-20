-- Handset Activation V2 (additive only)
-- Safe migration: no destructive operations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS public.handsets
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS device_name text,
  ADD COLUMN IF NOT EXISTS activated_by uuid,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_handsets_company_device_unique
  ON public.handsets(company_id, device_id)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_handsets_company_status
  ON public.handsets(company_id, status);

CREATE TABLE IF NOT EXISTS public.handset_activation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_by uuid,
  intended_user text,
  max_activations integer NOT NULL DEFAULT 10 CHECK (max_activations > 0),
  activation_count integer NOT NULL DEFAULT 0 CHECK (activation_count >= 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handset_activation_tokens_hash
  ON public.handset_activation_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_handset_activation_tokens_expires_at
  ON public.handset_activation_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_handset_activation_tokens_company_id
  ON public.handset_activation_tokens(company_id);

CREATE TABLE IF NOT EXISTS public.handset_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  handset_id uuid NULL REFERENCES public.handsets(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handset_logs_company_created
  ON public.handset_logs(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_handset_logs_handset_created
  ON public.handset_logs(handset_id, created_at DESC);

ALTER TABLE public.handset_activation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handset_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access handset_activation_tokens" ON public.handset_activation_tokens;
CREATE POLICY "Service role full access handset_activation_tokens"
  ON public.handset_activation_tokens
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access handset_logs" ON public.handset_logs;
CREATE POLICY "Service role full access handset_logs"
  ON public.handset_logs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.activate_handset_v2(
  p_token_hash text,
  p_device_id text,
  p_platform text,
  p_app_version text,
  p_device_name text,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  token_id uuid,
  company_id uuid,
  handset_id uuid,
  activation_count integer,
  max_activations integer,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token public.handset_activation_tokens%ROWTYPE;
  v_handset_id uuid;
BEGIN
  SELECT *
  INTO v_token
  FROM public.handset_activation_tokens
  WHERE token_hash = p_token_hash
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOKEN_NOT_FOUND';
  END IF;

  IF v_token.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'TOKEN_REVOKED';
  END IF;

  IF v_token.expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRED';
  END IF;

  IF v_token.activation_count >= v_token.max_activations THEN
    RAISE EXCEPTION 'TOKEN_EXHAUSTED';
  END IF;

  UPDATE public.handset_activation_tokens
  SET activation_count = activation_count + 1
  WHERE id = v_token.id;

  INSERT INTO public.handsets (
    company_id,
    status,
    device_id,
    platform,
    app_version,
    device_name,
    activated_by,
    activated_at,
    disabled_by,
    disabled_at
  )
  VALUES (
    v_token.company_id,
    'ACTIVE',
    p_device_id,
    lower(coalesce(nullif(p_platform, ''), 'android')),
    nullif(p_app_version, ''),
    nullif(p_device_name, ''),
    p_actor_user_id,
    now(),
    NULL,
    NULL
  )
  ON CONFLICT (company_id, device_id)
  DO UPDATE SET
    status = 'ACTIVE',
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    device_name = EXCLUDED.device_name,
    activated_by = EXCLUDED.activated_by,
    activated_at = now(),
    disabled_by = NULL,
    disabled_at = NULL
  RETURNING id INTO v_handset_id;

  INSERT INTO public.handset_logs (
    company_id,
    handset_id,
    event_type,
    metadata,
    created_by
  )
  VALUES (
    v_token.company_id,
    v_handset_id,
    'token_activated',
    jsonb_build_object(
      'token_id', v_token.id,
      'activation_count', v_token.activation_count + 1,
      'max_activations', v_token.max_activations,
      'device_id', p_device_id,
      'platform', lower(coalesce(nullif(p_platform, ''), 'android'))
    ),
    p_actor_user_id
  );

  RETURN QUERY
  SELECT
    v_token.id,
    v_token.company_id,
    v_handset_id,
    v_token.activation_count + 1,
    v_token.max_activations,
    v_token.expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_handset_v2(text, text, text, text, text, uuid) TO service_role;