import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const PV_STOCK_CODE = "PV-STOCK";
export const PV_STOCK_NAME = "Giacenze PV";

type ItemMeta = {
  id: string;
  code: string;
  volume_ml_per_unit: number | null;
  peso_kg: number | null;
  um: string | null;
};

type InventoryRowMini = {
  item_id: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
};

type InventoryRowDb = {
  item_id: string | null;
  qty: number | null;
  qty_ml: number | null;
  qty_gr: number | null;
  inventory_date: string | null;
  created_at: string | null;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastErr: any = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      // Retry SOLO su errori di fetch/rete
      const isFetchFail = msg.toLowerCase().includes("fetch failed") || msg.toLowerCase().includes("network");
      if (!isFetchFail || i === attempts - 1) break;
      await sleep(250 * Math.pow(2, i)); // 250ms, 500ms, 1000ms
      console.warn(`[PV-STOCK][retry] ${label} attempt ${i + 2}/${attempts} after: ${msg}`);
    }
  }

  throw lastErr;
}

function toNumberOrNull(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function sanitizeCode(v: any): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\u00A0/g, "");
}

function normUm(v: any): string {
  return String(v ?? "").trim().toUpperCase();
}

async function getOrCreatePvStockDepositId(pv_id: string): Promise<string> {
  const { data: dep, error: depErr } = await withRetry(
    async () =>
      supabaseAdmin.from("deposits").select("id").eq("pv_id", pv_id).eq("code", PV_STOCK_CODE).maybeSingle(),
    "get deposit",
    3
  );

  if (depErr) throw new Error(depErr.message);
  if (dep?.id) return String(dep.id);

  const { data: created, error: insErr } = await withRetry(
    async () =>
      supabaseAdmin
        .from("deposits")
        .insert({ pv_id, code: PV_STOCK_CODE, name: PV_STOCK_NAME, is_active: true })
        .select("id")
        .single(),
    "create deposit",
    3
  );

  if (insErr) throw new Error(insErr.message);
  return String((created as any)?.id);
}

export async function ensurePvStockDepositId(pv_id: string) {
  const deposit_id = await getOrCreatePvStockDepositId(String(pv_id));
  return { ok: true, deposit_id };
}

function computeStockQty(row: InventoryRowMini, meta: ItemMeta): number {
  const um = normUm(meta.um);

  if (meta.volume_ml_per_unit && meta.volume_ml_per_unit > 0) {
    return Math.max(0, Math.trunc(Number(row.qty_ml) || 0));
  }

  if (um === "KG" && meta.peso_kg && meta.peso_kg > 0) {
    const perPieceGr = Math.round(meta.peso_kg * 1000);
    const pz = Math.max(0, Math.trunc(Number(row.qty) || 0));
    const openGr = Math.max(0, Math.trunc(Number(row.qty_gr) || 0));
    return Math.max(0, Math.trunc(pz * perPieceGr + openGr));
  }

  return Math.max(0, Math.trunc(Number(row.qty) || 0));
}

