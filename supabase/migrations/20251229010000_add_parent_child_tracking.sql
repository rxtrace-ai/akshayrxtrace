-- Add parent-child tracking for full traceability
-- This migration adds foreign keys to track UNIT → BOX → CARTON → PALLET relationships

-- 1. Add box_id to labels_units (units belong to boxes)
ALTER TABLE labels_units 
ADD COLUMN IF NOT EXISTS box_id uuid REFERENCES boxes(id) ON DELETE SET NULL;

-- 2. Add SSCC columns to boxes
ALTER TABLE boxes 
ADD COLUMN IF NOT EXISTS sscc varchar(18) UNIQUE,
ADD COLUMN IF NOT EXISTS sscc_with_ai text,
ADD COLUMN IF NOT EXISTS sku_id uuid;

-- 3. Add pallet_id to boxes (direct reference for faster queries)
ALTER TABLE boxes 
ADD COLUMN IF NOT EXISTS pallet_id uuid REFERENCES pallets(id) ON DELETE SET NULL;

-- 4. Add SSCC columns to cartons
ALTER TABLE cartons 
ADD COLUMN IF NOT EXISTS sscc varchar(18) UNIQUE,
ADD COLUMN IF NOT EXISTS sscc_with_ai text,
ADD COLUMN IF NOT EXISTS sku_id uuid;

-- 5. Create indexes for faster hierarchy queries
CREATE INDEX IF NOT EXISTS idx_units_box_id ON labels_units(box_id);
CREATE INDEX IF NOT EXISTS idx_boxes_carton_id ON boxes(carton_id);
CREATE INDEX IF NOT EXISTS idx_boxes_pallet_id ON boxes(pallet_id);
CREATE INDEX IF NOT EXISTS idx_cartons_pallet_id ON cartons(pallet_id);
CREATE INDEX IF NOT EXISTS idx_boxes_sscc ON boxes(sscc);
CREATE INDEX IF NOT EXISTS idx_cartons_sscc ON cartons(sscc);
CREATE INDEX IF NOT EXISTS idx_pallets_sscc ON pallets(sscc);
CREATE INDEX IF NOT EXISTS idx_units_serial ON labels_units(serial);

-- 6. Create view for full hierarchy lookup
CREATE OR REPLACE VIEW v_container_hierarchy AS
SELECT 
  'unit' as level,
  u.id,
  u.serial as code,
  u.gs1_payload,
  u.box_id,
  b.sscc as box_sscc,
  b.carton_id,
  c.sscc as carton_sscc,
  c.pallet_id,
  p.sscc as pallet_sscc,
  u.company_id,
  u.sku_id,
  u.created_at
FROM labels_units u
LEFT JOIN boxes b ON u.box_id = b.id
LEFT JOIN cartons c ON b.carton_id = c.id
LEFT JOIN pallets p ON c.pallet_id = p.id

UNION ALL

SELECT 
  'box' as level,
  b.id,
  b.sscc as code,
  NULL as gs1_payload,
  NULL as box_id,
  NULL as box_sscc,
  b.carton_id,
  c.sscc as carton_sscc,
  c.pallet_id,
  p.sscc as pallet_sscc,
  b.company_id,
  b.sku_id,
  b.created_at
FROM boxes b
LEFT JOIN cartons c ON b.carton_id = c.id
LEFT JOIN pallets p ON c.pallet_id = p.id

UNION ALL

SELECT 
  'carton' as level,
  c.id,
  c.sscc as code,
  NULL as gs1_payload,
  NULL as box_id,
  NULL as box_sscc,
  NULL as carton_id,
  NULL as carton_sscc,
  c.pallet_id,
  p.sscc as pallet_sscc,
  c.company_id,
  c.sku_id,
  c.created_at
FROM cartons c
LEFT JOIN pallets p ON c.pallet_id = p.id

UNION ALL

SELECT 
  'pallet' as level,
  p.id,
  p.sscc as code,
  NULL as gs1_payload,
  NULL as box_id,
  NULL as box_sscc,
  NULL as carton_id,
  NULL as carton_sscc,
  NULL as pallet_id,
  NULL as pallet_sscc,
  p.company_id,
  p.sku_id,
  p.created_at
FROM pallets p;

COMMENT ON VIEW v_container_hierarchy IS 'Unified view of all container levels with parent relationships for traceability';
