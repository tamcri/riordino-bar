import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può accedere" },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const q = norm(searchParams.get("q"));

    if (q.length < 3) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    const { data: pv, error: pvErr } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("is_central_warehouse", true)
      .maybeSingle();

    if (pvErr) {
      return NextResponse.json({ ok: false, error: pvErr.message }, { status: 500 });
    }

    if (!pv) {
      return NextResponse.json(
        { ok: false, error: "Magazzino centrale non configurato" },
        { status: 400 }
      );
    }

    const { data: deposit, error: depErr } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("pv_id", pv.id)
      .eq("code", "DEP-CENTRALE")
      .maybeSingle();

    if (depErr) {
      return NextResponse.json({ ok: false, error: depErr.message }, { status: 500 });
    }

    if (!deposit) {
      return NextResponse.json(
        { ok: false, error: "Deposito centrale non trovato" },
        { status: 400 }
      );
    }

    const like = `%${q}%`;

    const { data, error } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .select(
        `
        id,
        warehouse_item_id,
        stock_qty,
        is_active,
        warehouse_items (
          code,
          description,
          barcode,
          um
        )
      `
      )
      .eq("deposit_id", deposit.id)
      .eq("is_active", true);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (Array.isArray(data) ? data : [])
      .map((row: any) => ({
        id: row.id,
        warehouse_item_id: row.warehouse_item_id,
        code: row.warehouse_items?.code ?? "",
        description: row.warehouse_items?.description ?? "",
        barcode: row.warehouse_items?.barcode ?? null,
        um: row.warehouse_items?.um ?? null,
        stock_qty: Number(row.stock_qty ?? 0) || 0,
        is_active: row.is_active ?? true,
      }))
      .filter((row) => {
        const code = String(row.code ?? "").toLowerCase();
        const description = String(row.description ?? "").toLowerCase();
        const barcode = String(row.barcode ?? "").toLowerCase();
        const qq = q.toLowerCase();

        return (
          code.includes(qq) ||
          description.includes(qq) ||
          barcode.includes(qq)
        );
      })
      .sort((a, b) => {
        const aCode = String(a.code ?? "");
        const bCode = String(b.code ?? "");
        return aCode.localeCompare(bCode, "it");
      })
      .slice(0, 20);

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}