CREATE TABLE IF NOT EXISTS public.notification_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_delivery_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_delivery_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_delivery_logs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(
  p_event_type text, p_company_id uuid, p_recipient_email text,
  p_idempotency_key text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claimed integer := 0;
BEGIN
  INSERT INTO public.notification_delivery_logs(event_type, company_id, recipient_email, status, idempotency_key, metadata)
  VALUES (p_event_type, p_company_id, p_recipient_email, 'pending', p_idempotency_key, coalesce(p_metadata, '{}'::jsonb))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed > 0 THEN RETURN true; END IF;

  UPDATE public.notification_delivery_logs
  SET status = 'pending', recipient_email = p_recipient_email,
      metadata = coalesce(p_metadata, '{}'::jsonb), last_error = NULL, updated_at = now()
  WHERE idempotency_key = p_idempotency_key
    AND (status = 'failed' OR (status = 'pending' AND updated_at < now() - interval '15 minutes'));
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_notification_delivery(p_idempotency_key text, p_error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notification_delivery_logs
  SET status = CASE WHEN p_error IS NULL THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN p_error IS NULL THEN now() ELSE sent_at END,
      last_error = p_error, updated_at = now()
  WHERE idempotency_key = p_idempotency_key;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_delivery(text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_notification_delivery(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(text, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification_delivery(text, text) TO service_role;
