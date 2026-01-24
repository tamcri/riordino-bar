// app/api/items/import/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

function normCode(v: any): string {
  return String(v ?? "").trim();
}
function normDesc(v: any): string {
  return String(v ?? "").trim();
}
function normBarcode(v: any): string {
  const s = String(v ?? "").trim();
  return s; // barcode come stringa (può avere zeri iniziali)
}

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

// Lettura cella robusta (testo/numero/formula)
function readCellString(cell: ExcelJS.Cell): string {
  const anyCell: any = cell as any;

  const t = String(anyCell?.text ?? "").trim();
  if (t) return t;

  const v = anyCell?.value;
  if (v == null) return "";

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return String(Math.trunc(v));
  }

  if (typeof v === "object") {
    if (typeof (v as any).result === "number") return String(Math.trunc((v as any).result));
    if (typeof (v as any).result === "string") return String((v as any).result).trim();
    if (Array.isArray((v as any).richText)) {
      try {
        const s = ((v as any).richText || []).map((x: any) => x?.text ?? "").join("");
        return String(s).trim();
      } catch {
        return "";
      }
    }
  }

  return String(v).trim();
}

type ExtractedRow = {
  code: string;
  description: string;
  peso_kg: number | null;
  prezzo_vendita_eur: number | null;
  conf_da: number | null;
  barcode?: string | null;
};

function parsePesoKg(cellText: string, headerHint: string | null): number | null {
  const t0 = String(cellText ?? "").trim();
  if (!t0) return null;

  const cleaned = t0.replace(/\s+/g, " ").replace(",", ".").toLowerCase();
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;

  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;

  const h = (headerHint || "").toLowerCase();

  if (
    h.includes("gram") ||
    h.includes(" gr") ||
    h === "g" ||
    cleaned.includes("gram") ||
    cleaned.includes(" gr") ||
    cleaned.endsWith("g")
  ) {
    return n / 1000;
  }

  return n;
}

function parsePrezzoEur(cellText: string): number | null {
  const t0 = String(cellText ?? "").trim();
  if (!t0) return null;

  const cleaned = t0
    .replace(/\s+/g, " ")
    .replace("€", "")
    .replace(/\u20AC/g, "")
    .trim()
    .replace(",", ".");

  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;

  const n = Number(m[0]);
  if (!Number.isFinite(n) || n < 0) return null;

  return n;
}

function parseConfDa(cellText: string): number | null {
  const t0 = String(cellText ?? "").trim();
  if (!t0) return null;

  const cleaned = t0.replace(",", ".").toLowerCase();
  const m = cleaned.match(/\d+/);
  if (!m) return null;

  const n = Math.trunc(Number(m[0]));
  if (!Number.isFinite(n) || n < 2) return null;

  return n;
}

// ====== LEGACY (TAB/GV) ======
async function getExistingCodesLegacy(category: "TAB" | "GV", codes: string[]) {
  const existing = new Set<string>();
  const chunkSize = 500;

  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("items")
      .select("code")
      .eq("category", category)
      .in("code", chunk);

    if (error) throw error;
    (data || []).forEach((r: any) => existing.add(r.code));
  }

  return existing;
}

async function getExistingItemsByCodeNew(category_id: string, codes: string[]) {
  const map = new Map<string, string>(); // code -> id
  const chunkSize = 500;

  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("items")
      .select("id, code")
      .eq("category_id", category_id)
      .in("code", chunk);

    if (error) throw error;
    (data || []).forEach((r: any) => {
      if (r?.code && r?.id) map.set(String(r.code), String(r.id));
    });
  }

  return map;
}

