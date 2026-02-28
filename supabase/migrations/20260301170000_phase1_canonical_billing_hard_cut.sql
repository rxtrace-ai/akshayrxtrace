-- Phase 1: Canonical billing hard-cut foundation
-- Objective:
-- - Canonicalize plans/add-ons/coupons/subscriptions for Razorpay-backed billing.
-- - Add combined-checkout orchestration tables.
-- - Prepare single-source entitlement inputs.
-- - Migrate legacy plan/subscription references forward.
-- - Block writes to legacy plan authoring tables.

-- =========================================================
-- 1) Canonical enums
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'addon_kind_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.addon_kind_enum AS ENUM ('structural', 'variable_quota');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'entitlement_key_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.entitlement_key_enum AS ENUM ('seat', 'plant', 'handset', 'unit', 'box', 'carton', 'pallet');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'addon_billing_mode_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.addon_billing_mode_enum AS ENUM ('recurring', 'one_time');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'coupon_scope_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.coupon_scope_enum AS ENUM ('subscription', 'addons', 'both');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'checkout_session_status_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.checkout_session_status_enum AS ENUM (
      'created',
      'quote_locked',
      'subscription_initiated',
      'subscription_paid',
      'topup_initiated',
      'topup_paid',
      'partial_success',
      'completed',
      'failed',
      'expired',
      'cancelled'
    );
  END IF;
END $$;

-- =========================================================
-- 2) Canonical table extensions
-- =========================================================

CREATE TABLE IF NOT EXISTS public.subscription_plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  razorpay_plan_id text NOT NULL,
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  amount_from_razorpay bigint NOT NULL DEFAULT 0 CHECK (amount_from_razorpay >= 0),
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

CREATE TABLE IF NOT EXISTS public.add_ons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  price numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  unit text NOT NULL DEFAULT 'unit',
  recurring boolean NOT NULL DEFAULT false,
  razorpay_item_id text,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  addon_kind public.addon_kind_enum NOT NULL DEFAULT 'variable_quota',
  entitlement_key public.entitlement_key_enum NOT NULL DEFAULT 'unit',
  billing_mode public.addon_billing_mode_enum NOT NULL DEFAULT 'one_time',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('percentage', 'flat')),
  value numeric(12,2) NOT NULL CHECK (value >= 0),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  usage_limit integer,
  usage_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  razorpay_offer_id text,
  scope public.coupon_scope_enum NOT NULL DEFAULT 'both',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  plan_version_id uuid REFERENCES public.subscription_plan_versions(id),
  plan_template_id uuid REFERENCES public.subscription_plan_templates(id),
  razorpay_subscription_id text,
  razorpay_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.subscription_plan_versions
  ADD COLUMN IF NOT EXISTS plant_limit integer NOT NULL DEFAULT 0 CHECK (plant_limit >= 0),
  ADD COLUMN IF NOT EXISTS handset_limit integer NOT NULL DEFAULT 0 CHECK (handset_limit >= 0),
  ADD COLUMN IF NOT EXISTS effective_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS effective_to timestamptz,
  ADD COLUMN IF NOT EXISTS change_note text;

