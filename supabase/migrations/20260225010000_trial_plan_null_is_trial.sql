-- Trial must NOT depend on subscription plan.
-- Allow plan_id NULL for trial; add is_trial; allow status 'trialing'.

-- 1. plan_id: add if missing (nullable), or drop NOT NULL if present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'plan_id') THEN
    ALTER TABLE company_subscriptions ADD COLUMN plan_id UUID REFERENCES subscription_plans(id);
  ELSE
    ALTER TABLE company_subscriptions ALTER COLUMN plan_id DROP NOT NULL;
  END IF;
END $$;

-- 2. Add is_trial boolean (default false for existing rows)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'is_trial') THEN
    ALTER TABLE company_subscriptions ADD COLUMN is_trial BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- 3. Allow status 'trialing': if column is enum, add enum value; if TEXT, update CHECK
DO $$
DECLARE
  col_udt text;
  con_name text;
BEGIN
  SELECT udt_name INTO col_udt FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'company_subscriptions' AND column_name = 'status';

  IF col_udt = 'subscription_status' THEN
    -- Column is enum: add 'trialing' if not already present
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'subscription_status' AND e.enumlabel = 'trialing'
    ) THEN
      ALTER TYPE subscription_status ADD VALUE 'trialing';
    END IF;
  ELSE
    -- Column is text: drop any CHECK on status (name may be auto-generated), then add new one
    FOR con_name IN
      SELECT c.conname FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'public' AND t.relname = 'company_subscriptions'
        AND c.contype = 'c'
        AND c.conkey IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) AND a.attname = 'status' AND NOT a.attisdropped
        )
    LOOP
      EXECUTE format('ALTER TABLE company_subscriptions DROP CONSTRAINT IF EXISTS %I', con_name);
    END LOOP;
    ALTER TABLE company_subscriptions ADD CONSTRAINT company_subscriptions_status_check
      CHECK (status::text IN ('TRIAL', 'trialing', 'ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED'));
  END IF;
END $$;
