import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function normText(v: any): string {
  return String(v ?? "").trim();
}

function normCode(v: any): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\u00A0/g, "");
}

function toNumber(v: any): number | null {
  if (v == null) return null;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function pickFirstKey(row: any, keys: string[]) {
  const lowerMap = new Map<string, string>();
  for (const k of Object.keys(row || {})) lowerMap.set(k.toLowerCase().trim(), k);
  for (const want of keys) {
    const real = lowerMap.get(want.toLowerCase());
    if (real) return real;
  }
  return null;
}

function toNullableMlPerUnit(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "FormData non valido" }, { status: 400 });

  const deposit_id = normText(form.get("deposit_id"));
  const inventory_date = normText(form.get("inventory_date")); // YYYY-MM-DD
  const file = form.get("file") as File | null;

  if (!deposit_id) return NextResponse.json({ ok: false, error: "deposit_id obbligatorio" }, { status: 400 });
  if (!inventory_date) return NextResponse.json({ ok: false, error: "inventory_date obbligatorio (YYYY-MM-DD)" }, { status: 400 });
  if (!file) return NextResponse.json({ ok: false, error: "file obbligatorio" }, { status: 400 });

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

  // 1) leggo excel (raw:false per preservare formattazione e zeri iniziali)
  const buf = Buffer.from(await file.arrayBuffer());
  let rows: any[] = [];
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as any[];
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Errore lettura Excel: ${e?.message || "XLSX"}` }, { status: 400 });
  }

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "Excel vuoto (nessuna riga dati)" }, { status: 400 });
  }

  const kCode = pickFirstKey(rows[0], [
    "Codice articolo",
    "Cod. Articolo",
    "Codice",
    "Codice Articolo",
    "CodArticolo",
    "codice",
  ]);

  const kQty = pickFirstKey(rows[0], [
    "Giac.fisc.1",
    "Giacenza qta1",
    "Giacenza",
    "Qta",
    "Quantità",
    "qty",
  ]);

  const kUm = pickFirstKey(rows[0], ["Um1", "UM1", "Um", "UM", "U.M.", "Unita misura"]);

  if (!kCode || !kQty) {
    return NextResponse.json(
      {
        ok: false,
        error: `Non trovo colonne. Serve una colonna codice e una colonna quantità. Trovate: ${Object.keys(rows[0] || {}).join(", ")}`,
      },
      { status: 400 }
    );
  }

  // 2) mappa codice->qty (qui qty è "unità gestionali": spesso PZ)
  // NB: conversioni LT/CL le faccio solo se nel file esistono davvero (tu dici che di solito è tutto PZ)
  const codeToQty = new Map<string, number>();
  const codeToUm = new Map<string, string>();

  for (const r of rows) {
    const code = normCode((r as any)[kCode]);
    let qtyN = toNumber((r as any)[kQty]);
    if (!code || qtyN == null) continue;

    const um = kUm ? normText((r as any)[kUm]).toUpperCase() : "";
    codeToUm.set(code, um);

    // se il file per caso avesse LT/CL/ML, normalizzo a ML
    if (um === "LT") qtyN = qtyN * 1000;
    else if (um === "CL") qtyN = qtyN * 10;
    // ML o PZ: lascio così

    // qty finale numerica (se ML può essere non intera -> arrotondo)
    codeToQty.set(code, Math.round(qtyN));
  }

  if (codeToQty.size === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga valida (codice/qty)" }, { status: 400 });
  }

  // 3) risolvo item_id + capacità ML dall’anagrafica
  const codes = Array.from(codeToQty.keys());
  const chunkSize = 1000;

  type ItemMini = { id: string; code: string; volume_ml_per_unit: any; um: any };
  const codeToItem = new Map<string, { id: string; ml_per_unit: number | null; um: string }>();

  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);

    const { data, error } = await supabaseAdmin
      .from("items")
      .select("id, code, volume_ml_per_unit, um")
      .in("code", chunk);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    for (const it of (data || []) as ItemMini[]) {
      const c = normCode((it as any).code);
      const ml = toNullableMlPerUnit((it as any).volume_ml_per_unit);
      const um = normText((it as any).um).toUpperCase();
      if (c) codeToItem.set(c, { id: String((it as any).id), ml_per_unit: ml, um });
    }
  }

  // 4) creo inventario "gestionale"
  const { data: inv, error: invErr } = await supabaseAdmin
    .from("deposit_inventories")
    .insert({
      deposit_id,
      pv_id,
      inventory_date,
      operator_name: "GESTIONALE",
      notes: "Import giacenze da gestionale (Giac.fisc.1) — liquidi normalizzati in ML se capacità presente",
    })
    .select("id, deposit_id, pv_id, inventory_date, operator_name, notes, created_at")
    .single();

  if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });

  const inventory_id = String((inv as any).id);

  // 5) insert righe inventario
  // Regola:
  // - Se l’articolo ha volume_ml_per_unit > 0 -> considero la qty gestionale come PZ e converto in ML (qty * ml_per_unit)
  // - Altrimenti salvo qty così com’è (intero)
  const invRows: { inventory_id: string; item_id: string; qty: number }[] = [];
  const unknownCodes: string[] = [];

  for (const [code, qty] of codeToQty.entries()) {
    const it = codeToItem.get(code);
    if (!it?.id) {
      unknownCodes.push(code);
      continue;
    }

    let outQty = qty;

    if (it.ml_per_unit && it.ml_per_unit > 0) {
      // interpretazione: file = PZ -> ML
      outQty = Math.max(0, Math.round(qty * it.ml_per_unit));
    }

    invRows.push({ inventory_id, item_id: it.id, qty: outQty });
  }

  if (invRows.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Nessun codice del gestionale corrisponde all’anagrafica articoli (probabili zeri iniziali / formati codice)",
        unknownCodes: unknownCodes.slice(0, 50),
        detected_columns: { code: kCode, qty: kQty, um: kUm },
      },
      { status: 400 }
    );
  }

  for (let i = 0; i < invRows.length; i += chunkSize) {
    const chunk = invRows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from("deposit_inventory_rows").insert(chunk);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // 6) applico stock deposito
  const { error: rpcErr } = await supabaseAdmin.rpc("apply_deposit_inventory_stock", { p_inventory_id: inventory_id });
  if (rpcErr) return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    inventory: inv,
    rows_inserted: invRows.length,
    unknown_codes_count: unknownCodes.length,
    unknown_codes_sample: unknownCodes.slice(0, 50),
    detected_columns: { code: kCode, qty: kQty, um: kUm },
  });
}





