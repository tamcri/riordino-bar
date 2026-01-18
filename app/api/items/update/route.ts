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

  if (!id) return NextResponse.json({ ok: false, error: "ID mancante" }, { status: 400 });

  function toNullableNumber(v: any): number | null | undefined {
    // undefined => non aggiornare la colonna
    if (v === undefined) return undefined;
    // null / "" => setta NULL in DB
    if (v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return n;
  }

  const patch: any = { updated_at: new Date().toISOString() };
  if (typeof description === "string") patch.description = description.trim();
  if (typeof is_active === "boolean") patch.is_active = is_active;

  const nextPeso = toNullableNumber(peso_kg);
  if (nextPeso !== undefined) patch.peso_kg = nextPeso;

  const nextPrezzo = toNullableNumber(prezzo_vendita_eur);
  if (nextPrezzo !== undefined) patch.prezzo_vendita_eur = nextPrezzo;

  const { error } = await supabaseAdmin.from("items").update(patch).eq("id", id);
  if (error) {
    console.error("[items/update] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}


