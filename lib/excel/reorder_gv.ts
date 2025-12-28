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

function cellValueToString(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((x: any) => x.text || "").join("");
    if (typeof v.result === "string") return v.result;
    if (typeof v.result === "number") return String(v.result);
  }
  return "";
}

function getCellText(cell: ExcelJS.Cell): string {
  const pick = (v: any): string => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";

    if (typeof v === "object") {
      if (typeof v.text === "string") return v.text.trim();
      if (Array.isArray(v.richText)) {
        return v.richText.map((x: any) => (x?.text ? String(x.text) : "")).join("").trim();
      }
      if (typeof v.result === "string") return v.result.trim();
      if (typeof v.result === "number") return String(v.result);
    }
    return "";
  };

  let s = pick(cell.value);

  if (!s) {
    const anyCell = cell as any;
    if (anyCell?.isMerged && anyCell?.master) {
      s = pick(anyCell.master.value);
    }
  }

  if (!s) {
    try {
      const t = (cell as any).text;
      if (typeof t === "string") s = t.trim();
    } catch {
      // ignore
    }
  }

  return s;
}

function toNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.replace(/\./g, "").replace(",", ".").replace(/\s/g, "");
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object" && v) {
    if (typeof v.result === "number") return v.result;
    if (typeof v.result === "string") return toNumber(v.result);
  }
  return 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function findPvLabel(ws: ExcelJS.Worksheet): string {
  const maxRows = Math.min(12, ws.rowCount || 12);
  const maxCols = Math.min(60, ws.columnCount || 60);

  for (let r = 1; r <= maxRows; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCols; c++) {
      const text = getCellText(row.getCell(c));
      if (!text) continue;
      const t = text.toLowerCase();
      if (t.includes("gestioni") || t.includes(" via ") || t.includes("fondi")) {
        return text.trim();
      }
    }
  }
  return "Punto vendita";
}

/* -------------------- header detection -------------------- */

function findHeaderRow(ws: ExcelJS.Worksheet): number {
  const max = Math.min(40, ws.rowCount || 40);

  for (let r = 1; r <= max; r++) {
    const row = ws.getRow(r);
    const parts: string[] = [];

    row.eachCell({ includeEmpty: true }, (cell) => {
      const s = normalize(getCellText(cell));
      if (s) parts.push(s);
    });

    const joined = parts.join(" | ");

    if (
      joined.includes("cod") &&
      joined.includes("articolo") &&
      joined.includes("descrizione") &&
      joined.includes("venduta") &&
      joined.includes("valore") &&
      joined.includes("venduto") &&
      joined.includes("giacenza") &&
      joined.includes("bar")
    ) {
      return r;
    }
  }
  return -1;
}

function findColIndexOnRow(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  predicate: (hNorm: string) => boolean
): number {
  const row = ws.getRow(rowNumber);
  let found = -1;

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const hNorm = normalize(getCellText(cell));
    if (!hNorm) return;
    if (predicate(hNorm) && found === -1) found = colNumber;
  });

  return found;
}

function findColIndexInRowRange(
  ws: ExcelJS.Worksheet,
  rowStart: number,
  rowEnd: number,
  predicate: (hNorm: string) => boolean
): number {
  const start = Math.max(1, rowStart);
  const end = Math.min(ws.rowCount || rowEnd, rowEnd);

  for (let r = start; r <= end; r++) {
    const idx = findColIndexOnRow(ws, r, predicate);
    if (idx !== -1) return idx;
  }
  return -1;
}

/* -------------------- types -------------------- */

export type PreviewRowGV = {
  codArticolo: string;
  descrizione: string;
  qtaVenduta: number;
  valoreVenduto: number;
  giacenzaBar: number;
  fattconv: number;
  qtaOrdineBar: number;
  qtaConf: number;
  valoreDaOrdinare: number;
};

/* -------------------- export pulito -------------------- */

