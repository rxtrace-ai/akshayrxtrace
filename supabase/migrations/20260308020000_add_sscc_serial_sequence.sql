-- =====================================================
-- SSCC serial reference sequence
-- - Creates a global sequence for SSCC serial references
-- - Exposes a helper function to allocate serial references in batches
-- =====================================================

CREATE SEQUENCE IF NOT EXISTS sscc_serial_seq;

CREATE OR REPLACE FUNCTION public.next_sscc_serial_refs(p_count integer)
RETURNS TABLE(serial_ref_digits text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT lpad(nextval('sscc_serial_seq')::text, 16, '0') AS serial_ref_digits
  FROM generate_series(1, GREATEST(COALESCE(p_count, 0), 0));
$$;

GRANT EXECUTE ON FUNCTION public.next_sscc_serial_refs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_sscc_serial_refs(integer) TO anon;
