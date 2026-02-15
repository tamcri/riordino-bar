import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

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
  const deposit_id = normText(url.searchParams.get("deposit_id"));
  const category_id = normText(url.searchParams.get("category_id"));
  const subcategory_id = normText(url.searchParams.get("subcategory_id"));

  if (!deposit_id) {
    return NextResponse.json({ ok: false, error: "deposit_id obbligatorio" }, { status: 400 });
  }

  // 🔐 controllo sicurezza PV
  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    const pv_id = r.pv_id;
    if (!pv_id) {
      return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    }

    const { data: dep, error: depErr } = await supabaseAdmin
      .from("deposits")
      .select("id, pv_id")
      .eq("id", deposit_id)
      .maybeSingle();

    if (depErr) return NextResponse.json({ ok: false, error: depErr.message }, { status: 500 });
    if (!dep || dep.pv_id !== pv_id) return NextResponse.json({ ok: false, error: "Deposito non trovato" }, { status: 404 });
  }

  // ✅ Se filtro per category/subcategory devo fare INNER JOIN, altrimenti items può essere null (righe “vuote” in UI)
  const join = category_id || subcategory_id ? "items:items!inner" : "items:items";

  let query = supabaseAdmin
    .from("deposit_items")
    .select(
      `id, deposit_id, item_id, imported_code, note_description, stock_qty, is_active, created_at,
       ${join} (
         id,
         ${ITEM_CODE_COL},
         description,
         barcode,
         um,
         volume_ml_per_unit,
         peso_kg,
         conf_da,
         prezzo_vendita_eur,
         category,
         category_id,
         subcategory_id,
         is_active
       )`
    )
    .eq("deposit_id", deposit_id);

  if (category_id) query = query.eq("items.category_id", category_id);
  if (subcategory_id) query = query.eq("items.subcategory_id", subcategory_id);

  const { data, error } = await query.order("imported_code", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, items: data || [] });
}






