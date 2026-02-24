import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * ✅ Search server-side (per modalità Rapido):
 * - barcode: match esatto
 * - code/description: ilike
 * Ritorna max 20 righe.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();

    if (!q || q.length < 2) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    const cookieStore = cookies();
    const raw = cookieStore.get(COOKIE_NAME)?.value;
    const session = parseSessionValue(raw);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const isBarcode = /^\d{8,}$/.test(q);

    let query = supabaseAdmin
      .from("items")
      .select(
        `
        id,
        code,
        description,
        barcode,
        prezzo_vendita_eur,
        is_active,
        category_id,
        subcategory_id,
        um,
        peso_kg,
        volume_ml_per_unit
      `
      )
      .eq("is_active", true)
      .limit(20);

    if (isBarcode) {
      query = query.eq("barcode", q);
    } else {
      query = query.or(`code.ilike.%${q}%,description.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Errore" }, { status: 500 });
  }
}