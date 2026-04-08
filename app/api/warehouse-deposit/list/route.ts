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
    const q = norm(searchParams.get("q")).toLowerCase();
    const active = norm(searchParams.get("active"));

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

    let query = supabaseAdmin
      .from("warehouse_deposit_items")
      .select(`
        id,
        warehouse_item_id,
        stock_qty,
        is_active,
        warehouse_items (
          code,
          description,
          um,
          min_stock_alert
        )
      `)
      .eq("deposit_id", deposit.id)
      .order("created_at", { ascending: true });

    if (active === "1") {
      query = query.eq("is_active", true);
    } else if (active === "0") {
      query = query.eq("is_active", false);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    let rows = (Array.isArray(data) ? data : []).map((r: any) => {
      const min = r.warehouse_items?.min_stock_alert ?? null;
      const stock = r.stock_qty ?? 0;

      return {
        id: r.id,
        warehouse_item_id: r.warehouse_item_id,
        code: r.warehouse_items?.code ?? "",
        description: r.warehouse_items?.description ?? "",
        um: r.warehouse_items?.um ?? null,
        stock_qty: stock,
        min_stock_alert: min,
        is_under_min: min != null && stock <= min,
        is_active: r.is_active ?? true,
      };
    });

    if (q && q.length >= 2) {
      rows = rows.filter((r) => {
        return (
          r.code.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
        );
      });
    }

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}