-- ============================================================
-- PHASE 5: Provider snapshot alignment for company_subscriptions
-- ============================================================
-- Goal:
-- Keep Phase 1 provider_* columns in sync with existing Razorpay columns
-- without rewriting the large webhook RPC.
--
-- Notes:
-- - Canonical billing historically uses:
--     company_subscriptions.razorpay_subscription_id / razorpay_customer_id
-- - Phase 1 added:
--     provider, provider_subscription_id, provider_customer_id
-- - This trigger ensures provider_* mirrors Razorpay identifiers whenever missing.

CREATE OR REPLACE FUNCTION public.sync_company_subscriptions_provider_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Always normalize provider when provider_* fields exist.
  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN NEW;
  END IF;

  -- provider defaults to razorpay for now.
  IF NEW.provider IS NULL OR btrim(NEW.provider) = '' THEN
    NEW.provider := 'razorpay';
  END IF;

  -- Mirror Razorpay identifiers into provider_* if missing.
  IF (NEW.provider_subscription_id IS NULL OR btrim(NEW.provider_subscription_id) = '')
     AND NEW.razorpay_subscription_id IS NOT NULL
     AND btrim(NEW.razorpay_subscription_id) <> '' THEN
    NEW.provider_subscription_id := NEW.razorpay_subscription_id;
  END IF;

  IF (NEW.provider_customer_id IS NULL OR btrim(NEW.provider_customer_id) = '')
     AND NEW.razorpay_customer_id IS NOT NULL
     AND btrim(NEW.razorpay_customer_id) <> '' THEN
    NEW.provider_customer_id := NEW.razorpay_customer_id;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN;
  END IF;

  -- Create trigger only once.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_company_subscriptions_provider_sync'
      AND tgrelid = 'public.company_subscriptions'::regclass
  ) THEN
    CREATE TRIGGER trg_company_subscriptions_provider_sync
    BEFORE INSERT OR UPDATE ON public.company_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_company_subscriptions_provider_fields();
  END IF;
END $$;

-- Backfill existing rows (best-effort).
DO $$
BEGIN
  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.company_subscriptions
  SET
    provider = COALESCE(NULLIF(btrim(provider), ''), 'razorpay'),
    provider_subscription_id = COALESCE(NULLIF(btrim(provider_subscription_id), ''), razorpay_subscription_id),
    provider_customer_id = COALESCE(NULLIF(btrim(provider_customer_id), ''), razorpay_customer_id)
  WHERE
    provider IS NULL OR btrim(provider) = ''
    OR provider_subscription_id IS NULL OR btrim(provider_subscription_id) = ''
    OR provider_customer_id IS NULL OR btrim(provider_customer_id) = '';
END $$;

