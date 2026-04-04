import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function toNumberSafe(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function calcPriceVat(price: number | null, vat: number | null) {
  if (price == null) return null;
  const p = toNumberSafe(price);
  const v = toNumberSafe(vat) ?? 0;
  if (p == null) return null;
  return p * (1 + v / 100);
}

export async function GET() {
  try {
    // 1. deposito
    const { data: depositRows, error: depositError } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .select("warehouse_item_id, stock_qty")
      .eq("is_active", true);

    if (depositError) {
      return NextResponse.json(
        { ok: false, error: depositError.message },
        { status: 500 }
      );
    }

    const itemIds = (depositRows || [])
      .map((r) => r.warehouse_item_id)
      .filter(Boolean);

    if (itemIds.length === 0) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    // 2. articoli (ORA CON IVA)
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("warehouse_items")
      .select("id, code, description, purchase_price, vat_rate")
      .in("id", itemIds);

    if (itemsError) {
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 500 }
      );
    }

    // 3. map
    const itemsMap = new Map<string, any>();
    for (const item of items || []) {
      itemsMap.set(item.id, item);
    }

    // 4. costruzione righe
    const rows = (depositRows || []).map((r: any) => {
      const item = itemsMap.get(r.warehouse_item_id);

      const stock = Number(r.stock_qty || 0);

      const purchase_price = toNumberSafe(item?.purchase_price);
      const vat_rate = toNumberSafe(item?.vat_rate);

      const purchase_price_vat = calcPriceVat(
        purchase_price,
        vat_rate
      );

      const valore_imp =
        purchase_price != null ? stock * purchase_price : 0;

      const valore_ivato =
        purchase_price_vat != null ? stock * purchase_price_vat : 0;

      return {
        code: item?.code || "",
        description: item?.description || "",
        stock_qty: stock,

        purchase_price,
        vat_rate,
        purchase_price_vat,

        valore_imp,
        valore_ivato,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}