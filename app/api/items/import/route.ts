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

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

type ExtractedRow = {
  code: string;
  description: string;
  peso_kg: number | null;
  prezzo_vendita_eur: number | null;
  conf_da: number | null; // ✅ NEW
};

/**
 * PESO: tu mi hai confermato che nel tuo file è in KG.
 * Mantengo comunque parsing robusto:
 * - 0,02 / 0.02 / "0,02 kg" ecc.
 * - se proprio qualcuno mette "20 g" lo converte (ma non è richiesto)
 */
function parsePesoKg(cellText: string, headerHint: string | null): number | null {
  const t0 = String(cellText ?? "").trim();
  if (!t0) return null;

  const cleaned = t0.replace(/\s+/g, " ").replace(",", ".").toLowerCase();
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;

  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;

  const h = (headerHint || "").toLowerCase();

  // Se per caso header/cella parlano di grammi, converto
  if (h.includes("gram") || h.includes(" gr") || h === "g" || cleaned.includes("gram") || cleaned.includes(" gr") || cleaned.endsWith("g")) {
    return n / 1000;
  }

  // Default: KG (come da tuo file)
  return n;
}

/**
 * Prezzo vendita in EUR:
 * - "12,34" / "12.34" / "€ 12,34" / "12,34 €" ecc.
 * - ritorna null se vuoto o non numerico
 * - accetta anche 0 (se proprio serve)
 */
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

