-- Phase 7: Security / reliability hardening
-- - User idempotency keys for user mutation routes (checkout confirm, cancel, etc.)
-- - RLS policies for canonical billing tables (read-only for tenant; writes via service role only)
-- - Correlation id columns where missing (best-effort)

CREATE TABLE IF NOT EXISTS public.user_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_snapshot_json jsonb NOT NULL,
  status_code integer NOT NULL,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS user_idempotency_keys_user_endpoint_created_idx
  ON public.user_idempotency_keys (user_id, endpoint, created_at DESC);

ALTER TABLE public.checkout_sessions
  ADD COLUMN IF NOT EXISTS correlation_id text;

ALTER TABLE public.company_addon_subscriptions
  ADD COLUMN IF NOT EXISTS correlation_id text;

ALTER TABLE public.company_addon_topups
  ADD COLUMN IF NOT EXISTS correlation_id text;

ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS correlation_id text;

-- =========================================================
-- RLS: canonical billing tables
-- =========================================================

ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_addon_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_addon_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company subscriptions read own" ON public.company_subscriptions;
CREATE POLICY "Company subscriptions read own"
ON public.company_subscriptions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = company_subscriptions.company_id
      AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = company_subscriptions.company_id
      AND s.user_id = auth.uid()
      AND lower(coalesce(s.status, '')) = 'active'
      AND coalesce(s.active, false) = true
  )
);

DROP POLICY IF EXISTS "Checkout sessions read own" ON public.checkout_sessions;
CREATE POLICY "Checkout sessions read own"
ON public.checkout_sessions
FOR SELECT
USING (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = checkout_sessions.company_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Billing invoices read own" ON public.billing_invoices;
CREATE POLICY "Billing invoices read own"
ON public.billing_invoices
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = billing_invoices.company_id
      AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = billing_invoices.company_id
      AND s.user_id = auth.uid()
      AND lower(coalesce(s.status, '')) = 'active'
      AND coalesce(s.active, false) = true
  )
);

DROP POLICY IF EXISTS "Addon subscriptions read own" ON public.company_addon_subscriptions;
CREATE POLICY "Addon subscriptions read own"
ON public.company_addon_subscriptions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = company_addon_subscriptions.company_id
      AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = company_addon_subscriptions.company_id
      AND s.user_id = auth.uid()
      AND lower(coalesce(s.status, '')) = 'active'
      AND coalesce(s.active, false) = true
  )
);

DROP POLICY IF EXISTS "Addon topups read own" ON public.company_addon_topups;
CREATE POLICY "Addon topups read own"
ON public.company_addon_topups
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = company_addon_topups.company_id
      AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.seats s
    WHERE s.company_id = company_addon_topups.company_id
      AND s.user_id = auth.uid()
      AND lower(coalesce(s.status, '')) = 'active'
      AND coalesce(s.active, false) = true
  )
);

