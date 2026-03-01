-- Disable RLS on handset_tokens table to allow service role full access
ALTER TABLE handset_tokens DISABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "Users can view their company tokens" ON handset_tokens;
DROP POLICY IF EXISTS "Users can insert their company tokens" ON handset_tokens;
DROP POLICY IF EXISTS "Users can update their company tokens" ON handset_tokens;

-- Service role should have full access without RLS
