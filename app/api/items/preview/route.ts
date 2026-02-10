// app/api/items/preview/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

function readCellString(cell: ExcelJS.Cell): string {
  const v: any = (cell as any)?.value;
  const t: any = (cell as any)?.text;

  if (typeof t === "string" && t.trim()) return t.trim();
  if (v == null) return "";

  if (typeof v === "object") {
    if ((v as any).result != null) return String((v as any).result ?? "").trim();

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

function isProbablyHeaderCodeCell(t: string) {
  const s = t.toLowerCase().trim();
  return ["codice", "cod", "codice articolo", "cod. articolo", "cod_articolo", "code", "item code"].some((k) => s.includes(k));
}
function isProbablyHeaderDescCell(t: string) {
  const s = t.toLowerCase().trim();
  return ["descrizione", "descr", "description"].some((k) => s.includes(k));
}
function isProbablyHeaderBarcodeCell(t: string) {
  const s = t.toLowerCase().trim();
  return ["barcode", "bar code", "ean", "ean13", "codice a barre", "codice barre"].some((k) => s.includes(k));
}
function isProbablyHeaderUmCell(t: string) {
  const s = t.toLowerCase().trim().replace(/\s+/g, " ");
  if (s === "um" || s === "u.m" || s === "u.m.") return true;
  const hasUnit = s.includes("unit") || s.includes("unita") || s.includes("unità");
  const hasMis = s.includes("mis");
  return hasUnit && hasMis;
}
function isProbablyHeaderPrezzoCell(t: string) {
  const s = t.toLowerCase().trim();
  const hasPrezzo = s.includes("prezzo");
  const isCosto = s.includes("costo") || s.includes("acquisto") || s.includes("carico");
  if (!hasPrezzo || isCosto) return false;
  return true;
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Solo admin può fare l'anteprima import" }, { status: 401 });
  }

  try {
    const fd = await req.formData();
    const file = fd.get("file") as File | null;
    const maxRows = Math.max(1, Math.min(Number(fd.get("max_rows") || 20), 50));

    if (!file) return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });

    // ✅ FIX: niente Buffer (evita errori TS), uso Uint8Array
    const ab = await file.arrayBuffer();
    const data = new Uint8Array(ab);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as any);

    const ws = wb.worksheets[0];
    if (!ws) return NextResponse.json({ ok: false, error: "Foglio Excel non trovato" }, { status: 400 });

    let headerRow = -1;
    let codeCol = -1;
    let descCol = -1;
    let barcodeCol = -1;
    let umCol = -1;
    let prezzoCol = -1;

    for (let r = 1; r <= Math.min(ws.rowCount || 1, 60); r++) {
      const row = ws.getRow(r);

      let tmpCode = -1;
      let tmpDesc = -1;
      let tmpBarcode = -1;
      let tmpUm = -1;
      let tmpPrezzo = -1;

      for (let c = 1; c <= Math.min(ws.columnCount || 30, 40); c++) {
        const t = readCellString(row.getCell(c));
        if (!t) continue;

        if (tmpCode === -1 && isProbablyHeaderCodeCell(t)) tmpCode = c;
        if (tmpDesc === -1 && isProbablyHeaderDescCell(t)) tmpDesc = c;
        if (tmpBarcode === -1 && isProbablyHeaderBarcodeCell(t)) tmpBarcode = c;
        if (tmpUm === -1 && isProbablyHeaderUmCell(t)) tmpUm = c;
        if (tmpPrezzo === -1 && isProbablyHeaderPrezzoCell(t)) tmpPrezzo = c;
      }

      if (tmpCode !== -1) {
        headerRow = r;
        codeCol = tmpCode;
        descCol = tmpDesc;
        barcodeCol = tmpBarcode;
        umCol = tmpUm;
        prezzoCol = tmpPrezzo;
        break;
      }
    }

    if (headerRow === -1 || codeCol === -1) {
      return NextResponse.json({ ok: false, error: "Intestazioni non trovate (manca la colonna Codice)" }, { status: 400 });
    }

    const rows: Array<{
      code: string;
      description: string;
      barcode: string | null;
      um: string | null;
      prezzo: string | null;
    }> = [];

    for (let r = headerRow + 1; r <= Math.min(ws.rowCount || headerRow + 1, headerRow + 5000); r++) {
      const row = ws.getRow(r);

      const code = readCellString(row.getCell(codeCol)).trim();
      if (!code) continue;

      const description = descCol !== -1 ? readCellString(row.getCell(descCol)).trim() : "";
      const barcode = barcodeCol !== -1 ? readCellString(row.getCell(barcodeCol)).trim() : "";
      const um = umCol !== -1 ? readCellString(row.getCell(umCol)).trim() : "";
      const prezzo = prezzoCol !== -1 ? readCellString(row.getCell(prezzoCol)).trim() : "";

      rows.push({
        code,
        description: description || code,
        barcode: barcode || null,
        um: um || null,
        prezzo: prezzo || null,
      });

      if (rows.length >= maxRows) break;
    }

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    console.error("[items/preview] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Errore preview" }, { status: 500 });
  }
}



