-- =========================================
-- FIX STRUTTURA PROGRESSIVI
-- =========================================

DROP INDEX IF EXISTS ux_inventory_progressivi_rows;

CREATE UNIQUE INDEX ux_inventory_progressivi_rows
ON inventory_progressivi_rows (
  pv_id,
  inventory_date,
  inventory_header_id,
  item_code
);


-- =========================================
-- FIX STRUTTURA INVENTARI
-- =========================================

DROP INDEX IF EXISTS inventories_unique_day;

CREATE UNIQUE INDEX inventories_unique_day
ON public.inventories (
  pv_id,
  item_id,
  inventory_date,
  COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(rapid_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
);