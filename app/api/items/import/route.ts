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
  um?: string | null;
  peso_kg: number | null;
  prezzo_vendita_eur: number | null;
  conf_da: number | null;
  barcode?: string | null;
};

function normUm(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s;
}

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

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });

    // ✅ Nuovo schema: category_id obbligatorio (uuid). subcategory_id opzionale
    const category_id = String(form.get("category_id") ?? "").trim();
    const subcategory_id = String(form.get("subcategory_id") ?? "").trim() || null;

    // ✅ Vecchio schema legacy: category=TAB/GV
    const legacyCategory = String(form.get("category") ?? "").trim().toUpperCase() as "TAB" | "GV" | "";

    const usingNewSchema = !!category_id;

    if (usingNewSchema) {
      if (!isUuid(category_id)) return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });

      if (subcategory_id) {
        if (!isUuid(subcategory_id)) return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });

        // verifica appartenenza sottocategoria
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
    } else {
      if (!legacyCategory || !["TAB", "GV"].includes(legacyCategory)) {
        return NextResponse.json({ ok: false, error: "Categoria legacy non valida (TAB/GV)" }, { status: 400 });
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
    let umCol = -1;

    let pesoHeaderHint: string | null = null;

    // trova intestazioni nelle prime 60 righe
    for (let r = 1; r <= Math.min(ws.rowCount || 1, 60); r++) {
      const row = ws.getRow(r);

      let tmpCode = -1;
      let tmpDesc = -1;
      let tmpUm = -1;
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

        if (tmpUm === -1) {
          const isUm =
            t === "um" ||
            t === "u.m" ||
            t === "u.m." ||
            (t.includes("unit") && t.includes("mis")) ||
            (t.includes("unita") && t.includes("mis"));
          if (isUm) tmpUm = c;
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
        umCol = tmpUm;
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

      let um: string | null = null;
      if (umCol !== -1) {
        um = normUm(readCellString(row.getCell(umCol)));
      }

      extracted.push({
        code,
        description: desc || code,
        um,
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

      const barcodeNorm = r.barcode == null ? null : String(r.barcode).trim() || null;

      map.set(code, {
        code,
        description: (r.description || code).trim(),
        um: r.um == null ? null : String(r.um).trim() || null,
        peso_kg: pesoNorm,
        prezzo_vendita_eur: prezzoNorm,
        conf_da: confNorm,
        barcode: barcodeNorm,
      });
    }

    const deduped = Array.from(map.values());
    const codes = deduped.map((r) => r.code);

    // ===== import barcode-only: aggiorna barcode su esistenti (per categoria) =====
    if (barcodeImportMode) {
      let updated = 0;
      let not_found = 0;

      if (usingNewSchema) {
        const existingMap = await getExistingItemsByCodeNew(category_id, codes);

        // update per chunk
        const chunkSize = 200;
        for (let i = 0; i < deduped.length; i += chunkSize) {
          const chunk = deduped.slice(i, i + chunkSize);

          const updates = [];
          for (const r of chunk) {
            const id = existingMap.get(r.code);
            if (!id) {
              not_found++;
              continue;
            }
            if (!r.barcode) continue;

            updates.push({ id, barcode: r.barcode, updated_at: new Date().toISOString() });
          }

          for (const u of updates) {
            const { error } = await supabaseAdmin.from("items").update(u).eq("id", u.id);
            if (error) throw error;
            updated++;
          }
        }

        return NextResponse.json({ ok: true, mode: "barcode", total: deduped.length, updated, not_found });
      } else {
        const existingMap = await getExistingItemsByCodeLegacy(legacyCategory as "TAB" | "GV", codes);

        const chunkSize = 200;
        for (let i = 0; i < deduped.length; i += chunkSize) {
          const chunk = deduped.slice(i, i + chunkSize);

          const updates = [];
          for (const r of chunk) {
            const id = existingMap.get(r.code);
            if (!id) {
              not_found++;
              continue;
            }
            if (!r.barcode) continue;

            updates.push({ id, barcode: r.barcode, updated_at: new Date().toISOString() });
          }

          for (const u of updates) {
            const { error } = await supabaseAdmin.from("items").update(u).eq("id", u.id);
            if (error) throw error;
            updated++;
          }
        }

        return NextResponse.json({ ok: true, mode: "barcode", total: deduped.length, updated, not_found });
      }
    }

    // ===== import completo: upsert logico (insert se non esiste, update se esiste) =====
    let inserted = 0;
    let updated = 0;

    if (usingNewSchema) {
      const existingMap = await getExistingItemsByCodeNew(category_id, codes);

      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      for (const r of deduped) {
        const existingId = existingMap.get(r.code);
        if (!existingId) {
          toInsert.push({
            category_id,
            subcategory_id,
            code: r.code,
            description: r.description,
            barcode: r.barcode == null ? null : r.barcode,
            um: r.um == null ? null : r.um,
            peso_kg: r.peso_kg,
            conf_da: r.conf_da,
            prezzo_vendita_eur: r.prezzo_vendita_eur,
            is_active: true,
          });
        } else {
          toUpdate.push({
            id: existingId,
            description: r.description,
            barcode: r.barcode == null ? null : r.barcode,
            um: r.um == null ? null : r.um,
            peso_kg: r.peso_kg,
            conf_da: r.conf_da,
            prezzo_vendita_eur: r.prezzo_vendita_eur,
            updated_at: new Date().toISOString(),
          });
        }
      }

      // insert in chunk
      const chunkSize = 500;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error } = await supabaseAdmin.from("items").insert(chunk);
        if (error) throw error;
        inserted += chunk.length;
      }

      // update one by one (safe)
      for (const u of toUpdate) {
        const { error } = await supabaseAdmin.from("items").update(u).eq("id", u.id);
        if (error) throw error;
        updated++;
      }

      return NextResponse.json({ ok: true, total: deduped.length, inserted, updated, skipped_no_code });
    } else {
      const existing = await getExistingCodesLegacy(legacyCategory as "TAB" | "GV", codes);

      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      for (const r of deduped) {
        if (!existing.has(r.code)) {
          toInsert.push({
            category: legacyCategory,
            code: r.code,
            description: r.description,
            barcode: r.barcode == null ? null : r.barcode,
            um: r.um == null ? null : r.um,
            peso_kg: r.peso_kg,
            conf_da: r.conf_da,
            prezzo_vendita_eur: r.prezzo_vendita_eur,
            is_active: true,
          });
        } else {
          toUpdate.push({
            code: r.code,
            description: r.description,
            barcode: r.barcode == null ? null : r.barcode,
            um: r.um == null ? null : r.um,
            peso_kg: r.peso_kg,
            conf_da: r.conf_da,
            prezzo_vendita_eur: r.prezzo_vendita_eur,
            updated_at: new Date().toISOString(),
          });
        }
      }

      // insert in chunk
      const chunkSize = 500;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error } = await supabaseAdmin.from("items").insert(chunk);
        if (error) throw error;
        inserted += chunk.length;
      }

      // update one by one (safe)
      for (const u of toUpdate) {
        const { error } = await supabaseAdmin.from("items").update(u).eq("category", legacyCategory).eq("code", u.code);
        if (error) throw error;
        updated++;
      }

      return NextResponse.json({ ok: true, total: deduped.length, inserted, updated, skipped_no_code });
    }
  } catch (e: any) {
    console.error("[items/import] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Errore import" }, { status: 500 });
  }
}