export async function backfillPvStockMissingItemsFromInventories(args: {
  pv_id: string;
  deposit_id?: string | null;
  max_missing_to_fill?: number;
  max_inventory_rows_to_scan?: number;
}) {
  const pv_id = String(args.pv_id || "").trim();
  if (!pv_id) throw new Error("pv_id mancante");

  const deposit_id = String(args.deposit_id || "").trim() || (await getOrCreatePvStockDepositId(pv_id));

  const maxMissing = Math.max(50, Math.trunc(Number(args.max_missing_to_fill ?? 2000)));
  const maxScan = Math.max(5000, Math.trunc(Number(args.max_inventory_rows_to_scan ?? 120000)));

  const existingIds = new Set<string>();
  {
    const { data, error } = await withRetry(
      async () => supabaseAdmin.from("deposit_items").select("item_id").eq("deposit_id", deposit_id).limit(10000),
      "read deposit_items existing",
      3
    );
    if (error) throw new Error(error.message);
    for (const r of Array.isArray(data) ? data : []) {
      const id = String((r as any)?.item_id ?? "").trim();
      if (id) existingIds.add(id);
    }
  }

  const latestMissing = new Map<string, InventoryRowMini>();

  const pageSize = 5000;
  let offset = 0;
  let scanned = 0;

  while (latestMissing.size < maxMissing && scanned < maxScan) {
    const { data: rows, error } = await withRetry(
      async () =>
        supabaseAdmin
          .from("inventories")
          .select("item_id, qty, qty_ml, qty_gr, inventory_date, created_at")
          .eq("pv_id", pv_id)
          .order("inventory_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1),
      "scan inventories (backfill)",
      3
    );

    if (error) throw new Error(error.message);

    const list = (Array.isArray(rows) ? rows : []) as any as InventoryRowDb[];
    if (list.length === 0) break;

    for (const r of list) {
      const item_id = String((r as any)?.item_id ?? "").trim();
      if (!item_id) continue;
      if (existingIds.has(item_id)) continue;
      if (latestMissing.has(item_id)) continue;

      latestMissing.set(item_id, {
        item_id,
        qty: Math.max(0, Math.trunc(Number((r as any).qty) || 0)),
        qty_ml: Math.max(0, Math.trunc(Number((r as any).qty_ml) || 0)),
        qty_gr: Math.max(0, Math.trunc(Number((r as any).qty_gr) || 0)),
      });

      if (latestMissing.size >= maxMissing) break;
    }

    scanned += list.length;
    offset += pageSize;
  }

  if (latestMissing.size === 0) {
    return { ok: true, deposit_id, filled: 0, scanned_rows: scanned, note: "Nessun item mancante" };
  }

  const ids = Array.from(latestMissing.keys());
  const metaById = new Map<string, ItemMeta>();
  const chunkSize = 1000;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);

    const { data, error } = await withRetry(
      async () => supabaseAdmin.from("items").select("id, code, volume_ml_per_unit, peso_kg, um").in("id", chunk),
      "read items meta (backfill)",
      3
    );

    if (error) throw new Error(error.message);

    for (const m of Array.isArray(data) ? data : []) {
      if (!m?.id) continue;
      metaById.set(String(m.id), {
        id: String(m.id),
        code: sanitizeCode((m as any).code),
        volume_ml_per_unit: toNumberOrNull((m as any).volume_ml_per_unit),
        peso_kg: toNumberOrNull((m as any).peso_kg),
        um: String((m as any).um ?? "").trim() || null,
      });
    }
  }

  const upserts: any[] = [];
  for (const [item_id, row] of latestMissing.entries()) {
    const meta = metaById.get(item_id);
    if (!meta) continue;
    const stock_qty = computeStockQty(row, meta);
    if (stock_qty <= 0) continue;

    upserts.push({
      deposit_id,
      item_id,
      imported_code: meta.code || null,
      note_description: null,
      stock_qty,
      is_active: true,
    });
  }

  if (upserts.length === 0) return { ok: true, deposit_id, filled: 0, scanned_rows: scanned, note: "Tutti a 0" };

  for (let i = 0; i < upserts.length; i += chunkSize) {
    const chunk = upserts.slice(i, i + chunkSize);
    const { error } = await withRetry(
      async () => supabaseAdmin.from("deposit_items").upsert(chunk as any, { onConflict: "deposit_id,item_id" } as any),
      "upsert deposit_items (backfill)",
      3
    );
    if (error) throw new Error(error.message);
  }

  return { ok: true, deposit_id, filled: upserts.length, scanned_rows: scanned };
}

