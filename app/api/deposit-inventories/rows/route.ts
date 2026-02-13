import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

// ✅ FIX: la colonna reale è "code" (minuscolo)
const ITEM_CODE_COL = "code";

function normText(v: any): string {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const inventory_id = normText(url.searchParams.get("inventory_id"));
  if (!inventory_id) return NextResponse.json({ ok: false, error: "inventory_id obbligatorio" }, { status: 400 });

  // testata + deposito
  const { data: inv, error: invErr } = await supabaseAdmin
    .from("deposit_inventories")
    .select("id, deposit_id, pv_id, inventory_date, operator_name, notes, created_at")
    .eq("id", inventory_id)
    .maybeSingle();

  if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ ok: false, error: "Inventario non trovato" }, { status: 404 });

  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    const pv_id = r.pv_id;
    if (!pv_id) return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    if (pv_id !== String((inv as any).pv_id)) {
      return NextResponse.json({ ok: false, error: "Inventario non trovato" }, { status: 404 });
    }
  }

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from("deposit_inventory_rows")
    .select(
      `id, inventory_id, item_id, qty, created_at,
       items:items (id, ${ITEM_CODE_COL}, description, barcode, um, prezzo_vendita_eur, category, category_id, subcategory_id)`
    )
    .eq("inventory_id", inventory_id)
    // meglio ordinare per code se vuoi lista stabile:
    // .order(`items.${ITEM_CODE_COL}`, { ascending: true })
    .order("created_at", { ascending: true });

  if (rowsErr) return NextResponse.json({ ok: false, error: rowsErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, inventory: inv, rows: rows || [] });
}

