-- =====================================================
-- Seats Table Migration
-- Creates seats table for user/team management
-- =====================================================

-- Drop existing table and policies if they exist
DROP TABLE IF EXISTS public.seats CASCADE;

-- Create seats table
CREATE TABLE public.seats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT,
  role TEXT DEFAULT 'operator' CHECK (role IN ('admin', 'operator', 'viewer')),
  active BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'revoked')),
  invited_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_seats_company_id ON public.seats(company_id);
CREATE INDEX IF NOT EXISTS idx_seats_user_id ON public.seats(user_id);
CREATE INDEX IF NOT EXISTS idx_seats_email ON public.seats(email);
CREATE INDEX IF NOT EXISTS idx_seats_status ON public.seats(status);
CREATE INDEX IF NOT EXISTS idx_seats_active ON public.seats(active);

-- Enable RLS
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can view their own seat
CREATE POLICY "Users can view own seat"
  ON public.seats
  FOR SELECT
  USING (user_id = auth.uid());

-- RLS policy: Service role can manage all seats (bypass RLS)
-- This allows backend API calls using service role key to manage seats
CREATE POLICY "Service role full access"
  ON public.seats
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add unique constraint: one active seat per email per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_seats_company_email_unique 
  ON public.seats(company_id, email) 
  WHERE status IN ('active', 'pending');

-- Add comment
COMMENT ON TABLE public.seats IS 'User seats/team members for companies. Each seat represents a User ID allocation.';
