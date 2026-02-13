import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

type Line = { item_id: string; qty: number };

type Body = {
  deposit_id?: string;
  inventory_date?: string; // YYYY-MM-DD
  operator_name?: string | null;
  notes?: string | null;
  lines?: Line[];
};

function normText(v: any): string {
  return String(v ?? "").trim();
}

function toNumber(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON non valido" }, { status: 400 });
  }

  const deposit_id = normText(body.deposit_id);
  const inventory_date = normText(body.inventory_date);
  const operator_name = body.operator_name == null ? null : normText(body.operator_name);
  const notes = body.notes == null ? null : normText(body.notes);
  const lines = Array.isArray(body.lines) ? body.lines : [];

  if (!deposit_id) return NextResponse.json({ ok: false, error: "deposit_id obbligatorio" }, { status: 400 });
  if (!inventory_date) return NextResponse.json({ ok: false, error: "inventory_date obbligatorio (YYYY-MM-DD)" }, { status: 400 });
  if (lines.length === 0) return NextResponse.json({ ok: false, error: "lines vuoto" }, { status: 400 });

  // deposito + pv_id
  const { data: dep, error: depErr } = await supabaseAdmin
    .from("deposits")
    .select("id, pv_id")
    .eq("id", deposit_id)
    .maybeSingle();

  if (depErr) return NextResponse.json({ ok: false, error: depErr.message }, { status: 500 });
  if (!dep) return NextResponse.json({ ok: false, error: "Deposito non trovato" }, { status: 404 });

  // permessi PV
  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    const pv_id = r.pv_id;
    if (!pv_id) return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    if (pv_id !== String((dep as any).pv_id)) {
      return NextResponse.json({ ok: false, error: "Deposito non trovato" }, { status: 404 });
    }
  }

  const pv_id = String((dep as any).pv_id);

  // 1) insert testata
  const { data: inv, error: invErr } = await supabaseAdmin
    .from("deposit_inventories")
    .insert({
      deposit_id,
      pv_id,
      inventory_date,
      operator_name,
      notes,
    })
    .select("id, deposit_id, pv_id, inventory_date, operator_name, notes, created_at")
    .single();

  if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });

  const inventory_id = String((inv as any).id);

  // 2) insert righe (deduplicate per item_id, ultima vince)
  const map = new Map<string, number>();
  for (const l of lines) {
    const item_id = normText((l as any).item_id);
    const qtyN = toNumber((l as any).qty);
    if (!item_id || qtyN == null) continue;
    map.set(item_id, qtyN);
  }

  if (map.size === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga valida (item_id/qty)" }, { status: 400 });
  }

  const rows = Array.from(map.entries()).map(([item_id, qty]) => ({
    inventory_id,
    item_id,
    qty,
  }));

  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from("deposit_inventory_rows").insert(chunk);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // 3) apply stock (set qty + set 0 missing)
  const { error: rpcErr } = await supabaseAdmin.rpc("apply_deposit_inventory_stock", { p_inventory_id: inventory_id });
  if (rpcErr) return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, inventory: inv, rows_inserted: rows.length });
}
