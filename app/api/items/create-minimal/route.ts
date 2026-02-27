// app/api/items/create-minimal/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v).trim());
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Solo admin può creare articoli" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim();
  const description = String(body?.description ?? "").trim();
  const category_id = body?.category_id ?? null;
  const subcategory_id = body?.subcategory_id ?? null;

  if (!code) return NextResponse.json({ ok: false, error: "Codice obbligatorio" }, { status: 400 });
  if (!description) return NextResponse.json({ ok: false, error: "Descrizione obbligatoria" }, { status: 400 });

  if (category_id != null && category_id !== "" && !isUuid(String(category_id))) {
    return NextResponse.json({ ok: false, error: "Categoria non valida" }, { status: 400 });
  }
  if (subcategory_id != null && subcategory_id !== "" && !isUuid(String(subcategory_id))) {
    return NextResponse.json({ ok: false, error: "Sottocategoria non valida" }, { status: 400 });
  }

  // ✅ dup check (stesso approccio di /api/items/update)
  const { data: dup, error: dupErr } = await supabaseAdmin
    .from("items")
    .select("id")
    .eq("code", code)
    .limit(1);

  if (dupErr) {
    console.error("[items/create-minimal] dup check error:", dupErr);
    return NextResponse.json({ ok: false, error: dupErr.message }, { status: 500 });
  }

  if (Array.isArray(dup) && dup.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Esiste già un articolo con codice "${code}".` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const insertRow: any = {
    code,
    description,
    is_active: true,
    category_id: category_id && String(category_id).trim() ? category_id : null,
    subcategory_id: subcategory_id && String(subcategory_id).trim() ? subcategory_id : null,
    created_at: now,
    updated_at: now,
  };

  // Se category_id è null => forzo anche subcategory_id null.
  if (!insertRow.category_id) insertRow.subcategory_id = null;

  const { data, error } = await supabaseAdmin
    .from("items")
    .insert(insertRow)
    .select(
      "id, code, description, barcode, um, is_active, category_id, subcategory_id, peso_kg, conf_da, prezzo_vendita_eur, volume_ml_per_unit"
    )
    .maybeSingle();

  if (error) {
    console.error("[items/create-minimal] insert error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row: data });
}