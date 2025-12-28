import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import ExcelJS from "exceljs";
import { processReorderExcel } from "@/lib/excel/reorder";

export const runtime = "nodejs";

function normCode(v: any): string {
  return String(v ?? "").trim();
}
function normDesc(v: any): string {
  return String(v ?? "").trim();
}

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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
      const { data: catRow, error: catErr } = await supabaseAdmin
        .from("categories")
        .select("id")
        .eq("id", category_id as string)
        .maybeSingle();

      if (catErr) return NextResponse.json({ ok: false, error: catErr.message }, { status: 500 });
      if (!catRow) return NextResponse.json({ ok: false, error: "Categoria non trovata" }, { status: 400 });

      // subcategory deve appartenere alla category
      if (subcategory_id) {
        const { data: subRow, error: subErr } = await supabaseAdmin
          .from("subcategories")
          .select("id, category_id")
          .eq("id", subcategory_id)
          .maybeSingle();

        if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });
        if (!subRow) return NextResponse.json({ ok: false, error: "Sottocategoria non trovata" }, { status: 400 });
        if (subRow.category_id !== category_id) {
          return NextResponse.json(
            { ok: false, error: "La sottocategoria non appartiene alla categoria selezionata" },
            { status: 400 }
          );
        }
      }
    }

    const input = await file.arrayBuffer();

    // 1) Excel generico (header-based robusto)
    let extracted: { code: string; description: string }[] = [];

    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(input);

      const ws = wb.worksheets[0];
      if (ws) {
        const cellText = (row: ExcelJS.Row, col: number) =>
          String(((row.getCell(col) as any)?.text ?? row.getCell(col).value ?? "")).trim().toLowerCase();

        let headerRow = -1;
        let codeCol = -1;
        let descCol = -1;

        for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) {
          const row = ws.getRow(r);
          for (let c = 1; c <= Math.min(ws.columnCount || 30, 30); c++) {
            const t = cellText(row, c);
            if (codeCol === -1 && ["codice", "cod", "codice articolo", "cod. articolo", "code", "articolo"].some(k => t.includes(k))) {
              codeCol = c;
            }
            if (descCol === -1 && ["descrizione", "descr", "description"].some(k => t.includes(k))) {
              descCol = c;
            }
          }

          if (codeCol !== -1 && descCol !== -1 && codeCol !== descCol) {
            headerRow = r;
            break;
          } else {
            codeCol = -1;
            descCol = -1;
          }
        }

        if (headerRow !== -1) {
          for (let rr = headerRow + 1; rr <= ws.rowCount; rr++) {
            const row2 = ws.getRow(rr);

            const code = normCode((row2.getCell(codeCol) as any)?.text ?? row2.getCell(codeCol).value);
            const desc = normDesc((row2.getCell(descCol) as any)?.text ?? row2.getCell(descCol).value);

            if (!code && !desc) continue;

            const low = `${code} ${desc}`.toLowerCase();
            if (low.includes("pagina") && low.includes("di")) continue;

            if (code) extracted.push({ code, description: desc || code });
          }
        }
      }
    } catch {
      // fallback sotto
    }

    // 2) fallback TAB gestionale (solo legacy TAB)
    const legacyCategory = legacyCategoryRaw as "TAB" | "GV";
    if (!useNew && extracted.length === 0 && legacyCategory === "TAB") {
      const { rows } = await processReorderExcel(input);
      extracted = rows
        .map((r: any) => ({
          code: normCode(r.codArticolo),
          description: normDesc(r.descrizione),
        }))
        .filter((x) => x.code);
    }

    if (extracted.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Non sono riuscito a trovare colonne Codice/Descrizione. Usa un Excel con intestazioni (Codice Articolo, Descrizione).",
        },
        { status: 400 }
      );
    }

    // dedup
    const map = new Map<string, { code: string; description: string }>();
    for (const r of extracted) {
      const code = normCode(r.code);
      const description = normDesc(r.description) || code;
      if (!code) continue;
      map.set(code, { code, description });
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
        is_active: true,
        updated_at: now,
      }));

      const { error: upErr } = await supabaseAdmin
        .from("items")
        .upsert(payload, { onConflict: "category_id,code" });

      if (upErr) {
        console.error("[items/import][new] upsert error:", upErr);
        return NextResponse.json({ ok: false, error: upErr.message || "Errore import" }, { status: 500 });
      }

      // conteggi: li stimiamo leggendo gli esistenti prima (veloce e chiaro)
      // se vuoi, li rendiamo precisi con una query aggiuntiva; qui restiamo semplici.
      return NextResponse.json({
        ok: true,
        mode: "new",
        category_id,
        subcategory_id: subcategory_id || null,
        total: rows.length,
        inserted: null,
        updated: null,
      });
    }

    // ===== LEGACY MODE: invariato =====
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
      is_active: true,
      updated_at: now,
    }));

    const { error: upErr } = await supabaseAdmin
      .from("items")
      .upsert(payload, { onConflict: "category,code" });

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
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) || "Errore interno" },
      { status: 500 }
    );
  }
}


