// File: lib/excel/fillOrderTab.ts
import ExcelJS from "exceljs";

export type OrderTabRow = {
  codArticolo: string; // es: "T12345"
  qtaKg: number; // es: 0.2
};

export type PatRow = {
  codArticolo: string;
  descrizione: string;
  qtaKg: number; // "Qtà in peso (kg)"
  qtaDaOrdinare: number; // "Qtà da ordinare"
  valoreDaOrdinare: number; // "Valore da ordinare"
};

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
    if (typeof v.result === "number") return v.result;
    if (typeof v.result === "string") return cellToNumber(v.result);
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

function findHeaderRow(ws: ExcelJS.Worksheet): number {
  const maxRows = Math.min(30, ws.rowCount || 30);
  const maxCols = Math.min(60, ws.columnCount || 60);

  for (let r = 1; r <= maxRows; r++) {
    const row = ws.getRow(r);
    let hitCod = false;
    let hitPeso = false;

    for (let c = 1; c <= maxCols; c++) {
      const txt = normalize(cellToString(row.getCell(c)));
      if (!txt) continue;

      if (txt.includes("cod") && txt.includes("art")) hitCod = true;
      if (txt.includes("peso") && (txt.includes("kg") || txt.includes("(kg)"))) hitPeso = true;
      if (txt.includes("qta in peso") && (txt.includes("kg") || txt.includes("(kg)"))) hitPeso = true;
      if (txt.includes("qtà in peso") && (txt.includes("kg") || txt.includes("(kg)"))) hitPeso = true;
    }

    if (hitCod && hitPeso) return r;
  }

  return -1;
}

function findHeaderRowForPAT(ws: ExcelJS.Worksheet): number {
  const maxRows = Math.min(30, ws.rowCount || 30);
  const maxCols = Math.min(80, ws.columnCount || 80);

  for (let r = 1; r <= maxRows; r++) {
    const row = ws.getRow(r);
    let hitCod = false;
    let hitDescr = false;
    let hitPeso = false;
    let hitQtaOrd = false;
    let hitValOrd = false;

    for (let c = 1; c <= maxCols; c++) {
      const txt = normalize(cellToString(row.getCell(c)));
      if (!txt) continue;

      if (txt.includes("cod") && txt.includes("art")) hitCod = true;
      if (txt.includes("descr")) hitDescr = true;

      if (txt.includes("qta in peso") && (txt.includes("kg") || txt.includes("(kg)"))) hitPeso = true;
      if (txt.includes("qtà in peso") && (txt.includes("kg") || txt.includes("(kg)"))) hitPeso = true;
      if (txt.includes("peso") && (txt.includes("kg") || txt.includes("(kg)"))) hitPeso = true;

      if (txt.includes("qta da ordinare") || txt.includes("qtà da ordinare")) hitQtaOrd = true;
      if (txt.includes("valore da ordinare")) hitValOrd = true;
    }

    if (hitCod && hitDescr && hitPeso && hitQtaOrd && hitValOrd) return r;
  }

  // fallback: riusa la logica base se il file non contiene tutte le intestazioni “perfette”
  return findHeaderRow(ws);
}

function findColIndexByIncludes(headers: string[], includes: string[]): number {
  const normHeaders = headers.map((h) => normalize(h));
  for (const inc of includes) {
    const needle = normalize(inc);
    const idx = normHeaders.findIndex((h) => h.includes(needle));
    if (idx !== -1) return idx;
  }
  return -1;
}

function extractAAMS(codArticolo: string): string {
  const s = (codArticolo || "").trim().toUpperCase();
  const m = s.match(/\d+/g);
  if (!m?.length) return "";
  return m.join("");
}

/**
 * ✅ Legge il tuo Excel "pulito" (quello generato dalla preview)
 * e tira fuori le righe per compilare Order Tab:
 * - codArticolo (colonna "Cod. Articolo")
 * - qtaKg (colonna "Qtà in peso (kg)")
 */
export async function extractRowsFromCleanReorderXlsx(
  cleanBytes: ArrayBuffer | Uint8Array
): Promise<OrderTabRow[]> {
  const wb = new ExcelJS.Workbook();

  const input = cleanBytes instanceof ArrayBuffer ? cleanBytes : Buffer.from(cleanBytes as Uint8Array);

  await wb.xlsx.load(input as any);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel pulito senza worksheet.");

  const headerRowNumber = findHeaderRow(ws);
  if (headerRowNumber === -1) {
    throw new Error("Non trovo le intestazioni nel file pulito (Cod. Articolo / Qtà in peso (kg)).");
  }

  // leggo headers
  const headerRow = ws.getRow(headerRowNumber);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = cellToString(cell);
  });

  const idxCod = findColIndexByIncludes(headers, ["cod. articolo", "cod articolo", "codice articolo"]);
  const idxPeso = findColIndexByIncludes(headers, ["qtà in peso", "qta in peso", "peso (kg)", "peso kg"]);

  if (idxCod === -1) throw new Error("Nel file pulito non trovo la colonna 'Cod. Articolo'.");
  if (idxPeso === -1) throw new Error("Nel file pulito non trovo la colonna 'Qtà in peso (kg)'.");

  const cCod = idxCod + 1;
  const cPeso = idxPeso + 1;

  const out: OrderTabRow[] = [];

  // dati dalla riga successiva
  for (let r = headerRowNumber + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);

    const codArticolo = cellToString(row.getCell(cCod));
    const qtaKg = cellToNumber(row.getCell(cPeso).value);

    if (!codArticolo && qtaKg === 0) continue;
    if (!codArticolo) continue;

    out.push({ codArticolo, qtaKg });
  }

  return out;
}

