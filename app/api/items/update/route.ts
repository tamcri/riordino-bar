// app/api/items/update/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Solo admin può modificare articoli" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "").trim();
  const description = body?.description;
  const is_active = body?.is_active;
  const peso_kg = body?.peso_kg;
  const prezzo_vendita_eur = body?.prezzo_vendita_eur;
  const conf_da = body?.conf_da; // ✅ NEW (già c’era)
  const barcode = body?.barcode; // ✅ NEW

  if (!id) return NextResponse.json({ ok: false, error: "ID mancante" }, { status: 400 });

  function toNullableNumber(v: any): number | null | undefined {
    if (v === undefined) return undefined; // non aggiornare
    if (v === null || v === "") return null; // set NULL
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
    if (v === undefined) return undefined; // non aggiornare
    if (v === null) return null; // set NULL
    const s = String(v).trim();
    if (!s) return null; // vuoto => NULL
    return s;
  }

  const patch: any = { updated_at: new Date().toISOString() };

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

  const { error } = await supabaseAdmin.from("items").update(patch).eq("id", id);
  if (error) {
    console.error("[items/update] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}




