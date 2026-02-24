import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Deposito tecnico (per-PV) che rappresenta le giacenze “da inventari”.
// Regola chiave: NON azzeriamo gli item non presenti nell’inventario salvato,
// perché l’inventario può essere per categoria/sottocategoria.
const PV_STOCK_CODE = "PV-STOCK";
const PV_STOCK_NAME = "Giacenze PV";

type ItemMeta = {
  id: string;
  code: string;
  volume_ml_per_unit: number | null;
  peso_kg: number | null;
  um: string | null;
};

type InventoryRowMini = {
  item_id: string;
  qty: number; // PZ
  qty_ml: number; // ML totale (0 se non liquido)
  qty_gr: number; // GR aperti (0 se non kg)
};

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
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

async function getOrCreatePvStockDepositId(pv_id: string): Promise<string> {
  const { data: dep, error: depErr } = await supabaseAdmin
    .from("deposits")
    .select("id")
    .eq("pv_id", pv_id)
    .eq("code", PV_STOCK_CODE)
    .maybeSingle();

  if (depErr) throw new Error(depErr.message);
  if (dep?.id) return String(dep.id);

  const { data: created, error: insErr } = await supabaseAdmin
    .from("deposits")
    .insert({
      pv_id,
      code: PV_STOCK_CODE,
      name: PV_STOCK_NAME,
      is_active: true,
    })
    .select("id")
    .single();

  if (insErr) throw new Error(insErr.message);
  return String((created as any)?.id);
}

function computeStockQty(row: InventoryRowMini, meta: ItemMeta): number {
  const um = normUm(meta.um);

  // Liquidi: stock = ML totale (volume_ml_per_unit = segnale “affidabile”)
  if (meta.volume_ml_per_unit && meta.volume_ml_per_unit > 0) {
    return Math.max(0, Math.trunc(Number(row.qty_ml) || 0));
  }

  // ✅ KG: SOLO se UM è davvero KG.
  // Evita Tabacchi: possono avere peso_kg “tecnico” (es. 0.02) ma inventario a pezzi.
  if (um === "KG" && meta.peso_kg && meta.peso_kg > 0) {
    const perPieceGr = Math.round(meta.peso_kg * 1000);
    const pz = Math.max(0, Math.trunc(Number(row.qty) || 0));
    const openGr = Math.max(0, Math.trunc(Number(row.qty_gr) || 0));
    const total = pz * perPieceGr + openGr;
    return Math.max(0, Math.trunc(total));
  }

  // Default: PZ
  return Math.max(0, Math.trunc(Number(row.qty) || 0));
}

/**
 * Aggiorna (upsert) lo stock del deposito tecnico PV-STOCK usando le righe appena salvate nell’inventario.
 * Importante: aggiorna SOLO gli item presenti nelle righe passate.
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
  // dedup: ultima vince
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

    // se 0, non ha senso upsertare
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
    const { error } = await supabaseAdmin
      .from("deposit_items")
      .upsert(chunk as any, { onConflict: "deposit_id,item_id" } as any);
    if (error) throw new Error(error.message);
  }

  return { ok: true, updated: upserts.length, deposit_id };
}