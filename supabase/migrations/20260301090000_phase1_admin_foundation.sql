-- PHASE 1 ADMIN FOUNDATION
-- Safe, additive migration for Phase 1 locked contract.

-- =========================================================
-- 1) companies: soft delete + freeze reason + status normalization
-- =========================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS freeze_reason text;

CREATE INDEX IF NOT EXISTS companies_deleted_at_idx
  ON public.companies (deleted_at);

-- Normalize legacy status values before applying stricter constraint.
UPDATE public.companies
SET subscription_status = LOWER(subscription_status)
WHERE subscription_status IS NOT NULL
  AND subscription_status <> LOWER(subscription_status);

UPDATE public.companies
SET subscription_status = 'grace'
WHERE subscription_status = 'past_due';

UPDATE public.companies
SET subscription_status = 'suspended'
WHERE subscription_status = 'paused';

UPDATE public.companies
SET subscription_status = 'canceled'
WHERE subscription_status IN ('cancelled', 'cancellation', 'cancel');

UPDATE public.companies
SET subscription_status = 'trial'
WHERE subscription_status IN ('trialing', 'trial_active');

UPDATE public.companies
SET subscription_status = 'active'
WHERE subscription_status = 'upgrade';

UPDATE public.companies
SET subscription_status = 'grace'
WHERE subscription_status = 'pending';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'companies_subscription_status_check'
      AND conrelid = 'public.companies'::regclass
  ) THEN
    ALTER TABLE public.companies DROP CONSTRAINT companies_subscription_status_check;
  END IF;
END $$;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_subscription_status_check
  CHECK (subscription_status IN ('trial','active','grace','suspended','canceled','expired'));

-- Trial-specific field is no longer used as lifecycle source of truth.
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS trial_status;

-- =========================================================
-- 2) Plan template/version model
-- =========================================================

CREATE TABLE IF NOT EXISTS public.subscription_plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  razorpay_plan_id text NOT NULL,
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  amount_from_razorpay bigint NOT NULL CHECK (amount_from_razorpay >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plan_templates_razorpay_plan_id_key
  ON public.subscription_plan_templates (razorpay_plan_id);

CREATE TABLE IF NOT EXISTS public.subscription_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.subscription_plan_templates(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  unit_limit integer NOT NULL DEFAULT 0 CHECK (unit_limit >= 0),
  box_limit integer NOT NULL DEFAULT 0 CHECK (box_limit >= 0),
  carton_limit integer NOT NULL DEFAULT 0 CHECK (carton_limit >= 0),
  pallet_limit integer NOT NULL DEFAULT 0 CHECK (pallet_limit >= 0),
  seat_limit integer NOT NULL DEFAULT 0 CHECK (seat_limit >= 0),
  grace_unit integer NOT NULL DEFAULT 0 CHECK (grace_unit >= 0),
  grace_box integer NOT NULL DEFAULT 0 CHECK (grace_box >= 0),
  grace_carton integer NOT NULL DEFAULT 0 CHECK (grace_carton >= 0),
  grace_pallet integer NOT NULL DEFAULT 0 CHECK (grace_pallet >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number)
);

CREATE INDEX IF NOT EXISTS subscription_plan_versions_template_active_idx
  ON public.subscription_plan_versions (template_id, is_active, version_number DESC);

-- Bind subscriptions to version when available.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_subscriptions'
  ) THEN
    ALTER TABLE public.company_subscriptions
      ADD COLUMN IF NOT EXISTS plan_version_id uuid REFERENCES public.subscription_plan_versions(id);

    CREATE INDEX IF NOT EXISTS company_subscriptions_plan_version_id_idx
      ON public.company_subscriptions (plan_version_id);
  END IF;
END $$;

-- =========================================================
-- 3) Webhook idempotency table
-- =========================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL,
  correlation_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processing','processed','failed','ignored_duplicate')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message text
);