/**
 * ✅ Estrae le righe necessarie al PAT:
 * - Cod. Articolo
 * - Descrizione
 * - Qtà in peso (kg)
 * - Qtà da ordinare
 * - Valore da ordinare
 */
export async function extractRowsForPatFromCleanReorderXlsx(
  cleanBytes: ArrayBuffer | Uint8Array
): Promise<PatRow[]> {
  const wb = new ExcelJS.Workbook();

  const input = cleanBytes instanceof ArrayBuffer ? cleanBytes : Buffer.from(cleanBytes as Uint8Array);

  await wb.xlsx.load(input as any);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel pulito senza worksheet.");

  const headerRowNumber = findHeaderRowForPAT(ws);
  if (headerRowNumber === -1) {
    throw new Error(
      "Non trovo le intestazioni nel file pulito per PAT (Cod. Articolo / Descrizione / Qtà in peso (kg) / Qtà da ordinare / Valore da ordinare)."
    );
  }

  const headerRow = ws.getRow(headerRowNumber);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = cellToString(cell);
  });

  const idxCod = findColIndexByIncludes(headers, ["cod. articolo", "cod articolo", "codice articolo"]);
  const idxDescr = findColIndexByIncludes(headers, ["descrizione", "desc"]);
  const idxPeso = findColIndexByIncludes(headers, ["qtà in peso", "qta in peso", "peso (kg)", "peso kg"]);
  const idxQtaOrd = findColIndexByIncludes(headers, ["qtà da ordinare", "qta da ordinare"]);
  const idxValOrd = findColIndexByIncludes(headers, ["valore da ordinare"]);

  if (idxCod === -1) throw new Error("Nel file pulito non trovo la colonna 'Cod. Articolo'.");
  if (idxDescr === -1) throw new Error("Nel file pulito non trovo la colonna 'Descrizione'.");
  if (idxPeso === -1) throw new Error("Nel file pulito non trovo la colonna 'Qtà in peso (kg)'.");
  if (idxQtaOrd === -1) throw new Error("Nel file pulito non trovo la colonna 'Qtà da ordinare'.");
  if (idxValOrd === -1) throw new Error("Nel file pulito non trovo la colonna 'Valore da ordinare'.");

  const cCod = idxCod + 1;
  const cDescr = idxDescr + 1;
  const cPeso = idxPeso + 1;
  const cQtaOrd = idxQtaOrd + 1;
  const cValOrd = idxValOrd + 1;

  const out: PatRow[] = [];

  for (let r = headerRowNumber + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);

    const codArticolo = cellToString(row.getCell(cCod));
    const descrizione = cellToString(row.getCell(cDescr));
    const qtaKg = cellToNumber(row.getCell(cPeso).value);
    const qtaDaOrdinare = cellToNumber(row.getCell(cQtaOrd).value);
    const valoreDaOrdinare = cellToNumber(row.getCell(cValOrd).value);

    // stop soft: se non c'è codice, ignoro
    if (!codArticolo) continue;

    out.push({ codArticolo, descrizione, qtaKg, qtaDaOrdinare, valoreDaOrdinare });
  }

  return out;
}

export async function fillOrderTabXlsx(
  templateBytes: Uint8Array | ArrayBuffer,
  rows: OrderTabRow[]
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();

  const input =
    templateBytes instanceof ArrayBuffer
      ? templateBytes
      : Buffer.isBuffer(templateBytes as any)
      ? (templateBytes as any)
      : Buffer.from(templateBytes as Uint8Array);

  await wb.xlsx.load(input as any);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Template Order Tab senza worksheet.");

  // Header riga 1: "Codice AAMS" e "Quantita"
  const headerRow = ws.getRow(1);
  const headerToCol = new Map<string, number>();

  headerRow.eachCell((cell, colNumber) => {
    const v = String(cell.value ?? "").trim().toUpperCase();
    if (v) headerToCol.set(v, colNumber);
  });

  const colAAMS = headerToCol.get("CODICE AAMS");
  const colQTA = headerToCol.get("QUANTITA");

  if (!colAAMS || !colQTA) {
    throw new Error(`Header non trovati nel template. Trovati: ${Array.from(headerToCol.keys()).join(", ")}`);
  }

  // Scrivo dalla riga 2 in poi
  let r = 2;
  for (const row of rows) {
    const aams = extractAAMS(row.codArticolo);
    const qta = Number.isFinite(row.qtaKg) ? row.qtaKg : 0;

    ws.getCell(r, colAAMS).value = aams;
    ws.getCell(r, colQTA).value = qta;

    r++;
  }

  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}




