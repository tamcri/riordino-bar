export type PartialRecountRow = {
  item_id: string;
  qty: number;
  qty_gr: number;
  qty_ml: number;
};

export type MergePartialRecountInput = {
  existingRows: PartialRecountRow[];
  incomingRows: PartialRecountRow[];
};

function toSafeInt(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function normalizeRow(row: PartialRecountRow): PartialRecountRow {
  return {
    item_id: String(row.item_id ?? "").trim(),
    qty: toSafeInt(row.qty),
    qty_gr: toSafeInt(row.qty_gr),
    qty_ml: toSafeInt(row.qty_ml),
  };
}

function hasAnyQuantity(row: PartialRecountRow): boolean {
  return row.qty > 0 || row.qty_gr > 0 || row.qty_ml > 0;
}

/**
 * Merge riconteggio parziale:
 * - incomingRows sovrascrive existingRows per item_id
 * - item_id non presenti in incomingRows restano invariati
 * - righe finali tutte a zero vengono rimosse
 */
export function mergePartialRecount(
  input: MergePartialRecountInput
): PartialRecountRow[] {
  const existingRows = Array.isArray(input.existingRows) ? input.existingRows : [];
  const incomingRows = Array.isArray(input.incomingRows) ? input.incomingRows : [];

  const merged = new Map<string, PartialRecountRow>();

  for (const row of existingRows) {
    const normalized = normalizeRow(row);
    if (!normalized.item_id) continue;
    merged.set(normalized.item_id, normalized);
  }

  for (const row of incomingRows) {
    const normalized = normalizeRow(row);
    if (!normalized.item_id) continue;
    merged.set(normalized.item_id, normalized);
  }

  return Array.from(merged.values())
    .filter(hasAnyQuantity)
    .sort((a, b) => a.item_id.localeCompare(b.item_id));
}