-- Handle legacy webhook_events table shape (if table existed without these columns).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'webhook_events'
  ) THEN
    ALTER TABLE public.webhook_events
      ADD COLUMN IF NOT EXISTS event_id text,
      ADD COLUMN IF NOT EXISTS event_type text,
      ADD COLUMN IF NOT EXISTS payload_json jsonb,
      ADD COLUMN IF NOT EXISTS correlation_id text,
      ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS processed_at timestamptz,
      ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'received',
      ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS error_message text;

    -- Backfill required values to satisfy NOT NULL contract safely.
    UPDATE public.webhook_events
    SET event_id = COALESCE(event_id, id::text, gen_random_uuid()::text)
    WHERE event_id IS NULL;

    UPDATE public.webhook_events
    SET event_type = COALESCE(event_type, 'unknown')
    WHERE event_type IS NULL;

    UPDATE public.webhook_events
    SET payload_json = COALESCE(payload_json, '{}'::jsonb)
    WHERE payload_json IS NULL;

    UPDATE public.webhook_events
    SET received_at = COALESCE(received_at, now())
    WHERE received_at IS NULL;

    UPDATE public.webhook_events
    SET processing_status = COALESCE(processing_status, 'received')
    WHERE processing_status IS NULL;

    UPDATE public.webhook_events
    SET retry_count = COALESCE(retry_count, 0)
    WHERE retry_count IS NULL;

    ALTER TABLE public.webhook_events
      ALTER COLUMN event_id SET NOT NULL,
      ALTER COLUMN event_type SET NOT NULL,
      ALTER COLUMN payload_json SET NOT NULL,
      ALTER COLUMN received_at SET NOT NULL,
      ALTER COLUMN processing_status SET NOT NULL,
      ALTER COLUMN retry_count SET NOT NULL;

    -- Re-apply check safely for status values.
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'webhook_events_processing_status_check'
        AND conrelid = 'public.webhook_events'::regclass
    ) THEN
      ALTER TABLE public.webhook_events DROP CONSTRAINT webhook_events_processing_status_check;
    END IF;

    ALTER TABLE public.webhook_events
      ADD CONSTRAINT webhook_events_processing_status_check
      CHECK (processing_status IN ('received','processing','processed','failed','ignored_duplicate'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_event_id_key
  ON public.webhook_events (event_id);

CREATE INDEX IF NOT EXISTS webhook_events_status_received_idx
  ON public.webhook_events (processing_status, received_at DESC);

-- =========================================================
-- 4) Admin mutation idempotency table
-- =========================================================

CREATE TABLE IF NOT EXISTS public.admin_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_snapshot_json jsonb NOT NULL,
  status_code integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_idempotency_keys_unique_key
  ON public.admin_idempotency_keys (admin_id, endpoint, idempotency_key);

CREATE INDEX IF NOT EXISTS admin_idempotency_keys_created_at_idx
  ON public.admin_idempotency_keys (created_at DESC);

-- =========================================================
-- 5) Admin roles alignment
-- =========================================================

CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name text NOT NULL UNIQUE CHECK (role_name IN ('super_admin','billing_admin','support_admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.admin_roles (role_name)
VALUES ('super_admin'), ('billing_admin'), ('support_admin')
ON CONFLICT (role_name) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admin_users'
  ) THEN
    ALTER TABLE public.admin_users
      ADD COLUMN IF NOT EXISTS role_name text;

    UPDATE public.admin_users
    SET role_name = CASE
      WHEN role IN ('superadmin', 'super_admin') THEN 'super_admin'
      WHEN role IN ('admin', 'billing_admin') THEN 'billing_admin'
      ELSE 'support_admin'
    END
    WHERE role_name IS NULL;

    ALTER TABLE public.admin_users
      ALTER COLUMN role_name SET DEFAULT 'support_admin';

    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'admin_users_role_check'
        AND conrelid = 'public.admin_users'::regclass
    ) THEN
      ALTER TABLE public.admin_users DROP CONSTRAINT admin_users_role_check;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'admin_users_role_name_check'
        AND conrelid = 'public.admin_users'::regclass
    ) THEN
      ALTER TABLE public.admin_users
        ADD CONSTRAINT admin_users_role_name_check
        CHECK (role_name IN ('super_admin','billing_admin','support_admin'));
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'admin_users_role_name_fk'
        AND conrelid = 'public.admin_users'::regclass
    ) THEN
      ALTER TABLE public.admin_users
        ADD CONSTRAINT admin_users_role_name_fk
        FOREIGN KEY (role_name) REFERENCES public.admin_roles(role_name);
    END IF;

    CREATE INDEX IF NOT EXISTS admin_users_role_name_idx
      ON public.admin_users (role_name);
  END IF;
END $$;

-- Keep old role column for backward compatibility in Phase 1.

-- =========================================================
-- 6) Audit logs extensions for correlation and before/after payload
-- =========================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_logs'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN IF NOT EXISTS correlation_id text,
      ADD COLUMN IF NOT EXISTS entity_type text,
      ADD COLUMN IF NOT EXISTS entity_id text,
      ADD COLUMN IF NOT EXISTS before_state_json jsonb,
      ADD COLUMN IF NOT EXISTS after_state_json jsonb;

    CREATE INDEX IF NOT EXISTS audit_logs_correlation_id_idx
      ON public.audit_logs (correlation_id);
  END IF;
END $$;

-- =========================================================
-- 7) Billing invoices fallback marker
-- =========================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'invoices'
  ) THEN
    ALTER TABLE public.invoices
      ADD COLUMN IF NOT EXISTS external_unavailable boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS currency text;

    CREATE INDEX IF NOT EXISTS invoices_company_created_idx
      ON public.invoices (company_id, created_at DESC);
  END IF;
END $$;
