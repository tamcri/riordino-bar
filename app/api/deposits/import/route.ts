import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

const ITEM_CODE_COL = "code"; // colonna reale nel DB

function normText(v: any): string {
  return String(v ?? "").trim();
}

function normCode(v: any): string {
  return normText(v).toUpperCase();
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

type ImportRow = { code: string; description: string | null };

function findHeaderColumnIndex(headerRow: ExcelJS.Row, candidates: string[]): number | null {
  const want = candidates.map((s) => s.trim().toLowerCase());

  for (let i = 1; i <= headerRow.cellCount; i++) {
    const cell = headerRow.getCell(i);
    const text = readCellString(cell).trim().toLowerCase();
    if (!text) continue;
    if (want.includes(text)) return i;
  }

  return null;
}

type ItemMini = {
  id: string;
  code: string;
  category_text: string | null;     // items.category (testuale, se esiste)
  category_id: string | null;       // FK
  category_name: string | null;     // categories.name (risolto via category_id)
};

function normCat(v: any): string | null {
  const s = String(v ?? "").trim();
  return s ? s.toUpperCase() : null;
}

function isExcludedCategory(cat: string | null): boolean {
  if (!cat) return false;
  const c = cat.toUpperCase();

  // TABACCHI
  if (c === "TAB" || c.includes("TABACCH")) return true;

  // GRATTa e VINCI
  if (c === "GV" || c.includes("GRATTA") || c.includes("VINCI")) return true;

  return false;
}

async function getItemsByCodes(codes: string[]) {
  // map CODE -> ItemMini
  const map = new Map<string, ItemMini>();
  const chunkSize = 500;

  // 1) prendo items (con category + category_id)
  const itemsByCategoryId = new Map<string, string[]>(); // cat_id -> [CODE,...] (solo per quelli senza category_text)

  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);

    const { data, error } = await supabaseAdmin
      .from("items")
      .select(`id, ${ITEM_CODE_COL}, category, category_id`)
      .in(ITEM_CODE_COL, chunk);

    if (error) throw error;

    for (const r of Array.isArray(data) ? data : []) {
      const code = normCode((r as any)[ITEM_CODE_COL]);
      const id = normText((r as any).id);
      const category_text = normCat((r as any).category);
      const category_id = normText((r as any).category_id) || null;

      if (code && id) {
        map.set(code, {
          id,
          code,
          category_text,
          category_id,
          category_name: null, // la risolviamo dopo se serve
        });

        if (!category_text && category_id) {
          const arr = itemsByCategoryId.get(category_id) || [];
          arr.push(code);
          itemsByCategoryId.set(category_id, arr);
        }
      }
    }
  }

  // 2) se manca category_text, risolvo via categories usando category_id
  const categoryIds = Array.from(itemsByCategoryId.keys());
  if (categoryIds.length > 0) {
    // chunk anche qui
    for (let i = 0; i < categoryIds.length; i += chunkSize) {
      const chunk = categoryIds.slice(i, i + chunkSize);

      const { data: cats, error: catsErr } = await supabaseAdmin
        .from("categories")
        .select("id, name, slug")
        .in("id", chunk);

      if (catsErr) throw catsErr;

      const catNameById = new Map<string, string>();
      for (const c of Array.isArray(cats) ? cats : []) {
        const id = normText((c as any).id);
        const name = normCat((c as any).name) || normCat((c as any).slug);
        if (id && name) catNameById.set(id, name);
      }

      // riporto category_name sugli items che dipendono da questi id
      for (const catId of chunk) {
        const name = catNameById.get(catId) || null;
        const codesForCat = itemsByCategoryId.get(catId) || [];
        for (const code of codesForCat) {
          const it = map.get(code);
          if (it) it.category_name = name;
        }
      }
    }
  }

  return map;
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const form = await req.formData();
  const deposit_id = normText(form.get("deposit_id"));
  const file = form.get("file") as unknown as File | null;

  if (!deposit_id) return NextResponse.json({ ok: false, error: "deposit_id obbligatorio" }, { status: 400 });
  if (!file) return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });

  const { data: dep, error: depErr } = await supabaseAdmin
    .from("deposits")
    .select("id, pv_id")
    .eq("id", deposit_id)
    .maybeSingle();

  if (depErr) return NextResponse.json({ ok: false, error: depErr.message }, { status: 500 });
  if (!dep) return NextResponse.json({ ok: false, error: "Deposito non trovato" }, { status: 404 });

  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    const pv_id = r.pv_id;
    if (!pv_id) return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    if (pv_id !== String((dep as any).pv_id)) {
      return NextResponse.json({ ok: false, error: "Deposito non trovato" }, { status: 404 });
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);

  const ws = wb.worksheets?.[0];
  if (!ws) return NextResponse.json({ ok: false, error: "Foglio Excel non trovato" }, { status: 400 });

  let headerRow: ExcelJS.Row | null = null;
  let headerRowIndex = 0;

  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const row = ws.getRow(r);
    const rowText = row.values ? String(row.values).toLowerCase().replace(/\s+/g, " ") : "";
    if (rowText.includes("codice") || rowText.includes("code")) {
      headerRow = row;
      headerRowIndex = r;
      break;
    }
  }

  if (!headerRow) headerRow = ws.getRow(1);
  if (!headerRowIndex) headerRowIndex = headerRow.number;

  const colCode = findHeaderColumnIndex(headerRow, ["codice", "code", "cod.", "cod articolo", "cod. articolo"]);
  const colDesc = findHeaderColumnIndex(headerRow, ["descrizione", "description", "desc"]);

  if (!colCode) {
    return NextResponse.json(
      { ok: false, error: "Colonna 'Codice' non trovata. Attese colonne: Codice, Descrizione (opzionale)." },
      { status: 400 }
    );
  }

  const rows: ImportRow[] = [];
  const seen = new Set<string>();

  for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = normCode(readCellString(row.getCell(colCode)));
    if (!code) continue;

    if (seen.has(code)) continue;
    seen.add(code);

    const desc = colDesc ? normText(readCellString(row.getCell(colDesc))) : "";
    rows.push({ code, description: desc ? desc : null });
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga valida trovata (Codice vuoto)" }, { status: 400 });
  }

  const codes = rows.map((r) => r.code);

  let map: Map<string, ItemMini>;
  try {
    map = await getItemsByCodes(codes);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }

  const notFound: string[] = [];
  const excluded: { code: string; reason: string }[] = [];
  const toUpsert: any[] = [];

  for (const r of rows) {
    const item = map.get(r.code);
    if (!item) {
      notFound.push(r.code);
      continue;
    }

    // ✅ categoria robusta: prima items.category, altrimenti categories.name
    const cat = item.category_text || item.category_name || null;

    if (isExcludedCategory(cat)) {
      excluded.push({ code: r.code, reason: `Categoria non ammessa (${cat})` });
      continue;
    }

    toUpsert.push({
      deposit_id,
      item_id: item.id,
      imported_code: r.code,
      note_description: r.description,
      is_active: true,
    });
  }

  let upsertedCount = 0;
  if (toUpsert.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < toUpsert.length; i += chunkSize) {
      const chunk = toUpsert.slice(i, i + chunkSize);
      const { error } = await supabaseAdmin.from("deposit_items").upsert(chunk, { onConflict: "deposit_id,item_id" });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      upsertedCount += chunk.length;
    }
  }

  return NextResponse.json({
    ok: true,
    deposit_id,
    total_rows: rows.length,
    mapped: upsertedCount,
    not_found: notFound,
    excluded, // adesso esclusi davvero TAB/GV
  });
}