ALTER TABLE IF EXISTS public.add_ons
  ADD COLUMN IF NOT EXISTS addon_kind public.addon_kind_enum,
  ADD COLUMN IF NOT EXISTS entitlement_key public.entitlement_key_enum,
  ADD COLUMN IF NOT EXISTS billing_mode public.addon_billing_mode_enum,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF to_regclass('public.add_ons') IS NOT NULL THEN
    UPDATE public.add_ons
    SET
      addon_kind = CASE
        WHEN lower(coalesce(name, '')) LIKE '%seat%' OR lower(coalesce(name, '')) LIKE '%user%' OR lower(coalesce(name, '')) LIKE '%plant%' OR lower(coalesce(name, '')) LIKE '%handset%' OR lower(coalesce(name, '')) LIKE '%device%'
          THEN 'structural'::public.addon_kind_enum
        ELSE 'variable_quota'::public.addon_kind_enum
      END,
      entitlement_key = CASE
        WHEN lower(coalesce(name, '')) LIKE '%seat%' OR lower(coalesce(name, '')) LIKE '%user%' THEN 'seat'::public.entitlement_key_enum
        WHEN lower(coalesce(name, '')) LIKE '%plant%' THEN 'plant'::public.entitlement_key_enum
        WHEN lower(coalesce(name, '')) LIKE '%handset%' OR lower(coalesce(name, '')) LIKE '%device%' THEN 'handset'::public.entitlement_key_enum
        WHEN lower(coalesce(name, '')) LIKE '%carton%' THEN 'carton'::public.entitlement_key_enum
        WHEN lower(coalesce(name, '')) LIKE '%box%' THEN 'box'::public.entitlement_key_enum
        WHEN lower(coalesce(name, '')) LIKE '%pallet%' OR lower(coalesce(name, '')) LIKE '%sscc%' THEN 'pallet'::public.entitlement_key_enum
        WHEN lower(coalesce(name, '')) LIKE '%unit%' THEN 'unit'::public.entitlement_key_enum
        ELSE 'unit'::public.entitlement_key_enum
      END,
      billing_mode = CASE
        WHEN coalesce(recurring, false) THEN 'recurring'::public.addon_billing_mode_enum
        WHEN lower(coalesce(name, '')) LIKE '%seat%' OR lower(coalesce(name, '')) LIKE '%user%' OR lower(coalesce(name, '')) LIKE '%plant%' OR lower(coalesce(name, '')) LIKE '%handset%' OR lower(coalesce(name, '')) LIKE '%device%'
          THEN 'recurring'::public.addon_billing_mode_enum
        ELSE 'one_time'::public.addon_billing_mode_enum
      END
    WHERE addon_kind IS NULL OR entitlement_key IS NULL OR billing_mode IS NULL;

    UPDATE public.add_ons
    SET addon_kind = coalesce(addon_kind, 'variable_quota'::public.addon_kind_enum),
        entitlement_key = coalesce(entitlement_key, 'unit'::public.entitlement_key_enum),
        billing_mode = coalesce(billing_mode, 'one_time'::public.addon_billing_mode_enum);
  END IF;
END $$;

ALTER TABLE IF EXISTS public.add_ons
  ALTER COLUMN addon_kind SET DEFAULT 'variable_quota',
  ALTER COLUMN entitlement_key SET DEFAULT 'unit',
  ALTER COLUMN billing_mode SET DEFAULT 'one_time';

ALTER TABLE IF EXISTS public.add_ons
  ALTER COLUMN addon_kind SET NOT NULL,
  ALTER COLUMN entitlement_key SET NOT NULL,
  ALTER COLUMN billing_mode SET NOT NULL;

CREATE INDEX IF NOT EXISTS add_ons_kind_active_idx
  ON public.add_ons (addon_kind, is_active, display_order);

CREATE INDEX IF NOT EXISTS add_ons_entitlement_mode_idx
  ON public.add_ons (entitlement_key, billing_mode)
  WHERE is_active = true;

ALTER TABLE IF EXISTS public.discounts
  ADD COLUMN IF NOT EXISTS scope public.coupon_scope_enum,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF to_regclass('public.discounts') IS NOT NULL THEN
    UPDATE public.discounts
    SET scope = coalesce(scope, 'both'::public.coupon_scope_enum);
  END IF;
END $$;

ALTER TABLE IF EXISTS public.discounts
  ALTER COLUMN scope SET DEFAULT 'both',
  ALTER COLUMN scope SET NOT NULL,
  ALTER COLUMN usage_count SET DEFAULT 0;

DO $$
BEGIN
  IF to_regclass('public.discounts') IS NOT NULL THEN
    UPDATE public.discounts
    SET usage_count = 0
    WHERE usage_count IS NULL;
  END IF;
END $$;

DO $$
DECLARE
  v_discounts_reg regclass := to_regclass('public.discounts');
