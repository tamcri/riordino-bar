import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = norm(searchParams.get("q"));
    const all = searchParams.get("all") === "1";

    if (!all && (!q || q.length < 2)) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Non autorizzato" },
        { status: 401 }
      );
    }

    const { data: centralPv, error: pvErr } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("is_central_warehouse", true)
      .maybeSingle();

    if (pvErr) {
      return NextResponse.json(
        { ok: false, error: pvErr.message },
        { status: 500 }
      );
    }

    if (!centralPv) {
      return NextResponse.json(
        { ok: false, error: "Magazzino centrale non configurato" },
        { status: 400 }
      );
    }

    const { data: deposit, error: depErr } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("pv_id", centralPv.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (depErr) {
      return NextResponse.json(
        { ok: false, error: depErr.message },
        { status: 500 }
      );
    }

    if (!deposit) {
      return NextResponse.json(
        { ok: false, error: "Deposito magazzino non trovato" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .select(
        `
        id,
        warehouse_item_id,
        stock_qty,
        warehouse_items!inner (
          id,
          code,
          description,
          barcode,
          prezzo_vendita_eur,
          um,
          is_active
        )
        `
      )
      .eq("deposit_id", deposit.id)
      .eq("is_active", true)
      .eq("warehouse_items.is_active", true)
      .limit(all ? 500 : 200);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const isBarcode = /^\d{8,}$/.test(q);
    const qLower = q.toLowerCase();

    let rows = (Array.isArray(data) ? data : [])
  .map((r: any) => {
    const it = r?.warehouse_items;
    if (!it) return null;

    return {
      id: norm(it.id),
      code: norm(it.code),
      description: norm(it.description),
      barcode: norm(it.barcode) || null,
      prezzo_vendita_eur: Number(it.prezzo_vendita_eur ?? 0) || 0,
      um: norm(it.um) || null,
      stock_qty: Number(r?.stock_qty ?? 0) || 0,
    };
  })
  .filter(Boolean)
  .filter((it: any) => {
    if (all) return true;

    const isBarcode = /^\d{8,}$/.test(q);
    const qLower = q.toLowerCase();

    if (isBarcode) {
      return norm(it.barcode) === q;
    }

    const code = norm(it.code).toLowerCase();
    const description = norm(it.description).toLowerCase();
    const barcode = norm(it.barcode).toLowerCase();

    return (
      code.includes(qLower) ||
      description.includes(qLower) ||
      barcode.includes(qLower)
    );
  });

// 👉 ORDINE QUI (sicuro al 100%)
rows.sort((a: any, b: any) => {
  return a.code.localeCompare(b.code, "it", { sensitivity: "base" });
});

// 👉 LIMITE
rows = rows.slice(0, all ? 500 : 20);

    return NextResponse.json({ ok: true, rows });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Errore" },
      { status: 500 }
    );
  }
}