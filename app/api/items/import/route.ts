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

function findHeaderIndexes(rowVals: any[]) {
  const cells = rowVals.map((v) => String(v ?? "").trim().toLowerCase());

  const codeIdx = cells.findIndex((t) =>
    ["cod", "codice", "codice articolo", "cod. articolo", "code", "articolo", "codarticolo"].some((k) =>
      t.includes(k)
    )
  );

  const descIdx = cells.findIndex((t) =>
    ["descr", "descrizione", "description", "articolo descrizione"].some((k) => t.includes(k))
  );

  if (codeIdx >= 0 && descIdx >= 0 && codeIdx !== descIdx) return { codeIdx, descIdx };
  return null;
}

async function getExistingCodes(category: "TAB" | "GV", codes: string[]) {
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
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Solo admin può importare articoli" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const categoryRaw = String(formData.get("category") ?? "").toUpperCase();

  if (!file) return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });
  if (!["TAB", "GV"].includes(categoryRaw)) {
    return NextResponse.json({ ok: false, error: "Categoria non valida" }, { status: 400 });
  }

  const category = categoryRaw as "TAB" | "GV";
  const input = await file.arrayBuffer();     // ✅ ArrayBuffer
const buf = Buffer.from(input);             // ✅ Buffer (se ti serve per altro)


  // 1) prova a leggere come Excel generico (header-based)
  let extracted: { code: string; description: string }[] = [];

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(input);

    const ws = wb.worksheets[0];
    if (ws) {
      let header: { codeIdx: number; descIdx: number } | null = null;

      // trova riga header
      for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) {
        const row = ws.getRow(r);
        const vals = row.values as any[];
        const found = findHeaderIndexes(vals);
        if (found) {
          header = found;
          // dalla riga successiva prendo i dati
          for (let rr = r + 1; rr <= ws.rowCount; rr++) {
            const row2 = ws.getRow(rr);
            const v = row2.values as any[];
            const code = normCode(v[header.codeIdx] ?? v[header.codeIdx + 1]); // exceljs row.values è 1-based spesso
            const desc = normDesc(v[header.descIdx] ?? v[header.descIdx + 1]);

            if (!code && !desc) continue;
            // filtri anti-sporco tipici
            const low = `${code} ${desc}`.toLowerCase();
            if (low.includes("pagina") && low.includes("di")) continue;

            if (code) extracted.push({ code, description: desc || code });
          }
          break;
        }
      }
    }
  } catch {
    // se fallisce, vediamo fallback sotto
  }

  // 2) fallback per gestionale TAB: usa il parser già robusto che hai
  if (extracted.length === 0 && category === "TAB") {
    const { rows } = await processReorderExcel(input);

    extracted = rows
      .map((r: any) => ({
        code: normCode(r.codArticolo),
        description: normDesc(r.descrizione),
      }))
      .filter((x) => x.code);
  }

  // se ancora vuoto → errore chiaro
  if (extracted.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Non sono riuscito a trovare colonne Codice/Descrizione. Usa un Excel con intestazioni (Codice Articolo, Descrizione) oppure carica il gestionale TAB.",
      },
      { status: 400 }
    );
  }

  // normalizza + dedup (category+code)
  const map = new Map<string, { code: string; description: string }>();
  for (const r of extracted) {
    const code = normCode(r.code);
    const description = normDesc(r.description) || code;
    if (!code) continue;
    map.set(code, { code, description });
  }

  const rows = Array.from(map.values());

  // conta inseriti/aggiornati
  const codes = rows.map((r) => r.code);
  let existingSet: Set<string>;
  try {
    existingSet = await getExistingCodes(category, codes);
  } catch (e: any) {
    console.error("[items/import] existing fetch error:", e);
    return NextResponse.json({ ok: false, error: "Errore lettura DB" }, { status: 500 });
  }

  const inserted = rows.filter((r) => !existingSet.has(r.code)).length;
  const updated = rows.filter((r) => existingSet.has(r.code)).length;

  // upsert
  const payload = rows.map((r) => ({
    category,
    code: r.code,
    description: r.description,
    is_active: true, // import = riattiva automaticamente
    updated_at: new Date().toISOString(),
  }));

  const { error: upErr } = await supabaseAdmin
    .from("items")
    .upsert(payload, { onConflict: "category,code" });

  if (upErr) {
    console.error("[items/import] upsert error:", upErr);
    return NextResponse.json({ ok: false, error: upErr.message || "Errore import" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    category,
    total: rows.length,
    inserted,
    updated,
  });
}
