type PartialRecountRow = {
  item_id: string;
  qty: number;
  qty_gr: number;
  qty_ml: number;
  um?: string | null;
  peso_kg?: number | null;
  volume_ml_per_unit?: number | null;
};

type MergePartialRecountArgs = {
  existingRows: PartialRecountRow[];
  incomingRows: PartialRecountRow[];
};

function normalizeRow(row: PartialRecountRow): PartialRecountRow {
  return {
    item_id: String(row.item_id ?? "").trim(),
    qty: Number(row.qty ?? 0) || 0,
    qty_gr: Number(row.qty_gr ?? 0) || 0,
    qty_ml: Number(row.qty_ml ?? 0) || 0,
    um: row.um ?? null,
    peso_kg:
      row.peso_kg === null || row.peso_kg === undefined
        ? null
        : Number(row.peso_kg) || 0,
    volume_ml_per_unit:
      row.volume_ml_per_unit === null || row.volume_ml_per_unit === undefined
        ? null
        : Number(row.volume_ml_per_unit) || 0,
  };
}

export function mergePartialRecount({
  existingRows,
  incomingRows,
}: MergePartialRecountArgs): PartialRecountRow[] {
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

  return Array.from(merged.values()).sort((a, b) =>
    a.item_id.localeCompare(b.item_id)
  );
}