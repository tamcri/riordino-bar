// lib/excel/reorder.ts
import ExcelJS from "exceljs";

/* -------------------- utils -------------------- */

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

function cellToNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.replace(/\./g, "").replace(",", ".").replace(/\s/g, "");
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object" && v) {
    if (typeof (v as any).result === "number") return (v as any).result;
    if (typeof (v as any).result === "string") return cellToNumber((v as any).result);
  }
  return 0;
}

// IMPORTANT: per i codici articolo usa cell.text (preserva zeri iniziali ecc.)
function cellToString(cell: ExcelJS.Cell): string {
  const t = (cell.text || "").trim();
  if (t) return t;

  const v: any = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v) {
    if (typeof v.result === "string") return v.result.trim();
    if (typeof v.result === "number") return String(v.result);
  }
  return "";
}

function findPvLabel(ws: ExcelJS.Worksheet): string {
  const maxRows = Math.min(12, ws.rowCount || 12);
  const maxCols = Math.min(60, ws.columnCount || 60);

  for (let r = 1; r <= maxRows; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCols; c++) {
      const txt = cellToString(row.getCell(c));
      if (!txt) continue;
      const low = txt.toLowerCase();
      if (low.includes("gestioni") || low.includes(" via ") || low.includes("fondi")) {
        return txt.trim();
      }
    }
  }
  return "Punto vendita";
}

function rowToStrings(row: ExcelJS.Row): string[] {
  const raw = row.values as unknown[]; // 1-based
  const out: string[] = [];
  for (let i = 1; i < raw.length; i++) out.push(raw[i] ? String(raw[i]) : "");
  return out;
}

