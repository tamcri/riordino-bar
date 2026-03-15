// app/api/inventories/progressivi/upload/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}
function isIsoDate(v: string | null) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function normCell(v: any) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

function normCodeCompact(v: any) {
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function isTotalRowCode(v: any) {
  const s = String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return false;
  return s.includes("totalegenerale") || s === "totale";
}

/**
 * Parser numerico "normale" per carico/scarico.
 * Qui va bene un number JS.
 */
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const raw = String(v).trim();
  if (!raw) return null;

  let s = raw.replace(/\s+/g, "");

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }

  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

/**
 * ✅ Per giacenza fiscale NON vogliamo arrotondamenti.
 * Ritorno il valore come stringa numerica normalizzata:
 * - "12,245" -> "12.245"
 * - "12.245" -> "12.245"
 * - 12.245   -> "12.245"
 * - "1.234,56" -> "1234.56"
 *
 * Senza Number(), così non perdiamo precisione/formattazione decimale.
 */
function toExactDecimalString(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return String(v);
  }

  let s = String(v).trim();
  if (!s) return null;

  s = s.replace(/\s+/g, "");

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    // formato tipo 1.234,56
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    // formato tipo 12,245
    s = s.replace(",", ".");
  }
  // se ha solo il punto, lo lasciamo così

  // validazione minima
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;

  return s;
}

// equivalenza PZ + frazione (ML o GR) se presenti
function toEquivQty(row: any): number {
  const qty = Number(row?.qty ?? 0) || 0;

  const volume = Number(row?.items?.volume_ml_per_unit ?? 0) || 0;
  const qty_ml = Number(row?.qty_ml ?? 0) || 0;

  const pesoKg = Number(row?.items?.peso_kg ?? 0) || 0;
  const qty_gr = Number(row?.qty_gr ?? 0) || 0;

  if (volume > 0) {
    const frac = qty_ml > 0 ? qty_ml / volume : 0;
    return qty + frac;
  }

  if (pesoKg > 0) {
    const denom = pesoKg * 1000;
    const frac = denom > 0 && qty_gr > 0 ? qty_gr / denom : 0;
    return qty + frac;
  }

  return qty;
}

async function getExcludedCategoryIds() {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id,name,slug")
    .eq("is_active", true);

  if (error) throw error;

  const ids = new Set<string>();
  for (const c of data || []) {
    const name = String((c as any)?.name ?? "").toLowerCase();
    const slug = String((c as any)?.slug ?? "").toLowerCase();
    if (name.includes("tabacc") || slug.includes("tabacc")) ids.add((c as any).id);
    if (name.includes("gratta") || name.includes("vinci") || slug.includes("gratta")) ids.add((c as any).id);
  }
  return ids;
}

function findHeaderRow(aoa: any[][]) {
  for (let i = 0; i < Math.min(aoa.length, 60); i++) {
    const row = aoa[i] || [];
    const tokens = new Set(row.map(normCell));
    const hasCod = tokens.has("cod articolo") || tokens.has("codice articolo") || tokens.has("cod");
    const hasCar = tokens.has("tot carico qta1");
    const hasSca = tokens.has("tot scarico qta1");
    if (hasCod && hasCar && hasSca) return i;
  }
  return -1;
}

function buildHeaders(aoa: any[][], headerRowIdx: number) {
  const h1 = (aoa[headerRowIdx] || []).map((x) => String(x ?? "").trim());
  const h2 = (aoa[headerRowIdx + 2] || []).map((x) => String(x ?? "").trim());
  const headers: string[] = [];

  const maxLen = Math.max(h1.length, h2.length);
  for (let c = 0; c < maxLen; c++) {
    const a = String(h1[c] ?? "").trim();
    const b = String(h2[c] ?? "").trim();

    if (a && b && normCell(b) === "fiscale" && normCell(a).startsWith("giacenza qta1")) {
      headers[c] = `${a} ${b}`;
    } else if (a) {
      headers[c] = a;
    } else {
      headers[c] = "";
    }
  }

  return headers;
}

/**
 * ✅ Riconta valida SOLO per quella data progressivo che stai caricando.
 * Non si porta avanti sugli inventari successivi.
 */