BEGIN
  IF v_discounts_reg IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'discounts_valid_window_check'
         AND conrelid = v_discounts_reg
     ) THEN
    ALTER TABLE public.discounts
      ADD CONSTRAINT discounts_valid_window_check
      CHECK (valid_to IS NULL OR valid_to >= valid_from);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS discounts_scope_active_idx
  ON public.discounts (scope, is_active, valid_from, valid_to);

ALTER TABLE IF EXISTS public.company_subscriptions
  ADD COLUMN IF NOT EXISTS plan_template_id uuid REFERENCES public.subscription_plan_templates(id),
  ADD COLUMN IF NOT EXISTS razorpay_customer_id text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS next_billing_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS company_subscriptions_company_status_idx
  ON public.company_subscriptions (company_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS company_subscriptions_razorpay_subscription_id_idx
  ON public.company_subscriptions (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_subscriptions_plan_template_id_idx
  ON public.company_subscriptions (plan_template_id);

DO $$
DECLARE
  has_duplicates boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_subscriptions'
  ) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.company_subscriptions
      WHERE lower(coalesce(status::text, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due')
      GROUP BY company_id
      HAVING count(*) > 1
    )
    INTO has_duplicates;

    IF has_duplicates THEN
      CREATE INDEX IF NOT EXISTS company_subscriptions_active_paid_scan_idx
        ON public.company_subscriptions (company_id, updated_at DESC)
        WHERE lower(coalesce(status::text, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due');
    ELSE
      CREATE UNIQUE INDEX IF NOT EXISTS company_subscriptions_one_active_paid_idx
        ON public.company_subscriptions (company_id)
        WHERE lower(coalesce(status::text, '')) IN ('active', 'authenticated', 'pending', 'paused', 'past_due');
    END IF;
  END IF;
END $$;

-- =========================================================
-- 3) Canonical lifecycle tables
-- =========================================================

CREATE TABLE IF NOT EXISTS public.company_addon_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  addon_id uuid NOT NULL REFERENCES public.add_ons(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled', 'expired')),
  razorpay_subscription_item_id text,
  checkout_session_id uuid,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  legacy_company_add_on_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS company_addon_subscriptions_legacy_id_key
  ON public.company_addon_subscriptions (legacy_company_add_on_id)
  WHERE legacy_company_add_on_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_addon_subscriptions_company_status_idx
  ON public.company_addon_subscriptions (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS company_addon_subscriptions_addon_idx
  ON public.company_addon_subscriptions (addon_id, status);

CREATE TABLE IF NOT EXISTS public.company_addon_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  addon_id uuid REFERENCES public.add_ons(id),
  entitlement_key public.entitlement_key_enum NOT NULL,
  purchased_quantity bigint NOT NULL CHECK (purchased_quantity > 0),
  consumed_quantity bigint NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('created', 'paid', 'failed', 'cancelled', 'expired', 'consumed')),
  checkout_session_id uuid,
  provider text NOT NULL DEFAULT 'razorpay',
  provider_order_id text,
  provider_payment_id text,
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'INR',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS company_addon_topups_provider_payment_key
  ON public.company_addon_topups (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_addon_topups_company_status_idx
  ON public.company_addon_topups (company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  quote_hash text NOT NULL,
  quote_payload_json jsonb NOT NULL,
  status public.checkout_session_status_enum NOT NULL DEFAULT 'created',
  selected_plan_template_id uuid REFERENCES public.subscription_plan_templates(id),
  selected_plan_version_id uuid REFERENCES public.subscription_plan_versions(id),
  coupon_code text,
  coupon_id uuid REFERENCES public.discounts(id),
  coupon_snapshot_json jsonb,
  subscription_payload_json jsonb,
  topup_payload_json jsonb,
  provider_subscription_id text,
  provider_topup_order_id text,
  totals_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS checkout_sessions_status_expiry_idx
  ON public.checkout_sessions (status, expires_at);

CREATE INDEX IF NOT EXISTS checkout_sessions_owner_created_idx
  ON public.checkout_sessions (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_type text NOT NULL DEFAULT 'subscription'
    CHECK (invoice_type IN ('subscription', 'addon_recurring', 'addon_topup', 'adjustment')),
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('draft', 'issued', 'paid', 'payment_failed', 'void')),
  reference text,
  plan text,
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  base_amount numeric(18,2) DEFAULT 0,
  addons_amount numeric(18,2) DEFAULT 0,
  discount_amount numeric(18,2) DEFAULT 0,
  tax_amount numeric(18,2) DEFAULT 0,
  wallet_applied numeric(18,2) DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  provider text NOT NULL DEFAULT 'razorpay',
  provider_invoice_id text,
  provider_payment_id text,
  provider_subscription_id text,
  period_start timestamptz,
  period_end timestamptz,
  due_at timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  invoice_pdf_url text,
  checkout_session_id uuid REFERENCES public.checkout_sessions(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.billing_invoices
  ADD COLUMN IF NOT EXISTS invoice_type text DEFAULT 'subscription',
  ADD COLUMN IF NOT EXISTS checkout_session_id uuid REFERENCES public.checkout_sessions(id),
  ADD COLUMN IF NOT EXISTS invoice_pdf_url text,
  ADD COLUMN IF NOT EXISTS provider_subscription_id text;

CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_provider_invoice_key
  ON public.billing_invoices (provider, provider_invoice_id)
  WHERE provider_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_invoices_company_created_idx
  ON public.billing_invoices (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'razorpay',
  event_type text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  checkout_session_id uuid REFERENCES public.checkout_sessions(id) ON DELETE SET NULL,
  payload_json jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processing', 'processed', 'failed', 'ignored_duplicate')),
  processed_at timestamptz,
  error_message text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_status_created_idx
  ON public.payment_events (processing_status, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_events_company_created_idx
  ON public.payment_events (company_id, created_at DESC);

-- =========================================================
-- 4) Legacy-to-canonical migration
-- =========================================================

DO $$
BEGIN
  IF to_regclass('public.subscription_plans') IS NOT NULL THEN
    INSERT INTO public.subscription_plan_templates (
      name,
      razorpay_plan_id,
      billing_cycle,
      amount_from_razorpay,
      is_active,
      created_at,
      updated_at
    )
    SELECT
      sp.name,
      COALESCE(NULLIF(sp.razorpay_plan_id, ''), 'legacy:' || sp.id::text),
      CASE
        WHEN lower(coalesce(sp.billing_cycle, 'monthly')) = 'yearly' THEN 'yearly'
        ELSE 'monthly'
      END,
      GREATEST(0, COALESCE(round(sp.base_price * 100), 0))::bigint,
      COALESCE(sp.is_active, true),
      COALESCE(sp.created_at, now()),
      COALESCE(sp.updated_at, now())
    FROM public.subscription_plans sp
    ON CONFLICT (razorpay_plan_id) DO UPDATE
      SET name = EXCLUDED.name,
          billing_cycle = EXCLUDED.billing_cycle,
          amount_from_razorpay = EXCLUDED.amount_from_razorpay,
          is_active = EXCLUDED.is_active,
          updated_at = now();
  END IF;
END $$;

DO $$
DECLARE
  has_max_users boolean := false;
  has_plan_items boolean := false;
  seat_expr text;
  limits_cte text;
  limits_join text;
  sql_text text;
BEGIN
  IF to_regclass('public.subscription_plans') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscription_plans' AND column_name = 'max_users'
  )
  INTO has_max_users;

  SELECT to_regclass('public.plan_items') IS NOT NULL
  INTO has_plan_items;

  seat_expr := CASE WHEN has_max_users THEN 'COALESCE(sp.max_users, 1)' ELSE '1' END;

  IF has_plan_items THEN
    limits_cte := $cte$
      , legacy_limits AS (
          SELECT
            pi.plan_id,
            MAX(CASE WHEN lower(pi.label) LIKE '%unit%' THEN COALESCE(pi.limit_value, NULLIF(regexp_replace(COALESCE(pi.value, ''), '[^0-9]', '', 'g'), '')::int) END) AS unit_limit,
            MAX(CASE WHEN lower(pi.label) LIKE '%box%' THEN COALESCE(pi.limit_value, NULLIF(regexp_replace(COALESCE(pi.value, ''), '[^0-9]', '', 'g'), '')::int) END) AS box_limit,
            MAX(CASE WHEN lower(pi.label) LIKE '%carton%' THEN COALESCE(pi.limit_value, NULLIF(regexp_replace(COALESCE(pi.value, ''), '[^0-9]', '', 'g'), '')::int) END) AS carton_limit,
            MAX(CASE WHEN lower(pi.label) LIKE '%pallet%' OR lower(pi.label) LIKE '%sscc%' THEN COALESCE(pi.limit_value, NULLIF(regexp_replace(COALESCE(pi.value, ''), '[^0-9]', '', 'g'), '')::int) END) AS pallet_limit,
            MAX(CASE WHEN lower(pi.label) LIKE '%seat%' OR lower(pi.label) LIKE '%user%' THEN COALESCE(pi.limit_value, NULLIF(regexp_replace(COALESCE(pi.value, ''), '[^0-9]', '', 'g'), '')::int) END) AS seat_limit,
            MAX(CASE WHEN lower(pi.label) LIKE '%plant%' THEN COALESCE(pi.limit_value, NULLIF(regexp_replace(COALESCE(pi.value, ''), '[^0-9]', '', 'g'), '')::int) END) AS plant_limit,
            MAX(CASE WHEN lower(pi.label) LIKE '%handset%' OR lower(pi.label) LIKE '%device%' THEN COALESCE(pi.limit_value, NULLIF(regexp_replace(COALESCE(pi.value, ''), '[^0-9]', '', 'g'), '')::int) END) AS handset_limit
          FROM public.plan_items pi
          GROUP BY pi.plan_id
        )
    $cte$;
    limits_join := 'LEFT JOIN legacy_limits ll ON ll.plan_id = sp.id';
  ELSE
    limits_cte := '';
    limits_join := '';
  END IF;

  sql_text := format($sql$
    WITH legacy_plans AS (
      SELECT
        sp.id AS legacy_plan_id,
        COALESCE(NULLIF(sp.razorpay_plan_id, ''), 'legacy:' || sp.id::text) AS canonical_razorpay_plan_id
      FROM public.subscription_plans sp
    )
    %s
    INSERT INTO public.subscription_plan_versions (
      template_id,
      version_number,
      unit_limit,
      box_limit,
      carton_limit,
      pallet_limit,
      seat_limit,
      plant_limit,
      handset_limit,
      grace_unit,
      grace_box,
      grace_carton,
      grace_pallet,
      is_active,
      created_at,
      effective_from
    )
    SELECT
      t.id,
      1,
      COALESCE(ll.unit_limit, 0),
      COALESCE(ll.box_limit, 0),
      COALESCE(ll.carton_limit, 0),
      COALESCE(ll.pallet_limit, 0),
      COALESCE(ll.seat_limit, %s),
      COALESCE(ll.plant_limit, 0),
      COALESCE(ll.handset_limit, 0),
      0,
      0,
      0,
      0,
      true,
      now(),
      now()
    FROM legacy_plans lp
    JOIN public.subscription_plans sp ON sp.id = lp.legacy_plan_id
    JOIN public.subscription_plan_templates t
      ON t.razorpay_plan_id = lp.canonical_razorpay_plan_id
    %s
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.subscription_plan_versions v
      WHERE v.template_id = t.id
    );
  $sql$, limits_cte, seat_expr, limits_join);

  EXECUTE sql_text;
END $$;

INSERT INTO public.subscription_plan_versions (
  template_id,
  version_number,
  unit_limit,
  box_limit,
  carton_limit,
  pallet_limit,
  seat_limit,
  plant_limit,
  handset_limit,
  grace_unit,
  grace_box,
  grace_carton,
  grace_pallet,
  is_active,
  created_at,
  effective_from
)
SELECT
  t.id,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
  true,
  now(),
  now()
FROM public.subscription_plan_templates t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.subscription_plan_versions v
  WHERE v.template_id = t.id
);

DO $$
DECLARE
  has_legacy_plan_id boolean := false;
BEGIN
  IF to_regclass('public.company_subscriptions') IS NULL OR to_regclass('public.subscription_plans') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'plan_id'
  )
  INTO has_legacy_plan_id;

  IF has_legacy_plan_id THEN
    EXECUTE $sql$
      WITH plan_map AS (
        SELECT
          sp.id AS legacy_plan_id,
          t.id AS template_id
        FROM public.subscription_plans sp
        JOIN public.subscription_plan_templates t
          ON t.razorpay_plan_id = COALESCE(NULLIF(sp.razorpay_plan_id, ''), 'legacy:' || sp.id::text)
      ),
      active_version AS (
        SELECT DISTINCT ON (v.template_id)
          v.template_id,
          v.id AS plan_version_id
        FROM public.subscription_plan_versions v
        WHERE v.is_active = true
        ORDER BY v.template_id, v.version_number DESC, v.created_at DESC
      )
      UPDATE public.company_subscriptions cs
      SET
        plan_template_id = COALESCE(cs.plan_template_id, pm.template_id),
        plan_version_id = COALESCE(cs.plan_version_id, av.plan_version_id),
        updated_at = now()
      FROM plan_map pm
      LEFT JOIN active_version av ON av.template_id = pm.template_id
      WHERE cs.plan_id = pm.legacy_plan_id
        AND (cs.plan_template_id IS NULL OR cs.plan_version_id IS NULL);
    $sql$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.company_add_ons') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.company_addon_subscriptions (
    company_id,
    addon_id,
    quantity,
    status,
    starts_at,
    legacy_company_add_on_id,
    metadata,
    created_at,
    updated_at
  )
  SELECT
    cao.company_id,
    cao.add_on_id,
    GREATEST(1, COALESCE(cao.quantity, 1)),
    CASE
      WHEN lower(coalesce(cao.status, '')) = 'active' THEN 'active'
      WHEN lower(coalesce(cao.status, '')) = 'cancelled' THEN 'cancelled'
      ELSE 'paused'
    END,
    COALESCE(cao.created_at, now()),
    cao.id,
    '{}'::jsonb,
    COALESCE(cao.created_at, now()),
    COALESCE(cao.updated_at, now())
  FROM public.company_add_ons cao
  ON CONFLICT (legacy_company_add_on_id) DO NOTHING;
END $$;

-- =========================================================
-- 5) Block legacy authoring writes (hard-cut)
-- =========================================================

CREATE OR REPLACE FUNCTION public.block_legacy_billing_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_BILLING_WRITE_BLOCKED'
    USING DETAIL = format('Table "%I" is deprecated. Use canonical admin endpoints and canonical tables.', TG_TABLE_NAME);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.subscription_plans') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_block_legacy_subscription_plans_write ON public.subscription_plans;
    CREATE TRIGGER trg_block_legacy_subscription_plans_write
      BEFORE INSERT OR UPDATE OR DELETE ON public.subscription_plans
      FOR EACH ROW EXECUTE FUNCTION public.block_legacy_billing_writes();
  END IF;

  IF to_regclass('public.plan_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_block_legacy_plan_items_write ON public.plan_items;
    CREATE TRIGGER trg_block_legacy_plan_items_write
      BEFORE INSERT OR UPDATE OR DELETE ON public.plan_items
      FOR EACH ROW EXECUTE FUNCTION public.block_legacy_billing_writes();
  END IF;
END $$;

COMMENT ON TABLE public.checkout_sessions IS
  'Canonical combined checkout orchestrator (subscription leg + topup leg).';

COMMENT ON TABLE public.company_addon_subscriptions IS
  'Recurring structural add-ons (seat/plant/handset).';

COMMENT ON TABLE public.company_addon_topups IS
  'One-time variable quota topups for unit/box/carton/pallet.';