function findColumnIndex(headers: string[], candidates: string[]) {
  const normHeaders = headers.map((h) => normalize(h));
  for (const cand of candidates) {
    const c = normalize(cand);
    const idx = normHeaders.findIndex((h) => h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/* -------------------- types -------------------- */

export type PreviewRow = {
  codArticolo: string;
  descrizione: string;
  qtaVenduta: number;
  valoreVenduto: number;
  giacenza: number;

  // ✅ NEW: quantità prima dell’arrotondamento (quella “proposta”)
  qtaTeorica: number;

  // ✅ NEW: confezione (default 10, poi l’API la sovrascrive da anagrafica)
  confDa: number;

  // arrotondata (l’API può ricalcolarla con confDa reale)
  qtaOrdine: number;

  valoreDaOrdinare: number;

  pesoKg: number; // viene valorizzato dall’API (o fallback)
};

/* -------------------- export pulito -------------------- */

export async function buildReorderXlsx(pvLabel: string, rows: PreviewRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RIORDINO TAB");

  ws.mergeCells("A1:I1");
  ws.getCell("A1").value = pvLabel;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

  const headerRow = 3;

  const headers = [
    "Cod. Articolo",
    "Descrizione",
    "Qtà Venduta",
    "Giacenza",
    "Qtà teorica",
    "Conf. da",
    "Qtà da ordinare",
    "Valore da ordinare",
    "Qtà in peso (kg)",
  ];

  ws.getRow(headerRow).values = headers;
  ws.getRow(headerRow).font = { bold: true };

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 52;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 12;
  ws.getColumn(6).width = 10;
  ws.getColumn(7).width = 16;
  ws.getColumn(8).width = 18;
  ws.getColumn(9).width = 12;

  let r = headerRow + 1;

  let totVend = 0;
  let totGiac = 0;
  let totTeo = 0;
  let totOrd = 0;
  let totValOrd = 0;
  let totPeso = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    ws.getRow(r).values = [
      row.codArticolo,
      row.descrizione,
      row.qtaVenduta,
      row.giacenza,
      row.qtaTeorica,
      row.confDa,
      row.qtaOrdine,
      row.valoreDaOrdinare,
      row.pesoKg,
    ];

    ws.getCell(r, 3).numFmt = "0";
    ws.getCell(r, 4).numFmt = "0";
    ws.getCell(r, 5).numFmt = "0";
    ws.getCell(r, 6).numFmt = "0";
    ws.getCell(r, 7).numFmt = "0";
    ws.getCell(r, 8).numFmt = "€ #,##0.00";
    ws.getCell(r, 9).numFmt = "0.0";

    totVend += Number(row.qtaVenduta || 0);
    totGiac += Number(row.giacenza || 0);
    totTeo += Number(row.qtaTeorica || 0);
    totOrd += Number(row.qtaOrdine || 0);
    totValOrd += Number(row.valoreDaOrdinare || 0);
    totPeso += Number(row.pesoKg || 0);

    r++;
  }

  const totalRow = r + 1;
  ws.getCell(totalRow, 2).value = "TOTALI";
  ws.getRow(totalRow).font = { bold: true };

  ws.getCell(totalRow, 3).value = totVend;
  ws.getCell(totalRow, 4).value = totGiac;
  ws.getCell(totalRow, 5).value = totTeo;
  ws.getCell(totalRow, 7).value = totOrd;
  ws.getCell(totalRow, 8).value = round2(totValOrd);
  ws.getCell(totalRow, 9).value = round1(totPeso);

  ws.getCell(totalRow, 3).numFmt = "0";
  ws.getCell(totalRow, 4).numFmt = "0";
  ws.getCell(totalRow, 5).numFmt = "0";
  ws.getCell(totalRow, 7).numFmt = "0";
  ws.getCell(totalRow, 8).numFmt = "€ #,##0.00";
  ws.getCell(totalRow, 9).numFmt = "0.0";

  const last = totalRow;
  for (let rr = headerRow; rr <= last; rr++) {
    for (let cc = 1; cc <= 9; cc++) {
      ws.getCell(rr, cc).border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as any);
}

/* -------------------- main parse -------------------- */

export async function parseReorderExcel(
  input: ArrayBuffer,
  weeks: number = 4,
  days?: number | null
): Promise<{ pvLabel: string; rows: PreviewRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);

  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("Foglio Excel non trovato");

  const pvLabel = findPvLabel(ws);

  // trova riga intestazioni (prime 30 righe)
  let headerRowNumber = -1;
  let headers: string[] = [];

  for (let r = 1; r <= 30; r++) {
    const row = ws.getRow(r);
    const vals = rowToStrings(row);
    const joined = normalize(vals.join(" | "));
    if (joined.includes("vend") && joined.includes("giacen")) {
      headerRowNumber = r;
      headers = vals;
      break;
    }
  }

  if (headerRowNumber === -1 || headers.length === 0) {
    throw new Error("Non trovo la riga intestazioni (Venduta / Giacenza).");
  }

  const idxCod = findColumnIndex(headers, [
    "cod. articolo",
    "cod articolo",
    "codice articolo",
    "cod. art",
    "cod art",
    "articolo",
  ]);

  const idxDesc = findColumnIndex(headers, ["descrizione", "desc", "descr"]);
  const idxVend = findColumnIndex(headers, ["qta venduta", "qtà venduta", "venduta", "vendite"]);
  const idxGiac = findColumnIndex(headers, ["giacenza bar", "giacenza", "giacenze"]);

  const idxValVend = findColumnIndex(headers, [
    "valore venduto",
    "importo venduto",
    "val venduto",
    "valore",
    "importo",
  ]);

  if (idxCod === -1) throw new Error("Colonna 'Cod. Articolo' non trovata.");
  if (idxDesc === -1) throw new Error("Colonna 'Descrizione' non trovata.");
  if (idxVend === -1) throw new Error("Colonna 'Qtà Venduta' non trovata.");
  if (idxGiac === -1) throw new Error("Colonna 'Giacenza' non trovata.");

  const cCod = idxCod + 1;
  const cDesc = idxDesc + 1;
  const cVend = idxVend + 1;
  const cGiac = idxGiac + 1;
  const cValVend = idxValVend !== -1 ? idxValVend + 1 : -1;

  const wWeeks = Number.isFinite(weeks) ? Math.max(1, Math.min(4, Math.trunc(weeks))) : 4;
  const wEq =
    typeof days === "number" && Number.isFinite(days) && days > 0
      ? Math.max(1 / 7, Math.min(21 / 7, days / 7))
      : wWeeks;

  const rows: PreviewRow[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;

    const codArticolo = cellToString(row.getCell(cCod));
    const descrizione = cellToString(row.getCell(cDesc));
    const qtaVenduta = cellToNumber(row.getCell(cVend).value);
    const giacenza = cellToNumber(row.getCell(cGiac).value);

    const valoreVenduto = cValVend !== -1 ? cellToNumber(row.getCell(cValVend).value) : 0;

    const codNorm = normalize(codArticolo);
    const descNorm = normalize(descrizione);

    if (!codArticolo && !descrizione) return;

    if ((codNorm.includes("pagina") || descNorm.includes("pagina")) && qtaVenduta === 0 && giacenza === 0) return;
    if (codNorm.includes("cod") && codNorm.includes("art")) return;
    if (!codArticolo && qtaVenduta === 0 && giacenza === 0) return;

    const fabbisogno = qtaVenduta * wEq;

    // ✅ “teorica” = mancante prima dei pack (arrotondo all'intero superiore)
    const qtaTeorica = Math.max(0, Math.ceil(fabbisogno - giacenza));

    // legacy: default 10. (Poi l’API ricalcola con conf_da reale)
    const confDa = 10;
    const qtaOrdine = qtaTeorica > 0 ? Math.ceil(qtaTeorica / confDa) * confDa : 0;

    const unitValue = qtaVenduta > 0 ? valoreVenduto / qtaVenduta : 0;
    const valoreDaOrdinare = qtaOrdine > 0 && unitValue > 0 ? round2(unitValue * qtaOrdine) : 0;

    rows.push({
      codArticolo,
      descrizione,
      qtaVenduta,
      valoreVenduto,
      giacenza,
      qtaTeorica,
      confDa,
      qtaOrdine,
      valoreDaOrdinare,
      pesoKg: 0, // verrà valorizzato dall’API
    });
  });

  return { pvLabel, rows };
}

/**
 * Wrapper legacy: mantiene la firma che usavi prima in start/route.ts
 * - qui NON interroghiamo Supabase
 * - quindi usiamo confDa=10 e peso standard 0.02 kg per pezzo
 * - l’API può sempre sovrascrivere confDa/qtaOrdine/pesoKg con quelli da anagrafica
 */
export async function processReorderExcel(
  input: ArrayBuffer,
  weeks: number = 4,
  days?: number | null
): Promise<{ xlsx: Buffer; rows: PreviewRow[] }> {
  const { pvLabel, rows } = await parseReorderExcel(input, weeks, days);

  for (const r of rows) {
    if (r.qtaOrdine > 0) r.pesoKg = round1(r.qtaOrdine * 0.02);
    else r.pesoKg = 0;
  }

  const xlsx = await buildReorderXlsx(pvLabel, rows);
  return { xlsx, rows };
}
















