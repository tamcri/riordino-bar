import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

function toInt(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può modificare il deposito" },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => null);

    const warehouse_item_id = norm(body?.warehouse_item_id);
    const stock_qty = toInt(body?.stock_qty);

    if (!warehouse_item_id) {
      return NextResponse.json(
        { ok: false, error: "Articolo obbligatorio" },
        { status: 400 }
      );
    }

    // 1️⃣ trova PV magazzino centrale
    const { data: pv } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("is_central_warehouse", true)
      .maybeSingle();

    if (!pv) {
      return NextResponse.json(
        { ok: false, error: "Magazzino centrale non configurato" },
        { status: 400 }
      );
    }

    // 2️⃣ trova deposito
    const { data: deposit } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("pv_id", pv.id)
      .eq("code", "DEP-CENTRALE")
      .maybeSingle();

    if (!deposit) {
      return NextResponse.json(
        { ok: false, error: "Deposito centrale non trovato" },
        { status: 400 }
      );
    }

    // 3️⃣ controllo duplicato
    const { data: existing } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .select("id")
      .eq("deposit_id", deposit.id)
      .eq("warehouse_item_id", warehouse_item_id)
      .limit(1);

    if (Array.isArray(existing) && existing.length > 0) {
      return NextResponse.json(
        { ok: false, error: "Articolo già presente nel deposito" },
        { status: 409 }
      );
    }

    // 4️⃣ insert
    const { error } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .insert({
        deposit_id: deposit.id,
        warehouse_item_id,
        stock_qty,
        is_active: true,
        created_at: new Date().toISOString(),
      });

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