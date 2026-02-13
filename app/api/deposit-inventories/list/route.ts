import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

function normText(v: any): string {
  return String(v ?? "").trim();
}

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const deposit_id = normText(url.searchParams.get("deposit_id"));
  const include_totals = normText(url.searchParams.get("include_totals")) === "1";

  if (!deposit_id) return NextResponse.json({ ok: false, error: "deposit_id obbligatorio" }, { status: 400 });

  // Se PV: verifica che il deposito appartenga al PV dell'utente
  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    const pv_id = r.pv_id;
    if (!pv_id) return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });

    const { data: dep, error: depErr } = await supabaseAdmin
      .from("deposits")
      .select("id, pv_id")
      .eq("id", deposit_id)
      .maybeSingle();

    if (depErr) return NextResponse.json({ ok: false, error: depErr.message }, { status: 500 });
    if (!dep || String(dep.pv_id) !== String(pv_id)) {
      return NextResponse.json({ ok: false, error: "Deposito non trovato" }, { status: 404 });
    }
  }

  // Lista inventari (testate)
  const { data: inventories, error } = await supabaseAdmin
    .from("deposit_inventories")
    .select("id, deposit_id, pv_id, inventory_date, operator_name, notes, created_at")
    .eq("deposit_id", deposit_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const list = Array.isArray(inventories) ? inventories : [];

  if (!include_totals || list.length === 0) {
    return NextResponse.json({ ok: true, inventories: list });
  }

  // Prendo tutte le righe di questi inventari in una botta sola e aggrego
  const ids = list.map((x: any) => x.id).filter(Boolean);

  // Nota: max IN può essere un limite, ma qui parliamo di storico deposito -> tipicamente poche decine/centinaia.
  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from("deposit_inventory_rows")
    .select(
      `inventory_id, qty,
       items:items (prezzo_vendita_eur)`
    )
    .in("inventory_id", ids);

  if (rowsErr) return NextResponse.json({ ok: false, error: rowsErr.message }, { status: 500 });

  // Aggrego per inventory_id
  const agg = new Map<string, { tot_qty: number; tot_value_eur: number }>();

  for (const r of Array.isArray(rows) ? rows : []) {
    const invId = normText((r as any).inventory_id);
    if (!invId) continue;

    const qty = toNum((r as any).qty);
    const price = toNum((r as any).items?.prezzo_vendita_eur);

    const cur = agg.get(invId) || { tot_qty: 0, tot_value_eur: 0 };
    cur.tot_qty += qty;
    cur.tot_value_eur += qty * price;
    agg.set(invId, cur);
  }

  const inventoriesWithTotals = list.map((inv: any) => {
    const a = agg.get(String(inv.id)) || { tot_qty: 0, tot_value_eur: 0 };
    return { ...inv, ...a };
  });

  return NextResponse.json({ ok: true, inventories: inventoriesWithTotals });
}