async function getExistingItemsByCodeLegacy(category: "TAB" | "GV", codes: string[]) {
  const map = new Map<string, string>(); // code -> id
  const chunkSize = 500;

  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("items")
      .select("id, code")
      .eq("category", category)
      .in("code", chunk);

    if (error) throw error;
    (data || []).forEach((r: any) => {
      if (r?.code && r?.id) map.set(String(r.code), String(r.id));
    });
  }

  return map;
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Solo admin può importare articoli" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    // NEW
    const category_id = String(formData.get("category_id") ?? "").trim() || null;
    const subcategory_id = String(formData.get("subcategory_id") ?? "").trim() || null;

    // LEGACY
    const legacyCategoryRaw = String(formData.get("category") ?? "").toUpperCase().trim(); // TAB | GV

    if (!file) return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });

    const useNew = isUuid(category_id);

    if (!useNew) {
      if (!["TAB", "GV"].includes(legacyCategoryRaw)) {
        return NextResponse.json(
          { ok: false, error: "Categoria non valida. Usa category_id (nuovo) oppure category=TAB|GV (legacy)." },
          { status: 400 }
        );
      }
    } else {
      if (subcategory_id && !isUuid(subcategory_id)) {
        return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
      }

      const { data: catRow, error: catErr } = await supabaseAdmin
        .from("categories")
        .select("id")
        .eq("id", category_id as string)
        .maybeSingle();
      if (catErr) return NextResponse.json({ ok: false, error: catErr.message }, { status: 500 });
      if (!catRow) return NextResponse.json({ ok: false, error: "Categoria non trovata" }, { status: 400 });

      if (subcategory_id) {
        const { data: subRow, error: subErr } = await supabaseAdmin
          .from("subcategories")
          .select("id, category_id")
          .eq("id", subcategory_id)
          .maybeSingle();
        if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });
        if (!subRow) return NextResponse.json({ ok: false, error: "Sottocategoria non trovata" }, { status: 400 });
        if (subRow.category_id !== category_id) {
          return NextResponse.json({ ok: false, error: "La sottocategoria non appartiene alla categoria selezionata" }, { status: 400 });
        }
      }
    }

    const input = await file.arrayBuffer();

    const extracted: ExtractedRow[] = [];

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(input);

    const ws = wb.worksheets[0];
    if (!ws) {
      return NextResponse.json({ ok: false, error: "Foglio Excel non trovato" }, { status: 400 });
    }

    const cellTextLower = (row: ExcelJS.Row, col: number) => {
      const cell = row.getCell(col);
      const t = String((cell as any)?.text ?? cell.value ?? "").trim().toLowerCase();
      return t;
    };

    let headerRow = -1;
    let codeCol = -1;
    let descCol = -1;
    let pesoCol = -1;
    let prezzoVenditaCol = -1;
    let confDaCol = -1;
    let barcodeCol = -1;

    let pesoHeaderHint: string | null = null;

    // trova intestazioni nelle prime 60 righe
    for (let r = 1; r <= Math.min(ws.rowCount || 1, 60); r++) {
      const row = ws.getRow(r);

      let tmpCode = -1;
      let tmpDesc = -1;
      let tmpPeso = -1;
      let tmpPrezzoVendita = -1;
      let tmpConfDa = -1;
      let tmpBarcode = -1;

      let tmpPesoHint: string | null = null;

      for (let c = 1; c <= Math.min(ws.columnCount || 30, 40); c++) {
        const t = cellTextLower(row, c);
        if (!t) continue;

        // match "Codice" stretto
        if (
          tmpCode === -1 &&
          ["codice", "cod", "codice articolo", "cod. articolo", "cod_articolo", "code", "item code"].some((k) => t.includes(k))
        ) {
          tmpCode = c;
        }

        if (tmpDesc === -1 && ["descrizione", "descr", "description", "articolo descrizione"].some((k) => t.includes(k))) {
          tmpDesc = c;
        }

        if (
          tmpPeso === -1 &&
          ["peso", "peso articolo", "peso (kg)", "peso kg", "peso_kg", "kg", "grammi", "gr", "g"].some((k) => t.includes(k))
        ) {
          tmpPeso = c;
          tmpPesoHint = t;
        }

        if (tmpPrezzoVendita === -1) {
          const hasPrezzo = t.includes("prezzo");
          const hasVendita = t.includes("vendita");
          const isCosto = t.includes("costo") || t.includes("acquisto") || t.includes("carico");
          const looksLikeVendita =
            ["prezzo di vendita", "prezzo vendita", "prezzo vend", "vendita", "prezzo"].some((k) => t.includes(k)) && !isCosto;

          if ((hasPrezzo || hasVendita) && looksLikeVendita) {
            tmpPrezzoVendita = c;
          }
        }

        if (tmpConfDa === -1) {
          const hasConf = t.includes("conf");
          const hasConfez = t.includes("confez");
          const hasDa = /\bda\b/.test(t);
          const hasPz = t.includes("pz") || t.includes("pezzi") || t.includes("pezzo");

          if (hasConf || hasConfez) {
            if (hasDa || hasPz || t.includes("confezione") || t.includes("confez")) {
              tmpConfDa = c;
            }
          }
        }

        if (tmpBarcode === -1) {
          if (["barcode", "bar code", "ean", "ean13", "codice a barre", "codice barre"].some((k) => t.includes(k))) {
            tmpBarcode = c;
          }
        }
      }

      if (tmpCode !== -1) {
        headerRow = r;
        codeCol = tmpCode;
        descCol = tmpDesc;
        pesoCol = tmpPeso;
        prezzoVenditaCol = tmpPrezzoVendita;
        confDaCol = tmpConfDa;
        barcodeCol = tmpBarcode;
        pesoHeaderHint = tmpPesoHint;
        break;
      }
    }

    if (headerRow === -1 || codeCol === -1) {
      return NextResponse.json(
        {
          ok: false,
          error: "Non sono riuscito a trovare la colonna Codice. Usa un Excel con intestazione tipo 'Codice'/'Codice Articolo' e 'Barcode'.",
        },
        { status: 400 }
      );
    }

    // barcode import: serve Barcode, e NON devono esserci Peso/Prezzo/Conf. (Descrizione può esserci)
    const barcodeImportMode = barcodeCol !== -1 && pesoCol === -1 && prezzoVenditaCol === -1 && confDaCol === -1;

    let skipped_no_code = 0;

    for (let rr = headerRow + 1; rr <= (ws.rowCount || headerRow); rr++) {
      const row = ws.getRow(rr);

      const code = normCode(readCellString(row.getCell(codeCol)));
      if (!code) {
        skipped_no_code++;
        continue;
      }

      const desc = descCol !== -1 ? normDesc(readCellString(row.getCell(descCol))) : "";

      const low = `${code} ${desc}`.toLowerCase();
      if (low.includes("pagina") && low.includes("di")) continue;

      let peso_kg: number | null = null;
      if (pesoCol !== -1) {
        const pText = String(readCellString(row.getCell(pesoCol)) ?? "").trim();
        peso_kg = parsePesoKg(pText, pesoHeaderHint);
      }

      let prezzo_vendita_eur: number | null = null;
      if (prezzoVenditaCol !== -1) {
        const prText = String(readCellString(row.getCell(prezzoVenditaCol)) ?? "").trim();
        prezzo_vendita_eur = parsePrezzoEur(prText);
      }

      let conf_da: number | null = null;
      if (confDaCol !== -1) {
        const cText = String(readCellString(row.getCell(confDaCol)) ?? "").trim();
        conf_da = parseConfDa(cText);
      }

      let barcode: string | null = null;
      if (barcodeCol !== -1) {
        const bText = normBarcode(readCellString(row.getCell(barcodeCol)));
        barcode = bText ? bText : null;
      }

      extracted.push({
        code,
        description: desc || code,
        peso_kg,
        prezzo_vendita_eur,
        conf_da,
        barcode,
      });
    }

    if (extracted.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessuna riga valida trovata (dopo intestazioni)." }, { status: 400 });
    }

    // dedup by code (ultima vince)
    const map = new Map<string, ExtractedRow>();
    for (const r of extracted) {
      const code = normCode(r.code);
      if (!code) continue;

      const pesoNorm = typeof r.peso_kg === "number" && Number.isFinite(r.peso_kg) ? r.peso_kg : null;
      const prezzoNorm =
        typeof r.prezzo_vendita_eur === "number" && Number.isFinite(r.prezzo_vendita_eur) ? r.prezzo_vendita_eur : null;
      const confNorm =
        typeof r.conf_da === "number" && Number.isFinite(r.conf_da) && r.conf_da >= 2 ? Math.trunc(r.conf_da) : null;

      const barcodeNorm =
        r.barcode === undefined ? undefined : r.barcode && String(r.barcode).trim() ? String(r.barcode).trim() : null;

      map.set(code, {
        code,
        description: normDesc(r.description) || code,
        peso_kg: pesoNorm,
        prezzo_vendita_eur: prezzoNorm,
        conf_da: confNorm,
        barcode: barcodeNorm ?? null,
      });
    }

    const rows = Array.from(map.values()).filter((r) => r && r.code && String(r.code).trim() !== "");
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessun codice valido trovato (dopo dedup)." }, { status: 400 });
    }

    const codes = rows.map((r) => r.code);
    const now = new Date().toISOString();

    // ==========================
    // BARCODE IMPORT MODE (UPDATE ONLY, NO INSERT)
    // ==========================
    if (barcodeImportMode) {
      if (useNew) {
        const existing = await getExistingItemsByCodeNew(category_id as string, codes);

        // ✅ FIX: includo SEMPRE code (e description) per evitare insert con code=null in casi limite
        const payload = rows
          .map((r) => {
            const id = existing.get(r.code);
            if (!id) return null;
            return {
              id,
              code: r.code,
              description: r.description,
              barcode: r.barcode ?? null,
              updated_at: now,
            };
          })
          .filter(Boolean) as any[];

        const updated = payload.length;
        const not_found = rows.length - updated;

        if (payload.length > 0) {
          const { error: upErr } = await supabaseAdmin.from("items").upsert(payload, { onConflict: "id" });
          if (upErr) {
            console.error("[items/import][barcode][new] upsert error:", upErr);
            return NextResponse.json({ ok: false, error: upErr.message || "Errore import barcode" }, { status: 500 });
          }
        }

        return NextResponse.json({
          ok: true,
          mode: "barcode",
          schema: "new",
          category_id,
          subcategory_id: subcategory_id || null,
          total: rows.length,
          updated,
          not_found,
          skipped_no_code,
        });
      } else {
        const legacyCategory = legacyCategoryRaw as "TAB" | "GV";
        const existing = await getExistingItemsByCodeLegacy(legacyCategory, codes);

        // ✅ FIX: includo SEMPRE code (e description)
        const payload = rows
          .map((r) => {
            const id = existing.get(r.code);
            if (!id) return null;
            return {
              id,
              code: r.code,
              description: r.description,
              barcode: r.barcode ?? null,
              updated_at: now,
            };
          })
          .filter(Boolean) as any[];

        const updated = payload.length;
        const not_found = rows.length - updated;

        if (payload.length > 0) {
          const { error: upErr } = await supabaseAdmin.from("items").upsert(payload, { onConflict: "id" });
          if (upErr) {
            console.error("[items/import][barcode][legacy] upsert error:", upErr);
            return NextResponse.json({ ok: false, error: upErr.message || "Errore import barcode" }, { status: 500 });
          }
        }

        return NextResponse.json({
          ok: true,
          mode: "barcode",
          schema: "legacy",
          category: legacyCategory,
          total: rows.length,
          updated,
          not_found,
          skipped_no_code,
        });
      }
    }

    // ==========================
    // NORMAL IMPORT MODE (UPSERT ANAGRAFICA)
    // ==========================
    if (useNew) {
      const payload = rows.map((r) => ({
        category_id,
        subcategory_id: subcategory_id || null,
        code: r.code,
        description: r.description,
        barcode: r.barcode ?? null,
        peso_kg: r.peso_kg,
        prezzo_vendita_eur: r.prezzo_vendita_eur,
        conf_da: r.conf_da,
        is_active: true,
        updated_at: now,
      }));

      const { error: upErr } = await supabaseAdmin.from("items").upsert(payload, { onConflict: "category_id,code" });
      if (upErr) {
        console.error("[items/import][new] upsert error:", upErr);
        return NextResponse.json({ ok: false, error: upErr.message || "Errore import" }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        mode: "new",
        category_id,
        subcategory_id: subcategory_id || null,
        total: rows.length,
        skipped_no_code,
      });
    }

    const legacyCategory = legacyCategoryRaw as "TAB" | "GV";

    let existingSet: Set<string>;
    try {
      existingSet = await getExistingCodesLegacy(legacyCategory, codes);
    } catch (e: any) {
      console.error("[items/import][legacy] existing fetch error:", e);
      return NextResponse.json({ ok: false, error: "Errore lettura DB" }, { status: 500 });
    }

    const inserted = rows.filter((r) => !existingSet.has(r.code)).length;
    const updated = rows.filter((r) => existingSet.has(r.code)).length;

    const payload = rows.map((r) => ({
      category: legacyCategory,
      code: r.code,
      description: r.description,
      barcode: r.barcode ?? null,
      peso_kg: r.peso_kg,
      prezzo_vendita_eur: r.prezzo_vendita_eur,
      conf_da: r.conf_da,
      is_active: true,
      updated_at: now,
    }));

    const { error: upErr } = await supabaseAdmin.from("items").upsert(payload, { onConflict: "category,code" });
    if (upErr) {
      console.error("[items/import][legacy] upsert error:", upErr);
      return NextResponse.json({ ok: false, error: upErr.message || "Errore import" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      mode: "legacy",
      category: legacyCategory,
      total: rows.length,
      inserted,
      updated,
      skipped_no_code,
    });
  } catch (e: any) {
    console.error("[items/import] FATAL:", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) || "Errore interno" }, { status: 500 });
  }
}














