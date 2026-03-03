import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

function norm(s: any) {
  return String(s ?? "")
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

function toNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return 0;
  const t = s.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export type PreviewRowGV = {
  codArticolo: string;
  descrizione: string;
  fattco: number; // ✅ NEW
  qtaVenduta: number;
  valoreVenduto: number;
  giacenzaBarQty: number;
  valoreGiacenzaBar: number;
  qtaDaOrdinare: number;
  valoreDaOrdinare: number;
};

function findHeaderRow(table: any[][]): number {
  const maxScan = Math.min(80, table.length);
  for (let r = 0; r < maxScan; r++) {
    const row = table[r] || [];
    const line = norm(row.join(" "));
    if (line.includes("cod") && line.includes("articol") && line.includes("descr")) return r;
  }
  return -1;
}

function buildHeaderCombined(table: any[][], hr: number): string[] {
  const top = table[hr] || [];
  const sub = table[hr + 1] || [];
  const maxLen = Math.max(top.length, sub.length);

  const out: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const a = norm(top[i]);
    const b = norm(sub[i]);
    out.push(norm(`${a} ${b}`.trim()));
  }
  return out;
}

function findCol(header: string[], mustHave: string[], mustNotHave: string[] = []): number {
  for (let i = 0; i < header.length; i++) {
    const s = header[i];
    if (!s) continue;
    if (mustNotHave.some((x) => s.includes(x))) continue;
    if (mustHave.every((x) => s.includes(x))) return i;
  }
  for (let i = 0; i < header.length; i++) {
    const s = header[i];
    if (!s) continue;
    if (mustNotHave.some((x) => s.includes(x))) continue;
    if (mustHave.some((x) => s.includes(x))) return i;
  }
  return -1;
}

function a1Col(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function buildWorkbook(title: string, rows: PreviewRowGV[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RIORDINO G&V");

  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };

  ws.mergeCells("A1:I1");
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14 };

  const headerRow = 3;
  const firstDataRow = headerRow + 1;

  // ✅ FATTCO prima di Qtà Venduta
  ws.getRow(headerRow).values = [
    "Cod. Articolo",
    "Descrizione",
    "FATTCO",
    "Qtà Venduta",
    "Valore Venduto",
    "Giacenza Bar",
    "Valore Giacenza Bar",
    "QTA DA ORDINARE",
    "VALORE DA ORDINARE",
  ];
  ws.getRow(headerRow).font = { bold: true };

  ws.columns = [
    { width: 16 },
    { width: 48 },
    { width: 10 }, // FATTCO
    { width: 14 },
    { width: 18 },
    { width: 14 },
    { width: 22 },
    { width: 18 },
    { width: 22 },
  ];

  let r = firstDataRow;
  for (const row of rows) {
    ws.getRow(r).values = [
      row.codArticolo,
      row.descrizione,
      row.fattco,
      row.qtaVenduta,
      row.valoreVenduto,
      row.giacenzaBarQty,
      row.valoreGiacenzaBar,
      row.qtaDaOrdinare,
      row.valoreDaOrdinare,
    ];

    // € columns: E, G, I
    ws.getCell(r, 5).numFmt = "€ #,##0.00";
    ws.getCell(r, 7).numFmt = "€ #,##0.00";
    ws.getCell(r, 9).numFmt = "€ #,##0.00";

    r++;
  }

  const lastDataRow = r - 1;
  const totalRow = r + 1;

  ws.getCell(totalRow, 2).value = "TOTALI";
  ws.getRow(totalRow).font = { bold: true };

  ws.getCell(totalRow, 5).value = {
    formula: `SUM(${a1Col(5)}${firstDataRow}:${a1Col(5)}${lastDataRow})`,
  };
  ws.getCell(totalRow, 5).numFmt = "€ #,##0.00";

  ws.getCell(totalRow, 7).value = {
    formula: `SUM(${a1Col(7)}${firstDataRow}:${a1Col(7)}${lastDataRow})`,
  };
  ws.getCell(totalRow, 7).numFmt = "€ #,##0.00";

  ws.getCell(totalRow, 9).value = {
    formula: `SUM(${a1Col(9)}${firstDataRow}:${a1Col(9)}${lastDataRow})`,
  };
  ws.getCell(totalRow, 9).numFmt = "€ #,##0.00";

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as any);
}

export async function processReorderGVExcel(
  input: ArrayBuffer,
  priceMap: Record<string, number>,
  title: string
): Promise<{ xlsx: Buffer; rows: PreviewRowGV[] }> {
  const wb = XLSX.read(Buffer.from(input), { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];

  const hr = findHeaderRow(table);
  if (hr < 0) throw new Error("Header non trovato nel file G&V");

  const header = buildHeaderCombined(table, hr);

  const iCod = findCol(header, ["cod", "articol"]);
  const iDesc = findCol(header, ["descr"]);
  const iQtaVend = findCol(header, ["qta", "vend"]);
  const iValVend = findCol(header, ["valore", "vend"]);
  const iGiacQty = findCol(header, ["giacen", "bar"], ["valore"]);
  const iValGiacBar = findCol(header, ["valore", "giacen", "bar"]);
  let iFatt = findCol(header, ["fattconv"]);
  if (iFatt < 0) iFatt = findCol(header, ["fatt", "conv"]);

  if (iCod < 0 || iQtaVend < 0 || iFatt < 0) {
    throw new Error("Colonne minime mancanti");
  }

  const rows: PreviewRowGV[] = [];

  for (let r = hr + 2; r < table.length; r++) {
    const row = table[r] || [];

    const codArticolo = String(row[iCod] ?? "").trim();
    if (!codArticolo) continue;

    if (norm(codArticolo).startsWith("pagina")) continue;

    const descrizione = iDesc >= 0 ? String(row[iDesc] ?? "").trim() : "";

    const fattco = Math.floor(toNumber(row[iFatt]));
    const qtaVenduta = toNumber(row[iQtaVend]);
    const valoreVenduto = iValVend >= 0 ? toNumber(row[iValVend]) : 0;
    const giacenzaBarQty = iGiacQty >= 0 ? toNumber(row[iGiacQty]) : 0;
    const valoreGiacenzaBar = iValGiacBar >= 0 ? toNumber(row[iValGiacBar]) : 0;

    const base = qtaVenduta * 2 - giacenzaBarQty;
    let qtaDaOrdinare = 0;
    if (base > 0 && fattco > 0) qtaDaOrdinare = Math.ceil(base / fattco);

    const prezzo = priceMap[codArticolo] || 0;
    const valoreDaOrdinare = qtaDaOrdinare * fattco * prezzo;

    rows.push({
      codArticolo,
      descrizione,
      fattco,
      qtaVenduta,
      valoreVenduto,
      giacenzaBarQty,
      valoreGiacenzaBar,
      qtaDaOrdinare,
      valoreDaOrdinare,
    });
  }

  const xlsx = await buildWorkbook(title, rows);
  return { xlsx, rows };
}






