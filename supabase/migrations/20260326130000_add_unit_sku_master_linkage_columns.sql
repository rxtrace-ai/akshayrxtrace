ALTER TABLE public.labels_units
  ADD COLUMN IF NOT EXISTS unit_sku_master_id UUID REFERENCES public.unit_sku_master(id) ON DELETE SET NULL;

ALTER TABLE public.boxes
  ADD COLUMN IF NOT EXISTS unit_sku_master_id UUID REFERENCES public.unit_sku_master(id) ON DELETE SET NULL;

ALTER TABLE public.cartons
  ADD COLUMN IF NOT EXISTS unit_sku_master_id UUID REFERENCES public.unit_sku_master(id) ON DELETE SET NULL;

ALTER TABLE public.pallets
  ADD COLUMN IF NOT EXISTS unit_sku_master_id UUID REFERENCES public.unit_sku_master(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_labels_units_unit_sku_master_id
  ON public.labels_units(unit_sku_master_id);

CREATE INDEX IF NOT EXISTS idx_boxes_unit_sku_master_id
  ON public.boxes(unit_sku_master_id);

CREATE INDEX IF NOT EXISTS idx_cartons_unit_sku_master_id
  ON public.cartons(unit_sku_master_id);

CREATE INDEX IF NOT EXISTS idx_pallets_unit_sku_master_id
  ON public.pallets(unit_sku_master_id);