export async function rebuildPvStockFromInventories(args: {
  pv_id: string;
  deposit_id?: string | null;
  max_items_to_build?: number;
  max_inventory_rows_to_scan?: number;
}) {
  const pv_id = String(args.pv_id || "").trim();
  if (!pv_id) throw new Error("pv_id mancante");

  const deposit_id = String(args.deposit_id || "").trim() || (await getOrCreatePvStockDepositId(pv_id));

  const maxItems = Math.max(200, Math.trunc(Number(args.max_items_to_build ?? 6500)));
  const maxScan = Math.max(5000, Math.trunc(Number(args.max_inventory_rows_to_scan ?? 200000)));

  const latestByItem = new Map<string, InventoryRowMini>();

  const pageSize = 5000;
  let offset = 0;
  let scanned = 0;

  while (latestByItem.size < maxItems && scanned < maxScan) {
    const { data: rows, error } = await withRetry(
      async () =>
        supabaseAdmin
          .from("inventories")
          .select("item_id, qty, qty_ml, qty_gr, inventory_date, created_at")
          .eq("pv_id", pv_id)
          .order("inventory_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1),
      "scan inventories (rebuild)",
      3
    );

    if (error) throw new Error(error.message);

    const list = (Array.isArray(rows) ? rows : []) as any as InventoryRowDb[];
    if (list.length === 0) break;

    for (const r of list) {
      const item_id = String((r as any)?.item_id ?? "").trim();
      if (!item_id) continue;
      if (latestByItem.has(item_id)) continue;

      latestByItem.set(item_id, {
        item_id,
        qty: Math.max(0, Math.trunc(Number((r as any).qty) || 0)),
        qty_ml: Math.max(0, Math.trunc(Number((r as any).qty_ml) || 0)),
        qty_gr: Math.max(0, Math.trunc(Number((r as any).qty_gr) || 0)),
      });

      if (latestByItem.size >= maxItems) break;
    }

    scanned += list.length;
    offset += pageSize;
  }

  if (latestByItem.size === 0) {
    return { ok: true, deposit_id, rebuilt: 0, scanned_rows: scanned, note: "Nessun inventario" };
  }

  const ids = Array.from(latestByItem.keys());
  const metaById = new Map<string, ItemMeta>();
  const chunkSize = 1000;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);

    const { data, error } = await withRetry(
      async () => supabaseAdmin.from("items").select("id, code, volume_ml_per_unit, peso_kg, um").in("id", chunk),
      "read items meta (rebuild)",
      3
    );

    if (error) throw new Error(error.message);

    for (const m of Array.isArray(data) ? data : []) {
      if (!m?.id) continue;
      metaById.set(String(m.id), {
        id: String(m.id),
        code: sanitizeCode((m as any).code),
        volume_ml_per_unit: toNumberOrNull((m as any).volume_ml_per_unit),
        peso_kg: toNumberOrNull((m as any).peso_kg),
        um: String((m as any).um ?? "").trim() || null,
      });
    }
  }

  const upserts: any[] = [];
  for (const [item_id, row] of latestByItem.entries()) {
    const meta = metaById.get(item_id);
    if (!meta) continue;

    const stock_qty = computeStockQty(row, meta);
    if (stock_qty <= 0) continue;

    upserts.push({
      deposit_id,
      item_id,
      imported_code: meta.code || null,
      note_description: null,
      stock_qty,
      is_active: true,
    });
  }

  if (upserts.length === 0) {
    return { ok: true, deposit_id, rebuilt: 0, scanned_rows: scanned, note: "Rebuild: tutti a 0" };
  }

  for (let i = 0; i < upserts.length; i += chunkSize) {
    const chunk = upserts.slice(i, i + chunkSize);
    const { error } = await withRetry(
      async () => supabaseAdmin.from("deposit_items").upsert(chunk as any, { onConflict: "deposit_id,item_id" } as any),
      "upsert deposit_items (rebuild)",
      3
    );
    if (error) throw new Error(error.message);
  }

  return { ok: true, deposit_id, rebuilt: upserts.length, scanned_rows: scanned, found_items: latestByItem.size };
}

/**
 * Sync normale al salvataggio inventario (NON lo tocchiamo).
 */
export async function syncPvStockFromInventory(args: {
  pv_id: string;
  inventory_rows: InventoryRowMini[];
  items_meta: ItemMeta[];
}) {
  const pv_id = String(args.pv_id);
  const inventory_rows = Array.isArray(args.inventory_rows) ? args.inventory_rows : [];
  const items_meta = Array.isArray(args.items_meta) ? args.items_meta : [];

  if (!pv_id) throw new Error("pv_id mancante");
  if (inventory_rows.length === 0) return { ok: true, updated: 0, deposit_id: null as string | null };

  const deposit_id = await getOrCreatePvStockDepositId(pv_id);

  const metaById = new Map<string, ItemMeta>();
  for (const m of items_meta) {
    if (!m?.id) continue;
    metaById.set(String(m.id), {
      id: String(m.id),
      code: sanitizeCode((m as any).code),
      volume_ml_per_unit: toNumberOrNull((m as any).volume_ml_per_unit),
      peso_kg: toNumberOrNull((m as any).peso_kg),
      um: String((m as any).um ?? "").trim() || null,
    });
  }

  const map = new Map<string, InventoryRowMini>();
  for (const r of inventory_rows) {
    const item_id = String((r as any)?.item_id ?? "").trim();
    if (!item_id) continue;
    map.set(item_id, {
      item_id,
      qty: Math.max(0, Math.trunc(Number((r as any).qty) || 0)),
      qty_ml: Math.max(0, Math.trunc(Number((r as any).qty_ml) || 0)),
      qty_gr: Math.max(0, Math.trunc(Number((r as any).qty_gr) || 0)),
    });
  }

  const upserts: any[] = [];
  for (const row of map.values()) {
    const meta = metaById.get(row.item_id);
    if (!meta) continue;

    const stock_qty = computeStockQty(row, meta);
    if (stock_qty <= 0) continue;

    upserts.push({
      deposit_id,
      item_id: row.item_id,
      imported_code: meta.code || null,
      note_description: null,
      stock_qty,
      is_active: true,
    });
  }

  if (upserts.length === 0) return { ok: true, updated: 0, deposit_id };

  const chunkSize = 1000;
  for (let i = 0; i < upserts.length; i += chunkSize) {
    const chunk = upserts.slice(i, i + chunkSize);
    const { error } = await withRetry(
      async () => supabaseAdmin.from("deposit_items").upsert(chunk as any, { onConflict: "deposit_id,item_id" } as any),
      "upsert deposit_items (sync)",
      3
    );
    if (error) throw new Error(error.message);
  }

  return { ok: true, updated: upserts.length, deposit_id };
}