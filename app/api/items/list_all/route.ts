// app/api/items/list_all/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const c = cookies();
    const sessionRaw = c.get(COOKIE_NAME)?.value || "";
    const session = parseSessionValue(sessionRaw);

    // ✅ In questo progetto parseSessionValue() potrebbe non esporre "user_id" come campo.
// Ci basta sapere che la sessione esiste e non è vuota.
if (!session) {
  return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
}


    const { searchParams } = new URL(req.url);
    const limitRaw = (searchParams.get("limit") || "5000").trim();
    const limit = Math.max(1, Math.min(10000, Number(limitRaw) || 5000));

    const { data, error } = await supabaseAdmin
      .from("items")
      .select(
        `
        id,
        code,
        description,
        barcode,
        prezzo_vendita_eur,
        is_active,
        um,
        peso_kg,
        volume_ml_per_unit,
        category_id,
        subcategory_id
      `
      )
      .eq("is_active", true)
      .order("code", { ascending: true })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Errore" }, { status: 500 });
  }
}
