import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";
import { ensurePvStockDepositId } from "@/lib/deposits/syncPvStockFromInventory";

export const runtime = "nodejs";

type Row = {
  item_id: string;
  qty: number; // pz
  qty_ml: number; // totale ml (se item ML)
  qty_gr: number; // grammi aperti (se item KG)
};

type Body = {
  waste_date?: string; // YYYY-MM-DD
  operatore?: string;
  rows?: Row[];
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v).trim());
}

function clampInt(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.trunc(x));
}

async function scalePvStock(args: { pv_id: string; rows: Row[] }) {
  const pv_id = String(args.pv_id);
  const rows = args.rows;

  const { deposit_id } = await ensurePvStockDepositId(pv_id);

  const itemIds = Array.from(new Set(rows.map((r) => String(r.item_id)).filter((x) => isUuid(x))));
  if (itemIds.length === 0) return { ok: true, deposit_id, touched: 0 };

  const { data: metas, error: metaErr } = await supabaseAdmin
    .from("items")
    .select("id, um, peso_kg, volume_ml_per_unit")
    .in("id", itemIds);

  if (metaErr) throw new Error(metaErr.message);

  const metaById = new Map<string, any>();
  for (const m of Array.isArray(metas) ? metas : []) {
    if (!m?.id) continue;
    metaById.set(String(m.id), m);
  }

  let touched = 0;

  // Aggiorno una riga alla volta per mantenere la logica semplice e leggibile
  for (const r of rows) {
    const item_id = String(r.item_id);
    const meta = metaById.get(item_id);
    if (!meta) continue;

    const um = String(meta.um ?? "").trim().toUpperCase();
    const vol = Number(meta.volume_ml_per_unit ?? 0) || 0;
    const pesoKg = Number(meta.peso_kg ?? 0) || 0;

    let delta = 0;
    if (vol > 0) {
      delta = clampInt(r.qty_ml);
    } else if (um === "KG" && pesoKg > 0) {
      const perPieceGr = Math.round(pesoKg * 1000);
      const pz = clampInt(r.qty);
      const openGr = clampInt(r.qty_gr);
      delta = Math.max(0, pz * perPieceGr + openGr);
    } else {
      delta = clampInt(r.qty);
    }

    if (delta <= 0) continue;

    const { data: depRow, error: depErr } = await supabaseAdmin
      .from("deposit_items")
      .select("id, stock_qty")
      .eq("deposit_id", deposit_id)
      .eq("item_id", item_id)
      .maybeSingle();

    if (depErr) throw new Error(depErr.message);
    if (!depRow?.id) continue; // se non esiste in PV-STOCK, non invento righe

    const current = clampInt((depRow as any).stock_qty);
    const next = Math.max(0, current - delta);

    const { error: upErr } = await supabaseAdmin
      .from("deposit_items")
      .update({ stock_qty: next })
      .eq("id", (depRow as any).id);

    if (upErr) throw new Error(upErr.message);
    touched++;
  }

  return { ok: true, deposit_id, touched };
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || !["punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });

    const waste_date = String(body.waste_date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(waste_date)) {
      return NextResponse.json({ ok: false, error: "Data non valida" }, { status: 400 });
    }

    const operatore = String(body.operatore || "").trim();
    if (!operatore) return NextResponse.json({ ok: false, error: "Operatore mancante" }, { status: 400 });
    if (operatore.length > 80) return NextResponse.json({ ok: false, error: "Operatore troppo lungo (max 80)" }, { status: 400 });

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ ok: false, error: "Righe mancanti" }, { status: 400 });

    // pv_id dal profilo utente
    const r = await getPvIdForSession(session);
    const pv_id = r.pv_id;
    if (!pv_id) return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });

    // Sanitizzo righe
    const cleanRows: Row[] = [];
    for (const x of rows) {
      const item_id = String((x as any)?.item_id ?? "").trim();
      if (!isUuid(item_id)) continue;

      const qty = clampInt((x as any)?.qty);
      const qty_ml = clampInt((x as any)?.qty_ml);
      const qty_gr = clampInt((x as any)?.qty_gr);

      if (qty <= 0 && qty_ml <= 0 && qty_gr <= 0) continue;
      cleanRows.push({ item_id, qty, qty_ml, qty_gr });
    }

    if (cleanRows.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessuna riga valida" }, { status: 400 });
    }

    // 1) Header
    const { data: header, error: hErr } = await supabaseAdmin
      .from("waste_headers")
      .insert({
        pv_id,
        waste_date,
        operatore,
        created_by_username: session.username ?? null,
      })
      .select("id")
      .single();

    if (hErr) return NextResponse.json({ ok: false, error: hErr.message }, { status: 500 });

    const header_id = String((header as any)?.id ?? "");
    if (!isUuid(header_id)) return NextResponse.json({ ok: false, error: "header_id non valido" }, { status: 500 });

    // 2) Rows
    const payload = cleanRows.map((r) => ({
      header_id,
      item_id: r.item_id,
      qty: r.qty,
      qty_ml: r.qty_ml,
      qty_gr: r.qty_gr,
    }));

    const { error: rErr } = await supabaseAdmin.from("waste_rows").insert(payload);
    if (rErr) return NextResponse.json({ ok: false, error: rErr.message }, { status: 500 });

    // 3) Scala PV-STOCK
    const scaled = await scalePvStock({ pv_id, rows: cleanRows });

    return NextResponse.json({ ok: true, header_id, scaled });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Errore server" }, { status: 500 });
  }
}
