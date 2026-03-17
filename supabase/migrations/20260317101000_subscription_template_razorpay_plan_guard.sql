-- Ensure subscription plan templates always have a non-null Razorpay plan id.
-- Safe, idempotent migration for drifted environments.

DO $$
BEGIN
  IF to_regclass('public.subscription_plan_templates') IS NULL THEN
    RAISE EXCEPTION 'required table missing: public.subscription_plan_templates';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscription_plan_templates'
      AND column_name = 'razorpay_plan_id'
  ) THEN
    ALTER TABLE public.subscription_plan_templates
      ADD COLUMN razorpay_plan_id text;
  END IF;

  UPDATE public.subscription_plan_templates
  SET razorpay_plan_id = 'legacy:' || id::text
  WHERE razorpay_plan_id IS NULL OR btrim(razorpay_plan_id) = '';

  ALTER TABLE public.subscription_plan_templates
    ALTER COLUMN razorpay_plan_id SET NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS subscription_plan_templates_razorpay_plan_id_key
    ON public.subscription_plan_templates (razorpay_plan_id);
END $$;
