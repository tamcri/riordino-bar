// app/api/items/update/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

export async function PATCH(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Solo admin può modificare articoli" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  const id = String(body?.id ?? "").trim();
  const code = body?.code;
  const description = body?.description;
  const is_active = body?.is_active;
  const peso_kg = body?.peso_kg;
  const prezzo_vendita_eur = body?.prezzo_vendita_eur;
  const conf_da = body?.conf_da;
  const barcode = body?.barcode;
  const um = body?.um;

  // ✅ NEW
  const volume_ml_per_unit = body?.volume_ml_per_unit;

  if (!id) return NextResponse.json({ ok: false, error: "ID mancante" }, { status: 400 });

  function toNullableNumber(v: any): number | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function toNullableInt(v: any): number | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.trunc(n));
  }

  function toNullableText(v: any): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s;
  }

  const { data: current, error: curErr } = await supabaseAdmin
    .from("items")
    .select("id, code, category, category_id, subcategory_id")
    .eq("id", id)
    .maybeSingle();

  if (curErr) {
    console.error("[items/update] read current error:", curErr);
    return NextResponse.json({ ok: false, error: curErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ ok: false, error: "Articolo non trovato" }, { status: 404 });
  }

  const patch: any = { updated_at: new Date().toISOString() };

  if (code !== undefined) {
    const nextCode = String(code ?? "").trim();
    if (!nextCode) {
      return NextResponse.json({ ok: false, error: "Il codice non può essere vuoto" }, { status: 400 });
    }

    if (nextCode !== String(current.code)) {
      let dupQuery = supabaseAdmin.from("items").select("id").eq("code", nextCode).neq("id", id).limit(1);

      if (current.category_id && isUuid(String(current.category_id))) {
        dupQuery = dupQuery.eq("category_id", current.category_id);
        if (current.subcategory_id && isUuid(String(current.subcategory_id))) {
          dupQuery = dupQuery.eq("subcategory_id", current.subcategory_id);
        }
      } else {
        if (current.category) dupQuery = dupQuery.eq("category", current.category);
      }

      const { data: dup, error: dupErr } = await dupQuery;
      if (dupErr) {
        console.error("[items/update] dup check error:", dupErr);
        return NextResponse.json({ ok: false, error: dupErr.message }, { status: 500 });
      }

      if (Array.isArray(dup) && dup.length > 0) {
        return NextResponse.json(
          { ok: false, error: `Esiste già un articolo con codice "${nextCode}" in questa categoria (o sottocategoria).` },
          { status: 409 }
        );
      }

      patch.code = nextCode;
    }
  }

  if (typeof description === "string") patch.description = description.trim();
  if (typeof is_active === "boolean") patch.is_active = is_active;

  const nextPeso = toNullableNumber(peso_kg);
  if (nextPeso !== undefined) patch.peso_kg = nextPeso;

  const nextPrezzo = toNullableNumber(prezzo_vendita_eur);
  if (nextPrezzo !== undefined) patch.prezzo_vendita_eur = nextPrezzo;

  const nextConf = toNullableInt(conf_da);
  if (nextConf !== undefined) patch.conf_da = nextConf;

  const nextBarcode = toNullableText(barcode);
  if (nextBarcode !== undefined) patch.barcode = nextBarcode;

  const nextUm = toNullableText(um);
  if (nextUm !== undefined) patch.um = nextUm;

  // ✅ NEW: volume_ml_per_unit (solo liquidi)
// Vuoto o 0 => NULL (disattiva gestione ml)
const nextVol = toNullableInt(volume_ml_per_unit);
if (nextVol !== undefined) {
  patch.volume_ml_per_unit = nextVol && nextVol > 0 ? nextVol : null;
}


  const { error } = await supabaseAdmin.from("items").update(patch).eq("id", id);
  if (error) {
    console.error("[items/update] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}







