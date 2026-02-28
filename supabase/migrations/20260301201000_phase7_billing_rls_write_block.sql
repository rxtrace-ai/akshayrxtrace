-- Phase 7: Explicitly block direct authenticated writes to canonical billing tables.
-- Writes should occur only via service role (bypass RLS) and DB webhook processor.

ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_addon_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_addon_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct writes company_subscriptions" ON public.company_subscriptions;
CREATE POLICY "No direct writes company_subscriptions"
ON public.company_subscriptions
FOR INSERT
WITH CHECK (false);
CREATE POLICY "No direct updates company_subscriptions"
ON public.company_subscriptions
FOR UPDATE
USING (false)
WITH CHECK (false);
CREATE POLICY "No direct deletes company_subscriptions"
ON public.company_subscriptions
FOR DELETE
USING (false);

DROP POLICY IF EXISTS "No direct writes company_addon_subscriptions" ON public.company_addon_subscriptions;
CREATE POLICY "No direct writes company_addon_subscriptions"
ON public.company_addon_subscriptions
FOR INSERT
WITH CHECK (false);
CREATE POLICY "No direct updates company_addon_subscriptions"
ON public.company_addon_subscriptions
FOR UPDATE
USING (false)
WITH CHECK (false);
CREATE POLICY "No direct deletes company_addon_subscriptions"
ON public.company_addon_subscriptions
FOR DELETE
USING (false);

DROP POLICY IF EXISTS "No direct writes company_addon_topups" ON public.company_addon_topups;
CREATE POLICY "No direct writes company_addon_topups"
ON public.company_addon_topups
FOR INSERT
WITH CHECK (false);
CREATE POLICY "No direct updates company_addon_topups"
ON public.company_addon_topups
FOR UPDATE
USING (false)
WITH CHECK (false);
CREATE POLICY "No direct deletes company_addon_topups"
ON public.company_addon_topups
FOR DELETE
USING (false);

DROP POLICY IF EXISTS "No direct writes checkout_sessions" ON public.checkout_sessions;
CREATE POLICY "No direct writes checkout_sessions"
ON public.checkout_sessions
FOR INSERT
WITH CHECK (false);
CREATE POLICY "No direct updates checkout_sessions"
ON public.checkout_sessions
FOR UPDATE
USING (false)
WITH CHECK (false);
CREATE POLICY "No direct deletes checkout_sessions"
ON public.checkout_sessions
FOR DELETE
USING (false);

DROP POLICY IF EXISTS "No direct writes billing_invoices" ON public.billing_invoices;
CREATE POLICY "No direct writes billing_invoices"
ON public.billing_invoices
FOR INSERT
WITH CHECK (false);
CREATE POLICY "No direct updates billing_invoices"
ON public.billing_invoices
FOR UPDATE
USING (false)
WITH CHECK (false);
CREATE POLICY "No direct deletes billing_invoices"
ON public.billing_invoices
FOR DELETE
USING (false);
