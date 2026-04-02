import type {
  PvOrderRowStatus,
  PvOrderSaveRow,
  PvOrderShippingStatus,
  PvOrderStatus,
} from "@/types/pv-orders";

export function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v).trim()
  );
}

export function isDateOnly(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
}

export function clampInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export function isPvOrderRowStatus(value: unknown): value is PvOrderRowStatus {
  return value === "DA_ORDINARE" || value === "EVASO";
}

export function isPvOrderShippingStatus(
  value: unknown
): value is PvOrderShippingStatus {
  return value === "NON_SPEDITO" || value === "PARZIALE" || value === "SPEDITO";
}

export function sanitizePvOrderRows(rows: unknown[]): PvOrderSaveRow[] {
  const clean: PvOrderSaveRow[] = [];

  for (const raw of rows) {
    const item_id = String((raw as any)?.item_id ?? "").trim();
    if (!isUuid(item_id)) continue;

    const qty = clampInt((raw as any)?.qty);
    const qty_ml = clampInt((raw as any)?.qty_ml);
    const qty_gr = clampInt((raw as any)?.qty_gr);

    if (qty <= 0 && qty_ml <= 0 && qty_gr <= 0) continue;

    clean.push({
      item_id,
      qty,
      qty_ml,
      qty_gr,
    });
  }

  return clean;
}

export function derivePvOrderStatus(rowStatuses: Array<string | null | undefined>): PvOrderStatus {
  const valid = rowStatuses
    .map((x) => String(x ?? "").trim().toUpperCase())
    .filter((x) => x === "DA_ORDINARE" || x === "EVASO");

  if (valid.length === 0) return "DA_COMPLETARE";
  return valid.every((x) => x === "EVASO") ? "COMPLETO" : "DA_COMPLETARE";
}

export function summarizePvOrderRows(rows: Array<{ row_status?: string | null }>) {
  let total_rows = 0;
  let pending_rows = 0;
  let evaded_rows = 0;

  for (const row of rows) {
    total_rows += 1;
    const status = String(row.row_status ?? "").trim().toUpperCase();

    if (status === "EVASO") {
      evaded_rows += 1;
    } else {
      pending_rows += 1;
    }
  }

  return {
    total_rows,
    pending_rows,
    evaded_rows,
    order_status: derivePvOrderStatus(rows.map((r) => r.row_status ?? null)),
  };
}