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

/* -------------------- types -------------------- */

export type PreviewRow = {
  codArticolo: string;
  descrizione: string;
  qtaVenduta: number;
  giacenza: number;
  qtaOrdine: number;
  pesoKg: number; // per anteprima (come già avevi)
};

/* -------------------- export pulito -------------------- */

async function buildCleanWorkbook(pvLabel: string, rows: PreviewRow[]): Promise<Buffer> {

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RIORDINO TAB");

  // PV label in A1 (senza colonna vuota)
  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = pvLabel;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

  const headerRow = 3;

  const headers = [
    "Cod. Articolo",
    "Descrizione",
    "Qtà Venduta",
    "Giacenza",
    "Qtà da ordinare",
    "Qtà in peso (kg)", // ✅ in chilogrammi nel file scaricato
  ];

  ws.getRow(headerRow).values = headers;
  ws.getRow(headerRow).font = { bold: true };

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 52;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 12;

  let r = headerRow + 1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // 10 pezzi = 200g => 1 pezzo = 20g
    const pesoG = Math.round(row.qtaOrdine * 20);

    ws.getRow(r).values = [
  row.codArticolo,
  row.descrizione,
  row.qtaVenduta,
  row.giacenza,
  row.qtaOrdine,
  row.pesoKg,
];


    // formati numerici
    ws.getCell(r, 3).numFmt = "0";
    ws.getCell(r, 4).numFmt = "0";
    ws.getCell(r, 5).numFmt = "0";
    ws.getCell(r, 6).numFmt = "0.0";


    r++;
  }

  // Totali
  const totalRow = r + 1;
  ws.getCell(totalRow, 2).value = "TOTALI";
  ws.getRow(totalRow).font = { bold: true };

  const start = headerRow + 1;
  const end = r - 1;

  ws.getCell(totalRow, 3).value = { formula: `SUM(C${start}:C${end})` };
  ws.getCell(totalRow, 4).value = { formula: `SUM(D${start}:D${end})` };
  ws.getCell(totalRow, 5).value = { formula: `SUM(E${start}:E${end})` };
  ws.getCell(totalRow, 6).value = { formula: `SUM(F${start}:F${end})` };

  ws.getCell(totalRow, 6).numFmt = "0.0";


  // bordi
  const last = totalRow;
  for (let rr = headerRow; rr <= last; rr++) {
    for (let cc = 1; cc <= 6; cc++) {
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

/* -------------------- main -------------------- */

export async function processReorderExcel(
  input: ArrayBuffer
): Promise<{ xlsx: Buffer; rows: PreviewRow[] }> {
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

  // mappa colonne
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

  if (idxCod === -1) throw new Error("Colonna 'Cod. Articolo' non trovata.");
  if (idxDesc === -1) throw new Error("Colonna 'Descrizione' non trovata.");
  if (idxVend === -1) throw new Error("Colonna 'Qtà Venduta' non trovata.");
  if (idxGiac === -1) throw new Error("Colonna 'Giacenza' non trovata.");

  const cCod = idxCod + 1;
  const cDesc = idxDesc + 1;
  const cVend = idxVend + 1;
  const cGiac = idxGiac + 1;

  const rows: PreviewRow[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;

    const codArticolo = cellToString(row.getCell(cCod));
    const descrizione = cellToString(row.getCell(cDesc));
    const qtaVenduta = cellToNumber(row.getCell(cVend).value);
    const giacenza = cellToNumber(row.getCell(cGiac).value);

    const codNorm = normalize(codArticolo);
    const descNorm = normalize(descrizione);

    // filtri righe spazzatura
    if (!codArticolo && !descrizione) return;

    // "pagina 13 di 13"
    if ((codNorm.includes("pagina") || descNorm.includes("pagina")) && qtaVenduta === 0 && giacenza === 0) return;

    // intestazioni ripetute dentro il file
    if (codNorm.includes("cod") && codNorm.includes("art")) return;

    // molti export hanno righe non-articolo con descrizione vuota e numeri zero
    if (!codArticolo && qtaVenduta === 0 && giacenza === 0) return;

    // LOGICA RIORDINO TAB: 4 settimane fisse (come prima)
    const fabbisogno = qtaVenduta * 4;
    const mancante = Math.max(0, fabbisogno - giacenza);
    const qtaOrdine = Math.ceil(mancante / 10) * 10;

    // anteprima resta in kg come UI attuale (0.02 kg per pezzo)
    const pesoKg = Number((qtaOrdine * 0.02).toFixed(1));

    rows.push({
      codArticolo,
      descrizione,
      qtaVenduta,
      giacenza,
      qtaOrdine,
      pesoKg,
    });
  });

  const xlsx = await buildCleanWorkbook(pvLabel, rows);
  return { xlsx, rows };
}





