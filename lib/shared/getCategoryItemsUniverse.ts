export type CategoryUniverseItem = {
  id: string;
  code: string;
  description: string;
  barcode?: string | null;
  prezzo_vendita_eur?: number | null;
  is_active?: boolean | null;
  um?: string | null;
  peso_kg?: number | null;
  volume_ml_per_unit?: number | null;
  category_id?: string | null;
  subcategory_id?: string | null;
};

export type GetCategoryItemsUniverseInput = {
  items: CategoryUniverseItem[];
  resolvedCategoryId: string | null;
  includeInactive?: boolean;
};

export function getCategoryItemsUniverse(
  input: GetCategoryItemsUniverseInput
): CategoryUniverseItem[] {
  const { items, resolvedCategoryId, includeInactive = false } = input;

  if (!resolvedCategoryId) return [];

  return items
    .filter((item) => {
      if (item.category_id !== resolvedCategoryId) return false;
      if (!includeInactive && item.is_active === false) return false;
      return true;
    })
    .sort((a, b) => {
      const codeA = (a.code || "").trim().toLowerCase();
      const codeB = (b.code || "").trim().toLowerCase();

      if (codeA < codeB) return -1;
      if (codeA > codeB) return 1;
      return 0;
    });
}