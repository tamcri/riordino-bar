import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import path from "path";
import fs from "fs/promises";
import ExcelJS from "exceljs";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { fillU88Pdf, type U88Item } from "@/lib/pdf/fillU88";

export const runtime = "nodejs";

/* -------------------- helpers -------------------- */

function getSessionFromCookies() {
  const raw = cookies().get(COOKIE_NAME)?.value || "";
  return parseSessionValue(raw);
}

function normalize(text: string) {
  return (text || "")
    .toLowerCase()
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[àá]/g, "a")
    .replace(/[èé]/g, "e")
    .replace(/[ìí]/g, "i")
    .replace(/[òó]/g, "o")
    .replace(/[ùú]/g, "u")
    .trim();
}

function cellToText(cell: ExcelJS.Cell): string {
  const t = (cell.text || "").trim();
  if (t) return t;

  const v: any = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    if (typeof v.result === "string") return v.result.trim();
    if (typeof v.result === "number") return String(v.result);
    if (typeof v.text === "string") return v.text.trim();
    if (Array.isArray(v.richText)) return v.richText.map((x: any) => x?.text || "").join("").trim();
  }
  return "";
}

function cellToNumber(cell: ExcelJS.Cell): number {
  const v: any = cell.value;
  if (v == null) return 0;

  if (typeof v === "number" && Number.isFinite(v)) return v;

  if (typeof v === "string") {
    const t = v.replace(/\./g, "").replace(",", ".").replace(/\s/g, "");
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }

  if (typeof v === "object") {
    // formula
    if (typeof v.result === "number" && Number.isFinite(v.result)) return v.result;
    if (typeof v.result === "string") {
      const t = v.result.replace(/\./g, "").replace(",", ".").replace(/\s/g, "");
      const n = Number(t);
      return Number.isFinite(n) ? n : 0;
    }
  }

  // fallback: prova col testo
  const txt = cellToText(cell);
  if (txt) {
    const t = txt.replace(/\./g, "").replace(",", ".").replace(/\s/g, "");
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }

  return 0;
}

function findHeaderRow(ws: ExcelJS.Worksheet): number {
  // nel nostro export di solito è 3, ma se un domani cambia lo troviamo comunque
  const max = Math.min(20, ws.rowCount || 20);
  for (let r = 1; r <= max; r++) {
    const row = ws.getRow(r);
    const parts: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const s = normalize(cellToText(cell));
      if (s) parts.push(s);
    });
    const joined = parts.join(" | ");
    if (
      joined.includes("cod") &&
      joined.includes("articolo") &&
      joined.includes("descrizione") &&
      joined.includes("qta") &&
      joined.includes("ordinare")
    ) {
      return r;
    }
  }
  return -1;
}

function findColumn(ws: ExcelJS.Worksheet, headerRow: number, predicate: (h: string) => boolean): number {
  const row = ws.getRow(headerRow);
  let found = -1;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const h = normalize(cellToText(cell));
    if (!h) return;
    if (found === -1 && predicate(h)) found = colNumber;
  });
  return found;
}

/* -------------------- handler -------------------- */

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const session = getSessionFromCookies();
  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const reorderId = ctx.params.id;

  // 1) prendo lo storico
  const { data: reorder, error: rErr } = await supabaseAdmin
    .from("reorders")
    .select("id,type,export_path,pv_label,created_by_username")
    .eq("id", reorderId)
    .single();

  if (rErr || !reorder) {
    return NextResponse.json({ ok: false, error: "Storico non trovato" }, { status: 404 });
  }

  if (reorder.type !== "TAB") {
    return NextResponse.json({ ok: false, error: "U88 disponibile solo per TAB" }, { status: 400 });
  }

  // 2) scarico l’xlsx generato (quello “pulito”)
  const { data: fileBlob, error: dErr } = await supabaseAdmin.storage
    .from("reorders")
    .download(reorder.export_path);

  if (dErr || !fileBlob) {
    console.error("[U88] download xlsx error:", dErr);
    return NextResponse.json({ ok: false, error: "Errore download Excel" }, { status: 500 });
  }

  const ab = await fileBlob.arrayBuffer();

  // 3) leggo righe da Excel (foglio “RIORDINO TAB”)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ab);

  const ws = wb.worksheets[0];
  if (!ws) return NextResponse.json({ ok: false, error: "Excel non valido" }, { status: 400 });

  const headerRow = findHeaderRow(ws);
  if (headerRow === -1) {
    return NextResponse.json({ ok: false, error: "Header non trovato nel file riordino TAB" }, { status: 400 });
  }

  // colonne per NOME (robuste)
  const cCod = findColumn(ws, headerRow, (h) => h.includes("cod") && h.includes("articolo"));
  const cDesc = findColumn(ws, headerRow, (h) => h.includes("descrizione"));
  const cQtaOrd = findColumn(ws, headerRow, (h) => h.includes("qta") && h.includes("ordinare"));
  const cValOrd = findColumn(ws, headerRow, (h) => h.includes("valore") && h.includes("ordinare"));
  const cPeso = findColumn(ws, headerRow, (h) => h.includes("peso") || (h.includes("qta") && h.includes("peso")));

  if (cDesc === -1 || cQtaOrd === -1) {
    return NextResponse.json(
      { ok: false, error: "Mancano colonne chiave nel file (Descrizione / Qtà da ordinare)" },
      { status: 400 }
    );
  }

  const firstDataRow = headerRow + 1;

  const items: U88Item[] = [];
  for (let r = firstDataRow; r <= ws.rowCount; r++) {
    const descr = cellToText(ws.getCell(r, cDesc)).trim();
    const cod = cCod !== -1 ? cellToText(ws.getCell(r, cCod)).trim() : "";

    // stop su TOTALI (evita di leggere la riga somme)
    if (normalize(descr) === "totali") break;

    const qtaOrd = cellToNumber(ws.getCell(r, cQtaOrd));
    if (!cod && !descr) continue;
    if (qtaOrd <= 0) continue;

    const valoreDaOrdinare = cValOrd !== -1 ? cellToNumber(ws.getCell(r, cValOrd)) : 0;

    // peso in kg: dal file pulito oppure fallback
    const pesoKgFromFile = cPeso !== -1 ? cellToNumber(ws.getCell(r, cPeso)) : 0;
    const pesoKg = pesoKgFromFile > 0 ? pesoKgFromFile : Number((qtaOrd * 0.02).toFixed(1));

    items.push({
      descrizione: descr,
      pesoKg,
      valoreDaOrdinare,
    });
  }

  // 4) carico template U88 da filesystem
  const templatePath = path.join(process.cwd(), "lib", "pdf", "templates", "U88.pdf");
  const templateBytes = await fs.readFile(templatePath);

  // 5) compilo pdf
  const { pdf, missing } = await fillU88Pdf(
  new Uint8Array(templateBytes),
  items
);

if (missing.length > 0) {
  console.log("❌ U88 – ARTICOLI NON MATCHATI:", missing.length);
  console.log(JSON.stringify(missing, null, 2));
}
const outName = `U88_${reorder?.pv_label || "PV"}_${reorderId}.pdf`
  .replace(/\s+/g, "_")
  .replace(/[^\w\-\.]/g, "");


return new NextResponse(Buffer.from(pdf), {
  status: 200,
  headers: {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${outName}"`,

    "cache-control": "no-store",
  },
});

}

