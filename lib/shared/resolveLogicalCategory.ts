export type LogicalCategory = {
  id: string;
  name: string;
  slug?: string | null;
  is_active?: boolean | null;
};

export type LogicalCategoryResult = {
  resolvedCategoryId: string | null;
  resolvedCategoryName: string | null;
  normalizedLabel: string | null;
  status: "by_category_id" | "by_label_match" | "unresolved";
};

export type LogicalCategoryInput = {
  categoryId: string | null;
  label: string | null;
  categories: LogicalCategory[];
};

/**
 * Normalizza una label per confronti sicuri:
 * - trim
 * - lowercase
 * - rimozione accenti
 * - compressione spazi multipli
 */
export function normalizeLogicalCategoryLabel(
  value: string | null | undefined
): string | null {
  if (!value) return null;

  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

/**
 * Risolve la categoria logica a partire da:
 * - categoryId
 * - label
 * - elenco categorie reali
 */
export function resolveLogicalCategory(
  input: LogicalCategoryInput
): LogicalCategoryResult {
  const { categoryId, label, categories } = input;

  const normalizedLabel = normalizeLogicalCategoryLabel(label);

  // Caso 1: category_id presente e valido
  if (categoryId) {
    const foundById = categories.find((category) => category.id === categoryId);

    if (foundById) {
      return {
        resolvedCategoryId: foundById.id,
        resolvedCategoryName: foundById.name,
        normalizedLabel,
        status: "by_category_id",
      };
    }
  }

  // Caso 2: category_id assente, provo a risolvere dalla label
  if (normalizedLabel) {
    const foundByLabel = categories.find((category) => {
      const normalizedCategoryName = normalizeLogicalCategoryLabel(category.name);
      return normalizedCategoryName === normalizedLabel;
    });

    if (foundByLabel) {
      return {
        resolvedCategoryId: foundByLabel.id,
        resolvedCategoryName: foundByLabel.name,
        normalizedLabel,
        status: "by_label_match",
      };
    }
  }

  // Caso 3: nessuna corrispondenza
  return {
    resolvedCategoryId: null,
    resolvedCategoryName: null,
    normalizedLabel,
    status: "unresolved",
  };
}