/**
 * Conf. da:
 * - accetta numeri tipo "10", "20", "conf 20", "20 pz" ecc.
 * - ritorna null se vuoto / non valido
 * - accetta solo >= 2
 */
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
    const { data, error } = await supabaseAdmin.from("items").select("code").eq("category", category).in("code", chunk);

    if (error) throw error;
    (data || []).forEach((r: any) => existing.add(r.code));
  }

  return existing;
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

      // category_id deve esistere
      const { data: catRow, error: catErr } = await supabaseAdmin.from("categories").select("id").eq("id", category_id as string).maybeSingle();
      if (catErr) return NextResponse.json({ ok: false, error: catErr.message }, { status: 500 });
      if (!catRow) return NextResponse.json({ ok: false, error: "Categoria non trovata" }, { status: 400 });

      // subcategory deve appartenere alla category
      if (subcategory_id) {
        const { data: subRow, error: subErr } = await supabaseAdmin.from("subcategories").select("id, category_id").eq("id", subcategory_id).maybeSingle();
        if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });
        if (!subRow) return NextResponse.json({ ok: false, error: "Sottocategoria non trovata" }, { status: 400 });
        if (subRow.category_id !== category_id) {
          return NextResponse.json({ ok: false, error: "La sottocategoria non appartiene alla categoria selezionata" }, { status: 400 });
        }
      }
    }

    const input = await file.arrayBuffer();

    // ✅ Excel header-based robusto + Peso + Prezzo Vendita + Conf. da
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

    let pesoHeaderHint: string | null = null;

    // trova intestazioni nelle prime 60 righe
    for (let r = 1; r <= Math.min(ws.rowCount || 1, 60); r++) {
      const row = ws.getRow(r);

      let tmpCode = -1;
      let tmpDesc = -1;
      let tmpPeso = -1;
      let tmpPrezzoVendita = -1;
      let tmpConfDa = -1;

      let tmpPesoHint: string | null = null;

      for (let c = 1; c <= Math.min(ws.columnCount || 30, 40); c++) {
        const t = cellTextLower(row, c);
        if (!t) continue;

        if (
          tmpCode === -1 &&
          ["codice", "cod", "codice articolo", "cod. articolo", "code", "articolo", "cod_articolo"].some((k) => t.includes(k))
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

        // Prezzo di vendita: includo "prezzo" / "vendita" ma escludo colonne costo/acquisto/carico
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

        // ✅ Conf. da (confezione)
        if (tmpConfDa === -1) {
          const hasConf = t.includes("conf");
          const hasConfez = t.includes("confez");
          const hasDa = /\bda\b/.test(t);
          const hasPz = t.includes("pz") || t.includes("pezzi") || t.includes("pezzo");

          // esempi: "Conf. da", "Conf da", "Confezione", "Confez.", "Conf (pz)"
          if (hasConf || hasConfez) {
            // preferisco colonne tipo "conf da" o "confezione"
            if (hasDa || hasPz || t.includes("confezione") || t.includes("confez")) {
              tmpConfDa = c;
            }
          }
        }
      }

      if (tmpCode !== -1 && tmpDesc !== -1 && tmpCode !== tmpDesc) {
        headerRow = r;
        codeCol = tmpCode;
        descCol = tmpDesc;
        pesoCol = tmpPeso; // opzionale
        prezzoVenditaCol = tmpPrezzoVendita; // opzionale
        confDaCol = tmpConfDa; // opzionale
        pesoHeaderHint = tmpPesoHint;
        break;
      }
    }

    if (headerRow === -1) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Non sono riuscito a trovare le colonne Codice/Descrizione. Usa un Excel con intestazioni tipo 'Codice Articolo' e 'Descrizione' (e opzionali 'Peso', 'Prezzo di Vendita', 'Conf. da').",
        },
        { status: 400 }
      );
    }

    for (let rr = headerRow + 1; rr <= (ws.rowCount || headerRow); rr++) {
      const row = ws.getRow(rr);

      const codeCell = row.getCell(codeCol);
      const descCell = row.getCell(descCol);

      const code = normCode((codeCell as any)?.text ?? codeCell.value);
      const desc = normDesc((descCell as any)?.text ?? descCell.value);

      if (!code && !desc) continue;

      const low = `${code} ${desc}`.toLowerCase();
      if (low.includes("pagina") && low.includes("di")) continue;

      let peso_kg: number | null = null;
      if (pesoCol !== -1) {
        const pCell = row.getCell(pesoCol);
        const pText = String((pCell as any)?.text ?? pCell.value ?? "").trim();
        peso_kg = parsePesoKg(pText, pesoHeaderHint);
      }

      let prezzo_vendita_eur: number | null = null;
      if (prezzoVenditaCol !== -1) {
        const prCell = row.getCell(prezzoVenditaCol);
        const prText = String((prCell as any)?.text ?? prCell.value ?? "").trim();
        prezzo_vendita_eur = parsePrezzoEur(prText);
      }

      let conf_da: number | null = null;
      if (confDaCol !== -1) {
        const cCell = row.getCell(confDaCol);
        const cText = String((cCell as any)?.text ?? cCell.value ?? "").trim();
        conf_da = parseConfDa(cText);
      }

      if (code) {
        extracted.push({
          code,
          description: desc || code,
          peso_kg,
          prezzo_vendita_eur,
          conf_da,
        });
      }
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
      const prezzoNorm = typeof r.prezzo_vendita_eur === "number" && Number.isFinite(r.prezzo_vendita_eur) ? r.prezzo_vendita_eur : null;
      const confNorm = typeof r.conf_da === "number" && Number.isFinite(r.conf_da) && r.conf_da >= 2 ? Math.trunc(r.conf_da) : null;

      map.set(code, {
        code,
        description: normDesc(r.description) || code,
        peso_kg: pesoNorm,
        prezzo_vendita_eur: prezzoNorm,
        conf_da: confNorm,
      });
    }

    const rows = Array.from(map.values());
    const codes = rows.map((r) => r.code);

    const now = new Date().toISOString();

    // ===== NEW MODE: upsert su (category_id, code) =====
    if (useNew) {
      const payload = rows.map((r) => ({
        category_id,
        subcategory_id: subcategory_id || null,
        code: r.code,
        description: r.description,
        peso_kg: r.peso_kg,
        prezzo_vendita_eur: r.prezzo_vendita_eur,
        conf_da: r.conf_da, // ✅ NEW
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
      });
    }

    // ===== LEGACY MODE: upsert su (category, code) =====
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
      peso_kg: r.peso_kg,
      prezzo_vendita_eur: r.prezzo_vendita_eur,
      conf_da: r.conf_da, // ✅ NEW
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
    });
  } catch (e: any) {
    console.error("[items/import] FATAL:", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) || "Errore interno" }, { status: 500 });
  }
}










