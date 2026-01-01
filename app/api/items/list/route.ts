import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  // ✅ lettura consentita anche a punto_vendita (serve per Inventario PV)
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  // ✅ nuovo schema
  const category_id = url.searchParams.get("category_id"); // uuid
  const subcategory_id = url.searchParams.get("subcategory_id"); // uuid

  // ✅ vecchio schema (retro-compat)
  const legacyCategory = (url.searchParams.get("category") || "").trim().toUpperCase(); // TAB | GV

  const q = (url.searchParams.get("q") || "").trim();
  const active = (url.searchParams.get("active") || "1").toLowerCase(); // 1 | 0 | all
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

  // validazioni leggere (non voglio 500 inutili)
  if (category_id && !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }
  if (legacyCategory && !["TAB", "GV"].includes(legacyCategory)) {
    return NextResponse.json({ ok: false, error: "Categoria non valida" }, { status: 400 });
  }

  // Base select: includo sia campi nuovi che vecchi così la UI può evolvere senza cambiare subito qui.
  let query = supabaseAdmin
    .from("items")
    .select("id, category, category_id, subcategory_id, code, description, is_active, created_at, updated_at")
    .order("code", { ascending: true })
    .limit(limit);

  // Filtri stato
  if (active === "1") query = query.eq("is_active", true);
  else if (active === "0") query = query.eq("is_active", false);

  // ✅ Priorità: nuovo schema
  if (category_id) {
    query = query.eq("category_id", category_id);
    if (subcategory_id) query = query.eq("subcategory_id", subcategory_id);
  } else {
    // ✅ fallback vecchio schema: se non arriva category_id, uso category TAB/GV
    // default storico: TAB se non passato nulla
    const cat = legacyCategory || "TAB";
    query = query.eq("category", cat);
  }

  // Ricerca testuale
  if (q) {
    query = query.or(`code.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[items/list] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data || [] });
}


