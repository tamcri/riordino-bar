// app/api/warehouse-items/create/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

function toNullableNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

function toNullableInt(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può creare articoli" },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => null);

    const code = norm(body?.code);
    const description = norm(body?.description);

    if (!code) {
      return NextResponse.json({ ok: false, error: "Codice obbligatorio" }, { status: 400 });
    }

    if (!description) {
      return NextResponse.json({ ok: false, error: "Descrizione obbligatoria" }, { status: 400 });
    }

    // 1) check codice univoco
    const { data: dup, error: dupErr } = await supabaseAdmin
      .from("warehouse_items")
      .select("id")
      .eq("code", code)
      .limit(1);

    if (dupErr) {
      return NextResponse.json({ ok: false, error: dupErr.message }, { status: 500 });
    }

    if (Array.isArray(dup) && dup.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Codice "${code}" già esistente.` },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    const payload = {
      code,
      description,
      barcode: norm(body?.barcode) || null,
      um: norm(body?.um) || null,
      prezzo_vendita_eur: toNullableNumber(body?.prezzo_vendita_eur),
      peso_kg: toNullableNumber(body?.peso_kg),
      volume_ml_per_unit: toNullableInt(body?.volume_ml_per_unit),
      is_active: body?.is_active !== false,
      created_at: now,
      updated_at: now,
    };

    // 2) crea articolo magazzino e recupera id
    const { data: createdItem, error: insertItemError } = await supabaseAdmin
      .from("warehouse_items")
      .insert(payload)
      .select("id")
      .single();

    if (insertItemError) {
      return NextResponse.json({ ok: false, error: insertItemError.message }, { status: 500 });
    }

    const warehouseItemId = String((createdItem as any)?.id ?? "").trim();
    if (!warehouseItemId) {
      return NextResponse.json(
        { ok: false, error: "Articolo creato ma ID mancante" },
        { status: 500 }
      );
    }

    // 3) trova il PV magazzino centrale
    const { data: centralPv, error: centralPvError } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("is_central_warehouse", true)
      .maybeSingle();

    if (centralPvError) {
      return NextResponse.json({ ok: false, error: centralPvError.message }, { status: 500 });
    }

    if (!centralPv) {
      return NextResponse.json(
        { ok: false, error: "Articolo creato ma magazzino centrale non configurato" },
        { status: 400 }
      );
    }

    // 4) trova il deposito centrale
    const { data: centralDeposit, error: centralDepositError } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("pv_id", (centralPv as any).id)
      .eq("code", "DEP-CENTRALE")
      .maybeSingle();

    if (centralDepositError) {
      return NextResponse.json({ ok: false, error: centralDepositError.message }, { status: 500 });
    }

    if (!centralDeposit) {
      return NextResponse.json(
        { ok: false, error: "Articolo creato ma deposito centrale non trovato" },
        { status: 400 }
      );
    }

    // 5) inserisce automaticamente nel deposito centrale con qty 0
    const { error: depositInsertError } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .insert({
        deposit_id: (centralDeposit as any).id,
        warehouse_item_id: warehouseItemId,
        stock_qty: 0,
        is_active: true,
        created_at: now,
        updated_at: now,
      });

    if (depositInsertError) {
      return NextResponse.json(
        { ok: false, error: depositInsertError.message },
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