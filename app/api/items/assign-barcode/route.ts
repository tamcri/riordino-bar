// app/api/items/assign-barcode/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function isBarcodeLike(v: string) {
  return /^\d{6,14}$/.test(v.trim());
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Solo admin può assegnare barcode" },
        { status: 401 }
      );
    }

    const body = await req.json();

    const category_id = String(body?.category_id ?? "").trim();
    const code = String(body?.code ?? "").trim();
    const barcode = String(body?.barcode ?? "").trim();

    if (!isUuid(category_id)) {
      return NextResponse.json(
        { ok: false, error: "Categoria non valida" },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { ok: false, error: "Codice articolo obbligatorio" },
        { status: 400 }
      );
    }

    if (!isBarcodeLike(barcode)) {
      return NextResponse.json(
        { ok: false, error: "Barcode non valido" },
        { status: 400 }
      );
    }

    // 🔎 Verifica che il barcode non sia già assegnato
    const { data: existingBarcode } = await supabaseAdmin
      .from("items")
      .select("id, code, description, category_id")
      .eq("barcode", barcode)
      .maybeSingle();

    if (existingBarcode) {
      return NextResponse.json(
        {
          ok: false,
          error: `Barcode già assegnato all'articolo ${existingBarcode.code} - ${existingBarcode.description}`,
        },
        { status: 400 }
      );
    }

    // 🔎 Trova articolo per codice nella categoria selezionata
    const { data: itemRow, error: itemErr } = await supabaseAdmin
      .from("items")
      .select("id, code, description")
      .eq("category_id", category_id)
      .eq("code", code)
      .maybeSingle();

    if (itemErr) {
      return NextResponse.json(
        { ok: false, error: itemErr.message },
        { status: 500 }
      );
    }

    if (!itemRow) {
      return NextResponse.json(
        { ok: false, error: "Articolo non trovato nella categoria selezionata" },
        { status: 404 }
      );
    }

    // ✅ Aggiorna SOLO il barcode
    const { error: updateErr } = await supabaseAdmin
      .from("items")
      .update({
        barcode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemRow.id);

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[items/assign-barcode] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore assegnazione barcode" },
      { status: 500 }
    );
  }
}

