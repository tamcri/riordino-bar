// app/api/warehouse-items/update/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

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

export async function PATCH(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può modificare articoli magazzino" },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => null);

    const id = String(body?.id ?? "").trim();
    const code = body?.code;
    const description = body?.description;
    const barcode = body?.barcode;
    const um = body?.um;
    const prezzo_vendita_eur = body?.prezzo_vendita_eur;
    const purchase_price = body?.purchase_price;
    const vat_rate = body?.vat_rate;
    const peso_kg = body?.peso_kg;
    const volume_ml_per_unit = body?.volume_ml_per_unit;
    const is_active = body?.is_active;

    if (!id || !isUuid(id)) {
      return NextResponse.json(
        { ok: false, error: "ID non valido" },
        { status: 400 }
      );
    }

    const { data: current, error: curErr } = await supabaseAdmin
      .from("warehouse_items")
      .select("id, code")
      .eq("id", id)
      .maybeSingle();

    if (curErr) {
      return NextResponse.json(
        { ok: false, error: curErr.message },
        { status: 500 }
      );
    }

    if (!current) {
      return NextResponse.json(
        { ok: false, error: "Articolo magazzino non trovato" },
        { status: 404 }
      );
    }

    const patch: any = {
      updated_at: new Date().toISOString(),
    };

    // CODICE
    if (code !== undefined) {
      const nextCode = String(code ?? "").trim();
      if (!nextCode) {
        return NextResponse.json(
          { ok: false, error: "Il codice non può essere vuoto" },
          { status: 400 }
        );
      }

      if (nextCode !== String((current as any).code)) {
        const { data: dup, error: dupErr } = await supabaseAdmin
          .from("warehouse_items")
          .select("id")
          .eq("code", nextCode)
          .neq("id", id)
          .limit(1);

        if (dupErr) {
          return NextResponse.json(
            { ok: false, error: dupErr.message },
            { status: 500 }
          );
        }

        if (Array.isArray(dup) && dup.length > 0) {
          return NextResponse.json(
            { ok: false, error: `Codice "${nextCode}" già esistente.` },
            { status: 409 }
          );
        }

        patch.code = nextCode;
      }
    }

    // DESCRIZIONE
    if (description !== undefined) {
      const nextDescription = String(description ?? "").trim();
      if (!nextDescription) {
        return NextResponse.json(
          { ok: false, error: "La descrizione non può essere vuota" },
          { status: 400 }
        );
      }
      patch.description = nextDescription;
    }

    // ATTIVO
    if (typeof is_active === "boolean") {
      patch.is_active = is_active;
    }

    // BARCODE
    const nextBarcode = toNullableText(barcode);
    if (nextBarcode !== undefined) patch.barcode = nextBarcode;

    // UM
    const nextUm = toNullableText(um);
    if (nextUm !== undefined) patch.um = nextUm;

    // PREZZO VENDITA
    const nextPrezzo = toNullableNumber(prezzo_vendita_eur);
    if (nextPrezzo !== undefined) patch.prezzo_vendita_eur = nextPrezzo;

    // 👉 PREZZO ACQUISTO (NUOVO)
    const nextPurchase = toNullableNumber(purchase_price);
    if (nextPurchase !== undefined) patch.purchase_price = nextPurchase;

    // 🔥 IVA
    const nextVat = toNullableNumber(vat_rate);
    if (nextVat !== undefined) patch.vat_rate = nextVat;

    // PESO
    const nextPeso = toNullableNumber(peso_kg);
    if (nextPeso !== undefined) patch.peso_kg = nextPeso;

    // VOLUME
    const nextVol = toNullableInt(volume_ml_per_unit);
    if (nextVol !== undefined) {
      patch.volume_ml_per_unit = nextVol && nextVol > 0 ? nextVol : null;
    }

    const { error } = await supabaseAdmin
      .from("warehouse_items")
      .update(patch)
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}