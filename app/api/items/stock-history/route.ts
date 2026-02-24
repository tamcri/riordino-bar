import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

function normText(v: any): string {
  return String(v ?? "").trim();
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Storico giacenze per singolo prodotto, basato su inventari salvati.
 * NOTE:
 * - Lo storico è “a punti”: esistono solo le date in cui l’articolo è stato inventariato.
 * - qty/qty_ml/qty_gr sono i valori salvati nell’inventario.
 */
export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const pv_id_raw = normText(url.searchParams.get("pv_id"));
  const item_id = normText(url.searchParams.get("item_id"));
  const from = normText(url.searchParams.get("from"));
  const to = normText(url.searchParams.get("to"));

  if (!item_id || !isUuid(item_id)) {
    return NextResponse.json({ ok: false, error: "item_id non valido" }, { status: 400 });
  }
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json({ ok: false, error: "from/to non validi (YYYY-MM-DD)" }, { status: 400 });
  }

  // 🔐 PV scope: se utente PV, forza pv_id e ignora query pv_id
  let pv_id = pv_id_raw;
  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    if (!r.pv_id) {
      return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    }
    pv_id = r.pv_id;
  }

  if (!pv_id || !isUuid(pv_id)) {
    return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  }

  // Meta articolo (um + prezzo) per calcoli e UI
  const { data: item, error: itemErr } = await supabaseAdmin
    .from("items")
    .select("id, code, description, um, prezzo_vendita_eur")
    .eq("id", item_id)
    .maybeSingle();

  if (itemErr) return NextResponse.json({ ok: false, error: itemErr.message }, { status: 500 });
  if (!item) return NextResponse.json({ ok: false, error: "Articolo non trovato" }, { status: 404 });

  // Punti nel range
  const { data: points, error: pointsErr } = await supabaseAdmin
    .from("inventories")
    .select("inventory_date, qty, qty_ml, qty_gr")
    .eq("pv_id", pv_id)
    .eq("item_id", item_id)
    .gte("inventory_date", from)
    .lte("inventory_date", to)
    .order("inventory_date", { ascending: true });

  if (pointsErr) return NextResponse.json({ ok: false, error: pointsErr.message }, { status: 500 });

  // Baseline: ultimo punto <= from
  const { data: baselineRows, error: baseErr } = await supabaseAdmin
    .from("inventories")
    .select("inventory_date, qty, qty_ml, qty_gr")
    .eq("pv_id", pv_id)
    .eq("item_id", item_id)
    .lte("inventory_date", from)
    .order("inventory_date", { ascending: false })
    .limit(1);

  if (baseErr) return NextResponse.json({ ok: false, error: baseErr.message }, { status: 500 });
  const baseline = Array.isArray(baselineRows) && baselineRows.length ? baselineRows[0] : null;

  // Ultimo punto <= to
  const { data: lastRows, error: lastErr } = await supabaseAdmin
    .from("inventories")
    .select("inventory_date, qty, qty_ml, qty_gr")
    .eq("pv_id", pv_id)
    .eq("item_id", item_id)
    .lte("inventory_date", to)
    .order("inventory_date", { ascending: false })
    .limit(1);

  if (lastErr) return NextResponse.json({ ok: false, error: lastErr.message }, { status: 500 });
  const last = Array.isArray(lastRows) && lastRows.length ? lastRows[0] : null;

  return NextResponse.json({
    ok: true,
    pv_id,
    item: {
      id: item.id,
      code: item.code,
      description: item.description,
      um: item.um,
      prezzo_vendita_eur: item.prezzo_vendita_eur,
    },
    range: { from, to },
    baseline,
    last,
    points: points || [],
  });
}