async function buildCleanWorkbook(pvLabel: string, rows: PreviewRowGV[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RIORDINO G&V");

  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = pvLabel;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

  const headerRow = 3;
  const headers = [
    "Cod. Articolo",
    "Descrizione",
    "Qtà Venduta",
    "Valore Venduto",
    "Giacenza BAR",
    "Qtà da ordinare BAR",
    "Qtà Conf.",
    "Valore da ordinare",
  ];

  ws.getRow(headerRow).values = headers;
  ws.getRow(headerRow).font = { bold: true };

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 48;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 18;
  ws.getColumn(7).width = 10;
  ws.getColumn(8).width = 20;

  let r = headerRow + 1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    ws.getRow(r).values = [
      row.codArticolo,
      row.descrizione,
      row.qtaVenduta,
      row.valoreVenduto,
      row.giacenzaBar,
      row.qtaOrdineBar,
      row.qtaConf,
      row.valoreDaOrdinare,
    ];

    ws.getCell(r, 3).numFmt = "0";
    ws.getCell(r, 4).numFmt = "€ #,##0.00";
    ws.getCell(r, 5).numFmt = "0";
    ws.getCell(r, 6).numFmt = "0";
    ws.getCell(r, 7).numFmt = "0";
    ws.getCell(r, 8).numFmt = "€ #,##0.00";

    r++;
  }

  const totalRow = r + 1;
  ws.getCell(totalRow, 2).value = "TOTALI";
  ws.getRow(totalRow).font = { bold: true };

  const start = headerRow + 1;
  const end = r - 1;

  ws.getCell(totalRow, 3).value = { formula: `SUM(C${start}:C${end})` };
  ws.getCell(totalRow, 4).value = { formula: `SUM(D${start}:D${end})` };
  ws.getCell(totalRow, 5).value = { formula: `SUM(E${start}:E${end})` };
  ws.getCell(totalRow, 6).value = { formula: `SUM(F${start}:F${end})` };
  ws.getCell(totalRow, 7).value = { formula: `SUM(G${start}:G${end})` };
  ws.getCell(totalRow, 8).value = { formula: `SUM(H${start}:H${end})` };

  ws.getCell(totalRow, 4).numFmt = "€ #,##0.00";
  ws.getCell(totalRow, 8).numFmt = "€ #,##0.00";

  const last = totalRow;
  for (let rr = headerRow; rr <= last; rr++) {
    for (let cc = 1; cc <= 8; cc++) {
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

export async function processReorderGVExcel(
  input: ArrayBuffer,
  days: number = 7
): Promise<{ xlsx: Buffer; rows: PreviewRowGV[] }> {
  // giorni selezionabili: 1..7 (default 7 = 1 settimana)
  const d = Math.max(1, Math.min(7, Math.trunc(Number(days) || 7)));

  // ✅ LEAD TIME G&V: consegna il giorno dopo
  const leadTimeDays = 1;

  // giorni effettivi da coprire
  const effectiveDays = d + leadTimeDays;

  // qtaVenduta è settimanale → convertiamo in settimane
  const effectiveWeeks = effectiveDays / 7;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);

  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("Foglio Excel non trovato");

  const pvLabel = findPvLabel(ws);

  const headerRow = findHeaderRow(ws);
  if (headerRow === -1) throw new Error("Intestazioni non trovate (template G&V non riconosciuto)");

  const idxCod = findColIndexOnRow(ws, headerRow, (h) => h.includes("cod") && h.includes("articolo"));
  const idxDesc = findColIndexOnRow(ws, headerRow, (h) => h.includes("descrizione"));
  const idxVenduta = findColIndexOnRow(
    ws,
    headerRow,
    (h) => (h.includes("qta") || h.includes("qt")) && h.includes("venduta")
  );
  const idxValVend = findColIndexOnRow(ws, headerRow, (h) => h.includes("valore") && h.includes("venduto"));
  const idxGiacBar = findColIndexOnRow(ws, headerRow, (h) => h.includes("giacenza") && h.includes("bar"));

  const idxFattconv = findColIndexInRowRange(ws, headerRow - 12, headerRow + 2, (h) => {
    const compact = h.replace(/[^a-z0-9]/g, "");
    return compact.includes("fattconv") || compact.includes("fattcon");
  });

  const missing: string[] = [];
  if (idxCod === -1) missing.push("Cod. Articolo");
  if (idxDesc === -1) missing.push("Descrizione");
  if (idxVenduta === -1) missing.push("Qtà Venduta");
  if (idxValVend === -1) missing.push("Valore Venduto");
  if (idxGiacBar === -1) missing.push("Giacenza BAR");
  if (idxFattconv === -1) missing.push("FATTCONV");

  if (missing.length) throw new Error("Colonne mancanti nel template G&V: " + missing.join(", "));

  const rows: PreviewRowGV[] = [];

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);

    const codArticolo = getCellText(row.getCell(idxCod)).trim();
    const descrizione = getCellText(row.getCell(idxDesc)).trim();

    const qtaVenduta = toNumber(row.getCell(idxVenduta).value);
    const valoreVenduto = toNumber(row.getCell(idxValVend).value);
    const giacenzaBar = toNumber(row.getCell(idxGiacBar).value);
    const fattconv = Math.floor(toNumber(row.getCell(idxFattconv).value));

    const codNorm = normalize(codArticolo);
    const descrNorm = normalize(descrizione);

    if (!codArticolo && !descrizione) continue;
    if (codNorm.includes("cod") && codNorm.includes("articolo")) continue;

    if (
      qtaVenduta === 0 &&
      valoreVenduto === 0 &&
      giacenzaBar === 0 &&
      (codNorm.includes("pagina") || descrNorm.includes("pagina"))
    ) {
      continue;
    }

    if (!codArticolo && qtaVenduta === 0 && giacenzaBar === 0) continue;

    // ✅ DOMANDA: venduto settimanale * settimane equivalenti ai giorni richiesti (+ lead time)
    const domandaPeriodo = qtaVenduta * effectiveWeeks;

    const qtaTeorica = Math.max(0, Math.ceil(domandaPeriodo - giacenzaBar));

    let qtaConf = 0;
    let qtaOrdineBar = 0;

    if (qtaTeorica > 0 && fattconv > 0) {
      qtaConf = Math.ceil(qtaTeorica / fattconv);
      qtaOrdineBar = qtaConf * fattconv;
    } else if (qtaTeorica > 0 && fattconv <= 0) {
      qtaConf = 0;
      qtaOrdineBar = qtaTeorica;
    }

    const unitValue = qtaVenduta > 0 ? valoreVenduto / qtaVenduta : 0;
    const valoreDaOrdinare =
      qtaOrdineBar > 0 && unitValue > 0 ? round2(unitValue * qtaOrdineBar) : 0;

    rows.push({
      codArticolo,
      descrizione,
      qtaVenduta: Number(qtaVenduta) || 0,
      valoreVenduto: Number(valoreVenduto) || 0,
      giacenzaBar: Number(giacenzaBar) || 0,
      fattconv: Number(fattconv) || 0,
      qtaOrdineBar: Number(qtaOrdineBar) || 0,
      qtaConf: Number(qtaConf) || 0,
      valoreDaOrdinare: Number(valoreDaOrdinare) || 0,
    });
  }

  const xlsx = await buildCleanWorkbook(pvLabel, rows);
  return { xlsx, rows };
}







