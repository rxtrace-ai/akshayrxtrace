-- Zoho Books Integration Schema
-- Stores OAuth tokens, organization config, and sync mappings

-- ====================================
-- ZOHO OAUTH TOKENS
-- ====================================
CREATE TABLE IF NOT EXISTS public.zoho_oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  api_domain TEXT NOT NULL DEFAULT 'https://www.zohoapis.in',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.zoho_oauth_tokens IS 'Stores Zoho Books OAuth tokens with automatic refresh capability';

-- ====================================
-- ZOHO ORGANIZATION CONFIG
-- ====================================
CREATE TABLE IF NOT EXISTS public.zoho_organization_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL UNIQUE,
  organization_name TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'INR',
  currency_symbol TEXT NOT NULL DEFAULT '₹',
  tax_name TEXT DEFAULT 'GST',
  tax_percentage NUMERIC(5, 2) DEFAULT 18.00,
  invoice_prefix TEXT DEFAULT 'INV',
  logo_url TEXT,
  terms TEXT,
  notes TEXT,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.zoho_organization_config IS 'Zoho Books organization settings and branding';

-- ====================================
-- ZOHO ITEM MAPPING
-- ====================================
CREATE TABLE IF NOT EXISTS public.zoho_item_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,
  item_type TEXT NOT NULL, -- 'subscription', 'addon_seat', 'addon_erp', 'label_unit', 'label_box', 'label_carton', 'label_pallet'
  item_name TEXT NOT NULL,
  zoho_item_id TEXT NOT NULL,
  zoho_item_name TEXT NOT NULL,
  unit_price NUMERIC(18, 2) NOT NULL,
  tax_id TEXT,
  account_id TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, item_type)
);

COMMENT ON TABLE public.zoho_item_mapping IS 'Maps RxTrace billing items to Zoho Books items';

-- ====================================
-- ZOHO CONTACT MAPPING
-- ====================================
CREATE TABLE IF NOT EXISTS public.zoho_contact_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL UNIQUE,
  zoho_contact_id TEXT NOT NULL,
  zoho_contact_name TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_status TEXT NOT NULL DEFAULT 'synced', -- 'synced', 'pending', 'failed'
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.zoho_contact_mapping IS 'Maps RxTrace companies to Zoho Books contacts';

-- ====================================
-- INDEXES
-- ====================================
CREATE INDEX IF NOT EXISTS idx_zoho_oauth_tokens_org_id 
  ON public.zoho_oauth_tokens(organization_id);

CREATE INDEX IF NOT EXISTS idx_zoho_org_config_org_id 
  ON public.zoho_organization_config(organization_id);

CREATE INDEX IF NOT EXISTS idx_zoho_item_mapping_org_id 
  ON public.zoho_item_mapping(organization_id);

CREATE INDEX IF NOT EXISTS idx_zoho_item_mapping_type 
  ON public.zoho_item_mapping(item_type);

CREATE INDEX IF NOT EXISTS idx_zoho_contact_mapping_company_id 
  ON public.zoho_contact_mapping(company_id);

CREATE INDEX IF NOT EXISTS idx_zoho_contact_mapping_zoho_id 
  ON public.zoho_contact_mapping(zoho_contact_id);

-- ====================================
-- TRIGGERS FOR UPDATED_AT
-- ====================================
CREATE OR REPLACE FUNCTION public.update_zoho_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zoho_oauth_tokens_updated_at ON public.zoho_oauth_tokens;
CREATE TRIGGER trg_zoho_oauth_tokens_updated_at
  BEFORE UPDATE ON public.zoho_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_zoho_updated_at();

DROP TRIGGER IF EXISTS trg_zoho_org_config_updated_at ON public.zoho_organization_config;
CREATE TRIGGER trg_zoho_org_config_updated_at
  BEFORE UPDATE ON public.zoho_organization_config
  FOR EACH ROW EXECUTE FUNCTION public.update_zoho_updated_at();

DROP TRIGGER IF EXISTS trg_zoho_item_mapping_updated_at ON public.zoho_item_mapping;
CREATE TRIGGER trg_zoho_item_mapping_updated_at
  BEFORE UPDATE ON public.zoho_item_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_zoho_updated_at();

DROP TRIGGER IF EXISTS trg_zoho_contact_mapping_updated_at ON public.zoho_contact_mapping;
CREATE TRIGGER trg_zoho_contact_mapping_updated_at
  BEFORE UPDATE ON public.zoho_contact_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_zoho_updated_at();

-- ====================================
-- ENVIRONMENT VARIABLES (via Supabase Vault)
-- ====================================
-- Store in Supabase Dashboard > Settings > Vault:
-- - zoho_client_id
-- - zoho_client_secret
-- - zoho_redirect_uri (e.g., https://yourdomain.com/api/zoho/oauth/callback)
