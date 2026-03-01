-- Add printer settings columns to companies table
-- Printer settings are optional and used only for printing, not code generation

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS print_format TEXT CHECK (print_format IN ('PDF', 'EPL', 'ZPL')) DEFAULT 'PDF',
  ADD COLUMN IF NOT EXISTS printer_type TEXT CHECK (printer_type IN ('thermal', 'laser', 'generic')) DEFAULT 'thermal',
  ADD COLUMN IF NOT EXISTS printer_identifier TEXT;

COMMENT ON COLUMN companies.print_format IS 'Preferred print format: PDF (OS print dialog), EPL or ZPL (file download)';
COMMENT ON COLUMN companies.printer_type IS 'Printer type: thermal, laser, or generic (for logs and optimization)';
COMMENT ON COLUMN companies.printer_identifier IS 'User-defined printer identifier (e.g., Zebra-GK420T, Warehouse-01). Used for UI clarity and logs only, not part of GS1 data.';