async function loadRecountedItemCodesForExactDate(pv_id: string, inventory_date: string) {
  const { data, error } = await supabaseAdmin
    .from("inventory_recount_events")
    .select("item_code")
    .eq("pv_id", pv_id)
    .eq("inventory_date", inventory_date);

  if (error) throw error;

  const out = new Set<string>();
  for (const row of data || []) {
    const code = normCodeCompact((row as any)?.item_code);
    if (!code) continue;
    out.add(code);
  }
  return out;
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const fd = await req.formData();
  const file = fd.get("file") as File | null;
  const pv_id = String(fd.get("pv_id") ?? "").trim();
  const inventory_date = String(fd.get("inventory_date") ?? "").trim();

  if (!file) return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });
  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  if (!isIsoDate(inventory_date)) return NextResponse.json({ ok: false, error: "inventory_date non valida" }, { status: 400 });

  try {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];

    if (!aoa.length) return NextResponse.json({ ok: false, error: "File vuoto" }, { status: 400 });

    const headerRowIdx = findHeaderRow(aoa);
    if (headerRowIdx < 0) {
      return NextResponse.json(
        { ok: false, error: "Non trovo la riga intestazioni nel file. Controlla che sia il report 'Progressivi'." },
        { status: 400 }
      );
    }

    const headers = buildHeaders(aoa, headerRowIdx);
    const keyToIdx = new Map<string, number>();
    headers.forEach((h, i) => {
      const k = normCell(h);
      if (k) keyToIdx.set(k, i);
    });

    const idxCod = keyToIdx.get("cod articolo") ?? keyToIdx.get("codice articolo") ?? keyToIdx.get("cod") ?? null;
    const idxCar = keyToIdx.get("tot carico qta1") ?? null;
    const idxSca = keyToIdx.get("tot scarico qta1") ?? null;
    const idxFis = keyToIdx.get("giacenza qta1 fiscale") ?? keyToIdx.get("giacenza qta1") ?? null;

    if (idxCod === null || idxCar === null || idxSca === null || idxFis === null) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Colonne minime mancanti. Servono: 'Cod. Articolo', 'Tot carico qta1', 'Tot scarico qta1', 'Giacenza qta1 fiscale'.",
        },
        { status: 400 }
      );
    }

    const uploadedRows: any[] = [];
    const uploadedMap = new Map<string, any>();

    for (let r = headerRowIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];

      const code = String(row[idxCod] ?? "").trim();
      if (!code) continue;

      // ✅ escludi righe totale / totale generale
      if (isTotalRowCode(code)) continue;

      const tot_carico_qta1 = toNum(row[idxCar]);
      const tot_scarico_qta1 = toNum(row[idxSca]);

      // ✅ nessun arrotondamento sulla giacenza fiscale
      const giacenza_qta1_fiscale = toExactDecimalString(row[idxFis]);

      if (
        tot_carico_qta1 === null &&
        tot_scarico_qta1 === null &&
        giacenza_qta1_fiscale === null
      ) {
        continue;
      }

      const normalized = normCodeCompact(code);
      if (!normalized) continue;

      const payloadRow = {
        pv_id,
        inventory_date,
        item_code: code,
        tot_carico_qta1,
        tot_scarico_qta1,
        giacenza_qta1_fiscale,
        created_by: session.username,
      };

      uploadedRows.push(payloadRow);
      uploadedMap.set(normalized, payloadRow);
    }

    if (!uploadedRows.length) {
      return NextResponse.json({ ok: false, error: "Nessuna riga valida trovata nel file" }, { status: 400 });
    }

    const recountedCodes = await loadRecountedItemCodesForExactDate(pv_id, inventory_date);

    const { data: prevHeader, error: prevErr } = await supabaseAdmin
      .from("inventory_progressivi_rows")
      .select("inventory_date")
      .eq("pv_id", pv_id)
      .lt("inventory_date", inventory_date)
      .order("inventory_date", { ascending: false })
      .limit(1);

    if (prevErr) throw prevErr;
    const prev_date = (prevHeader?.[0] as any)?.inventory_date
      ? String((prevHeader?.[0] as any).inventory_date)
      : null;

    let finalRowsToWrite = uploadedRows;

    // ✅ Regola riconta:
    // se ci sono articoli ricontati e ho un progressivo precedente,
    // parto dal progressivo precedente e aggiorno SOLO la giacenza fiscale degli articoli ricontati.
    if (recountedCodes.size > 0 && prev_date) {
      const { data: prevRows, error: prevRowsErr } = await supabaseAdmin
        .from("inventory_progressivi_rows")
        .select("item_code, tot_carico_qta1, tot_scarico_qta1, giacenza_qta1_fiscale")
        .eq("pv_id", pv_id)
        .eq("inventory_date", prev_date);

      if (prevRowsErr) throw prevRowsErr;

      const mergedMap = new Map<string, any>();

      for (const pr of prevRows || []) {
        const prevCode = String((pr as any)?.item_code ?? "").trim();
        if (!prevCode) continue;
        if (isTotalRowCode(prevCode)) continue;

        const normalizedPrevCode = normCodeCompact(prevCode);
        if (!normalizedPrevCode) continue;

        mergedMap.set(normalizedPrevCode, {
          pv_id,
          inventory_date,
          item_code: prevCode,
          tot_carico_qta1: (pr as any)?.tot_carico_qta1 ?? null,
          tot_scarico_qta1: (pr as any)?.tot_scarico_qta1 ?? null,
          giacenza_qta1_fiscale:
            (pr as any)?.giacenza_qta1_fiscale !== null &&
            (pr as any)?.giacenza_qta1_fiscale !== undefined
              ? String((pr as any).giacenza_qta1_fiscale)
              : null,
          created_by: session.username,
        });
      }

      for (const code of recountedCodes) {
        const uploaded = uploadedMap.get(code);
        if (!uploaded) continue;

        const base = mergedMap.get(code);

        if (base) {
          mergedMap.set(code, {
            ...base,
            item_code: uploaded.item_code || base.item_code,
            // ✅ aggiorno SOLO la giacenza fiscale
            giacenza_qta1_fiscale: uploaded.giacenza_qta1_fiscale,
            created_by: session.username,
          });
        } else {
          // se un articolo ricontato non esisteva nel progressivo precedente,
          // lo inserisco usando la riga del file nuovo
          mergedMap.set(code, { ...uploaded });
        }
      }

      finalRowsToWrite = Array.from(mergedMap.values());
    }

    // ✅ riscrittura pulita della data corrente per evitare righe stale
    const { error: deleteCurrentErr } = await supabaseAdmin
      .from("inventory_progressivi_rows")
      .delete()
      .eq("pv_id", pv_id)
      .eq("inventory_date", inventory_date);

    if (deleteCurrentErr) {
      return NextResponse.json({ ok: false, error: deleteCurrentErr.message }, { status: 500 });
    }

    const { error: upErr } = await supabaseAdmin
      .from("inventory_progressivi_rows")
      .insert(finalRowsToWrite);

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    // La parte sotto resta invariata (serve a logiche interne legacy)
    // -------------------------------------------------------------
    const { data: curRows, error: curErr } = await supabaseAdmin
      .from("inventory_progressivi_rows")
      .select("item_code, tot_carico_qta1, tot_scarico_qta1, giacenza_qta1_fiscale")
      .eq("pv_id", pv_id)
      .eq("inventory_date", inventory_date);
    if (curErr) throw curErr;

    const prevMap = new Map<string, any>();
    if (prev_date) {
      const { data: prevRows2, error: prevRowsErr2 } = await supabaseAdmin
        .from("inventory_progressivi_rows")
        .select("item_code, tot_carico_qta1, tot_scarico_qta1, giacenza_qta1_fiscale")
        .eq("pv_id", pv_id)
        .eq("inventory_date", prev_date);
      if (prevRowsErr2) throw prevRowsErr2;
      for (const pr of prevRows2 || []) prevMap.set(String((pr as any).item_code), pr);
    }

    const excluded = await getExcludedCategoryIds();

    const { data: invNow, error: invNowErr } = await supabaseAdmin
      .from("inventories")
      .select("qty, qty_ml, qty_gr, items:items(code, category_id, volume_ml_per_unit, peso_kg)")
      .eq("pv_id", pv_id)
      .eq("inventory_date", inventory_date);
    if (invNowErr) throw invNowErr;

    const invNowMap = new Map<string, number>();
    for (const rr of invNow || []) {
      const code2 = String((rr as any)?.items?.code ?? "").trim();
      const catId = String((rr as any)?.items?.category_id ?? "").trim();
      if (!code2) continue;
      if (catId && excluded.has(catId)) continue;
      invNowMap.set(code2, toEquivQty(rr));
    }

    const invPrevMap = new Map<string, number>();
    if (prev_date) {
      const { data: invPrev, error: invPrevErr } = await supabaseAdmin
        .from("inventories")
        .select("qty, qty_ml, qty_gr, items:items(code, category_id, volume_ml_per_unit, peso_kg)")
        .eq("pv_id", pv_id)
        .eq("inventory_date", prev_date);
      if (invPrevErr) throw invPrevErr;

      for (const rr of invPrev || []) {
        const code2 = String((rr as any)?.items?.code ?? "").trim();
        const catId = String((rr as any)?.items?.category_id ?? "").trim();
        if (!code2) continue;
        if (catId && excluded.has(catId)) continue;
        invPrevMap.set(code2, toEquivQty(rr));
      }
    }

    return NextResponse.json({
      ok: true,
      rows: finalRowsToWrite.length,
      prev_date,
      recount_mode_applied: recountedCodes.size > 0 && !!prev_date,
      recounted_items_count: recountedCodes.size,
    });
  } catch (e: any) {
    console.error("[progressivi/upload] error", e);
    return NextResponse.json({ ok: false, error: e?.message || "Errore upload progressivi" }, { status: 500 });
  }
}