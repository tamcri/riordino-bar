// lib/excel/inventoryCompare.ts
import ExcelJS from "exceljs";
import type { InventoryExcelMeta } from "./inventory";

export type CompareLine = {
  code: string;
  description: string;

  qtyInventory: number;
  qtyGestionale: number;
  diff: number; // inventario - gestionale

  prezzoVenditaEur?: number | null;

  // Se presente, qtyInventory / qtyGestionale sono trattati come ML TOTALI
  volumeMlPerUnit?: number | null;

  foundInInventory: boolean;
  foundInGestionale: boolean;

  categoryName?: string | null;
  subcategoryName?: string | null;
};

function isoToIt(iso: string) {
  const s = (iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}-${m}-${y}`;
}

function normHeader(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function cellText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    if ((v as any).text) return String((v as any).text);
    if (Array.isArray((v as any).richText)) {
      return (v as any).richText.map((x: any) => x?.text ?? "").join("");
    }
    if ((v as any).result != null) return String((v as any).result);
  }
  return String(v);
}

function toNumberLoose(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  const s = cellText(v)
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();

  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normCode(v: unknown): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const firstToken = raw.split(/\s+/)[0] || "";
  return firstToken.trim().toUpperCase().replace(/\s+/g, "");
}

function looksLikeItemCode(code: string): boolean {
  if (!code) return false;
  if (code.length < 2) return false;
  if (code.length > 30) return false;
  if (code.includes(":")) return false;
  if (/^TOTALE/i.test(code)) return false;
  if (!/^[A-Z0-9]+$/.test(code)) return false;
  return true;
}

function scoreCodeHeader(h: string): number {
  const s = normHeader(h);
  if (!s) return 0;
  const ns = s.replace(/\s+/g, "");

  if (s === "codice articolo" || s === "cod articolo") return 100;
  if (s === "codice" || s === "cod") return 90;
  if (s === "codicearticolo" || s === "codarticolo") return 95;
  if (ns.includes("cod") && ns.includes("art")) return 80;
  if (s.includes("cod") && s.includes("art")) return 70;

  return 0;
}

function scoreQtyHeader(h: string): number {
  const s0 = normHeader(h);
  if (!s0) return 0;

  const s = s0.replace(/\s+/g, "");

  if (s === "giacenzaqta1") return 200;
  if (s === "giacenzaqta01") return 190;
  if (s === "giacenzaqta") return 120;
  if (s === "giacenza") return 80;
  if (s === "qta1" || s === "quantita1") return 70;
  if (s.includes("giacenza") && s.includes("qta") && s.includes("1")) return 110;
  if (s.includes("giacenza") && s.includes("qta")) return 95;
  if (s.includes("giacenza")) return 60;
  if (s.includes("qta") && s.includes("1")) return 55;

  return 0;
}

function compositeHeader(
  ws: ExcelJS.Worksheet,
  rowA: number,
  rowB: number,
  col: number
): string {
  const a = cellText(ws.getRow(rowA).getCell(col).value).trim();
  const b = cellText(ws.getRow(rowB).getCell(col).value).trim();
  return `${a} ${b}`.trim();
}

function rowMaxCol(ws: ExcelJS.Worksheet, rowIdx: number): number {
  const r = ws.getRow(rowIdx);
  return Math.max(1, r?.cellCount || 1);
}

function isMostlyTitleRow(ws: ExcelJS.Worksheet, rowIdx: number): boolean {
  const r = ws.getRow(rowIdx);
  const maxC = rowMaxCol(ws, rowIdx);
  const texts: string[] = [];

  for (let c = 1; c <= maxC; c++) {
    const t = cellText(r.getCell(c).value).trim();
    if (t) texts.push(t);
  }

  if (texts.length === 0) return true;

  const uniq = new Set(texts.map((x) => x.toLowerCase()));
  const joined = texts.join(" ").toLowerCase();
  const hasKey =
    joined.includes("cod") ||
    joined.includes("art") ||
    joined.includes("giacenza") ||
    joined.includes("qta");

  if (!hasKey && uniq.size <= 2) return true;

  return false;
}

type HeaderHit = {
  codeCol: number;
  qtyCol: number;
  headerRow: number;
  headerMode: "single" | "double";
};

function findHeaderAt(ws: ExcelJS.Worksheet, r: number): HeaderHit | null {
  if (r < 1 || r > ws.rowCount) return null;
  if (isMostlyTitleRow(ws, r)) return null;

  const maxC = rowMaxCol(ws, r);

  let bestCode: { col: number; score: number } | null = null;
  let bestQty: { col: number; score: number } | null = null;

  for (let c = 1; c <= maxC; c++) {
    const t = cellText(ws.getRow(r).getCell(c).value);

    const scCode = scoreCodeHeader(t);
    if (scCode > 0 && (!bestCode || scCode > bestCode.score)) {
      bestCode = { col: c, score: scCode };
    }

    const scQty = scoreQtyHeader(t);
    if (scQty > 0 && (!bestQty || scQty > bestQty.score)) {
      bestQty = { col: c, score: scQty };
    }
  }

  if (bestCode?.col && bestQty?.col && bestCode.col !== bestQty.col) {
    return {
      codeCol: bestCode.col,
      qtyCol: bestQty.col,
      headerRow: r,
      headerMode: "single",
    };
  }

  if (r < ws.rowCount) {
    const maxC2 = Math.max(maxC, rowMaxCol(ws, r + 1));
    bestCode = null;
    bestQty = null;

    for (let c = 1; c <= maxC2; c++) {
      const h = compositeHeader(ws, r, r + 1, c);

      const scCode = scoreCodeHeader(h);
      if (scCode > 0 && (!bestCode || scCode > bestCode.score)) {
        bestCode = { col: c, score: scCode };
      }

      const scQty = scoreQtyHeader(h);
      if (scQty > 0 && (!bestQty || scQty > bestQty.score)) {
        bestQty = { col: c, score: scQty };
      }
    }

    if (bestCode?.col && bestQty?.col && bestCode.col !== bestQty.col) {
      return {
        codeCol: bestCode.col,
        qtyCol: bestQty.col,
        headerRow: r,
        headerMode: "double",
      };
    }
  }

  return null;
}

function hasNextHeader(ws: ExcelJS.Worksheet, r: number): boolean {
  return !!findHeaderAt(ws, r);
}

/**
 * Legge Excel gestionale:
 * CODE -> qty (da colonna "Giacenza qta1" o simili)
 */
export async function parseGestionaleXlsx(
  buffer: ArrayBuffer
): Promise<Map<string, number>> {
  const wb = new ExcelJS.Workbook();
  const bytes = new Uint8Array(buffer);
  await wb.xlsx.load(bytes as any);

  const ws =
    wb.worksheets?.find((w) => (w?.rowCount ?? 0) > 0) ?? wb.worksheets?.[0];
  if (!ws) {
    throw new Error(
      "File Excel gestionale vuoto o non leggibile (nessun foglio trovato)."
    );
  }

  const out = new Map<string, number>();
  const seenHeaders = new Set<string>();

  function collectRowTexts(rowIdx: number) {
    if (rowIdx < 1 || rowIdx > ws.rowCount) return;
    const maxC = rowMaxCol(ws, rowIdx);
    const row = ws.getRow(rowIdx);

    for (let c = 1; c <= maxC; c++) {
      const t = cellText(row.getCell(c).value).trim();
      if (t && t.length <= 80 && /[A-Za-zÀ-ÿ]/.test(t)) {
        seenHeaders.add(t);
      }
    }
  }

  let r = 1;
  while (r <= ws.rowCount) {
    collectRowTexts(r);
    collectRowTexts(r + 1);

    const hit = findHeaderAt(ws, r);
    if (!hit) {
      r++;
      continue;
    }

    const { codeCol, qtyCol, headerMode } = hit;
    let dataRow = r + (headerMode === "double" ? 2 : 1);

    while (dataRow <= ws.rowCount) {
      if (hasNextHeader(ws, dataRow)) break;

      const row = ws.getRow(dataRow);
      const codeRaw = row.getCell(codeCol).value;
      const qtyRaw = row.getCell(qtyCol).value;

      const qtyNum = toNumberLoose(qtyRaw);
      if (qtyNum != null) {
        const code = normCode(cellText(codeRaw));
        if (looksLikeItemCode(code)) {
          const prev = out.get(code) ?? 0;
          out.set(code, prev + qtyNum);
        }
      }

      dataRow++;
    }

    r = dataRow;
  }

  if (out.size === 0) {
    const cols = Array.from(seenHeaders).slice(0, 30).join(" | ");
    throw new Error(
      `Nel file gestionale non ho estratto nessuna riga.\n` +
        `Controlla intestazioni: devo trovare una colonna CODICE e una colonna GIACENZA/QTA.\n` +
        `Intestazioni viste (prime 30): ${cols || "—"}`
    );
  }

  return out;
}

function applyRedRow(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  colCount: number
) {
  const fill = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: "FFFFC7CE" },
  };

  for (let c = 1; c <= colCount; c++) {
    ws.getCell(rowNumber, c).fill = fill;
  }
}

function styleTable(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  lastRow: number,
  lastCol: number
) {
  for (let r = headerRow; r <= lastRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(r, c).border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }
  }
}

function writeMeta(ws: ExcelJS.Worksheet, meta: InventoryExcelMeta) {
  ws.mergeCells("A1:I1");
  ws.getCell("A1").value = "CONFRONTO INVENTARIO vs GESTIONALE";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

  ws.getCell("A3").value = "Data";
  ws.getCell("B3").value = isoToIt(meta.inventoryDate);

  ws.getCell("A4").value = "Operatore";
  ws.getCell("B4").value = meta.operatore || "—";

  ws.getCell("A5").value = "Punto Vendita";
  ws.getCell("B5").value = meta.pvLabel || "—";

  ws.getCell("A6").value = "Categoria";
  ws.getCell("B6").value = meta.categoryName || "—";

  ws.getCell("A7").value = "Sottocategoria";
  ws.getCell("B7").value = meta.subcategoryName || "—";

  for (const rr of [3, 4, 5, 6, 7]) {
    ws.getCell(`A${rr}`).font = { bold: true };
  }
}

function safeSheetName(name: string) {
  const cleaned = String(name || "")
    .replace(/[\[\]\*\/\\\?\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, 31) || "FOGLIO";
}

function addCompareSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  meta: InventoryExcelMeta,
  lines: CompareLine[]
) {
  const ws = wb.addWorksheet(sheetName);
  writeMeta(ws, meta);

  const headerRow = 9;
  ws.getRow(headerRow).values = [
    "Codice",
    "Descrizione",
    "Qtà inventario",
    "Qtà gestionale",
    "Differenza (Inv-Ges)",
    "Prezzo Vendita",
    "Valore Inventario",
    "Valore Gestionale",
    "Valore Diff.",
  ];
  ws.getRow(headerRow).font = { bold: true };

  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 50;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 14;
  ws.getColumn(7).width = 16;
  ws.getColumn(8).width = 16;
  ws.getColumn(9).width = 14;

  const mergedView = [...(lines || [])];

  mergedView.sort((a, b) => {
    const da = String(a.description || "").trim();
    const db = String(b.description || "").trim();

    const cmpDesc = da.localeCompare(db, "it", { sensitivity: "base" });
    if (cmpDesc !== 0) return cmpDesc;

    return String(a.code || "").localeCompare(String(b.code || ""), "it", {
      sensitivity: "base",
    });
  });

  let rr = headerRow + 1;

  let totInv = 0;
  let totGes = 0;
  let totValInv = 0;
  let totValGes = 0;
  let totValDiff = 0;
  let totNegPieces = 0;
  let totNegValue = 0;

  for (const line of mergedView) {
    const qtyInv = Number(line.qtyInventory || 0);
    const qtyGest = Number(line.qtyGestionale || 0);
    const diff = qtyInv - qtyGest;

    const price =
      line.prezzoVenditaEur == null
        ? 0
        : Number.isFinite(Number(line.prezzoVenditaEur))
          ? Number(line.prezzoVenditaEur)
          : 0;

    // Se volumeMlPerUnit è presente, qtyInv / qtyGest / diff sono ML totali
    // e il prezzo è €/L, quindi trasformiamo in litri per i valori.
    const mlPerUnit =
      line.volumeMlPerUnit == null ? null : Number(line.volumeMlPerUnit);
    const isMl =
      mlPerUnit != null && Number.isFinite(mlPerUnit) && mlPerUnit > 0;

    const unitFactor = isMl ? 1 / 1000 : 1;

    const valueInv = qtyInv * unitFactor * price;
    const valueGest = qtyGest * unitFactor * price;
    const valueDiff = diff * unitFactor * price;

    ws.getRow(rr).values = [
      line.code || "",
      line.description || "",
      qtyInv,
      qtyGest,
      diff,
      price || "",
      valueInv || 0,
      valueGest || 0,
      valueDiff || 0,
    ];

    ws.getCell(rr, 3).numFmt = "0";
    ws.getCell(rr, 4).numFmt = "0";
    ws.getCell(rr, 5).numFmt = "0";
    ws.getCell(rr, 6).numFmt = '€ #,##0.00';
    ws.getCell(rr, 7).numFmt = '€ #,##0.00';
    ws.getCell(rr, 8).numFmt = '€ #,##0.00';
    ws.getCell(rr, 9).numFmt = '€ #,##0.00';

    if (!line.foundInGestionale || !line.foundInInventory) {
      applyRedRow(ws, rr, 9);
    }

    if (!isMl) {
      totInv += qtyInv;
      totGes += qtyGest;
    }

    totValInv += valueInv;
    totValGes += valueGest;
    totValDiff += valueDiff;

    if (diff < 0) {
      totNegPieces += -diff;
      totNegValue += -valueDiff;
    }

    rr++;
  }

  const totalRow = rr + 1;
  ws.getCell(totalRow, 2).value = "TOTALI";
  ws.getCell(totalRow, 3).value = totInv || "";
  ws.getCell(totalRow, 4).value = totGes || "";
  ws.getCell(totalRow, 5).value = "";
  ws.getCell(totalRow, 6).value = "";
  ws.getCell(totalRow, 7).value = totValInv || "";
  ws.getCell(totalRow, 8).value = totValGes || "";
  ws.getCell(totalRow, 9).value = totValDiff || "";
  ws.getRow(totalRow).font = { bold: true };

  ws.getCell(totalRow, 3).numFmt = "0";
  ws.getCell(totalRow, 4).numFmt = "0";
  ws.getCell(totalRow, 7).numFmt = '€ #,##0.00';
  ws.getCell(totalRow, 8).numFmt = '€ #,##0.00';
  ws.getCell(totalRow, 9).numFmt = '€ #,##0.00';

  const negRow1 = totalRow + 2;
  ws.getCell(negRow1, 2).value = "Totale pezzi mancanti (Inv < Ges)";
  ws.getCell(negRow1, 5).value = totNegPieces || "";
  ws.getRow(negRow1).font = { bold: true };
  ws.getCell(negRow1, 5).numFmt = "0";

  const negRow2 = totalRow + 3;
  ws.getCell(negRow2, 2).value = "Totale valore mancante (Inv < Ges)";
  ws.getCell(negRow2, 9).value = totNegValue || "";
  ws.getRow(negRow2).font = { bold: true };
  ws.getCell(negRow2, 9).numFmt = '€ #,##0.00';

  styleTable(ws, headerRow, totalRow, 9);
}

export async function buildInventoryCompareXlsx(
  meta: InventoryExcelMeta,
  lines: CompareLine[]
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();

  addCompareSheet(wb, "CONFRONTO", meta, lines);

  const hasGroups = (lines || []).some(
    (l) =>
      (l.categoryName || "").trim() || (l.subcategoryName || "").trim()
  );

  if (hasGroups) {
    const groups = new Map<string, CompareLine[]>();

    for (const l of lines || []) {
      const cat =
        (l.categoryName || "Senza categoria").toString().trim() ||
        "Senza categoria";
      const sub = (l.subcategoryName || "—").toString().trim() || "—";
      const key = `${cat}||${sub}`;

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(l);
    }

    const usedNames = new Set<string>();

    for (const [key, groupLines] of groups.entries()) {
      const [cat, sub] = key.split("||");
      let base = sub && sub !== "—" ? `${cat}-${sub}` : `${cat}`;
      base = safeSheetName(base);

      let name = base;
      let i = 2;
      while (usedNames.has(name) || wb.getWorksheet(name)) {
        name = safeSheetName(`${base}-${i}`);
        i++;
      }
      usedNames.add(name);

      addCompareSheet(wb, name, meta, groupLines);
    }
  }

  const outBuf = await wb.xlsx.writeBuffer();
  return outBuf as ArrayBuffer;
}

/**
 * Utility: costruisce righe confronto.
 * DIFFERENZA = Qtà inventario - Qtà gestionale
 *
 * Regola ML:
 * - se volume_ml_per_unit > 0 => qtyInventory = qty_ml (ML totali)
 * - qtyGestionale viene interpretata come ML totali
 */
export function buildCompareLines(
  inventoryLines: {
    code: string;
    description: string;
    qty: number;
    qty_ml?: number;
    prezzo_vendita_eur?: number | null;
    volume_ml_per_unit?: number | null;
    category_name?: string | null;
    subcategory_name?: string | null;
  }[],
  gestionaleMap: Map<string, number>,
  opts?: { onlyInventory?: boolean }
): CompareLine[] {
  const gestionaleCodes = new Set<string>();
  for (const k of gestionaleMap.keys()) {
    const kk = normCode(k);
    if (looksLikeItemCode(kk)) gestionaleCodes.add(kk);
  }

  const invMap = new Map<
    string,
    {
      description: string;
      qtyPieces: number;
      qtyMl: number;
      prezzo: number | null;
      mlPerUnit: number | null;
      categoryName: string | null;
      subcategoryName: string | null;
    }
  >();

  for (const l of inventoryLines) {
    const code = normCode(l.code);
    if (!looksLikeItemCode(code)) continue;

    const mlPerUnitRaw =
      l.volume_ml_per_unit == null ? null : Number(l.volume_ml_per_unit);
    const mlPerUnit =
      mlPerUnitRaw != null &&
      Number.isFinite(mlPerUnitRaw) &&
      mlPerUnitRaw > 0
        ? mlPerUnitRaw
        : null;

    invMap.set(code, {
      description: l.description || "",
      qtyPieces: Number(l.qty || 0),
      qtyMl: Number((l as any).qty_ml ?? 0),
      prezzo:
        l.prezzo_vendita_eur == null ? null : Number(l.prezzo_vendita_eur),
      mlPerUnit,
      categoryName:
        (l as any).category_name != null
          ? String((l as any).category_name)
          : null,
      subcategoryName:
        (l as any).subcategory_name != null
          ? String((l as any).subcategory_name)
          : null,
    });
  }

  const codes = new Set<string>();
  for (const k of invMap.keys()) codes.add(k);

  const onlyInventory = !!opts?.onlyInventory;
  if (!onlyInventory) {
    for (const k of gestionaleCodes) codes.add(k);
  }

  const out: CompareLine[] = [];

  for (const code of codes) {
    const inv = invMap.get(code);

    const foundInInventory = invMap.has(code);
    const foundInGestionale = gestionaleCodes.has(code);

    const isMlItem =
      inv?.mlPerUnit != null &&
      Number.isFinite(inv.mlPerUnit) &&
      inv.mlPerUnit > 0;

    const qtyInv = isMlItem
      ? Number(inv?.qtyMl ?? 0)
      : Number(inv?.qtyPieces ?? 0);

    let qtyGes = Number(gestionaleMap.get(code) ?? 0);

    // Liquidi: se il gestionale esporta in litri decimali, convertiamo a ML
    if (isMlItem) {
      const hasDecimals = Math.abs(qtyGes - Math.trunc(qtyGes)) > 0.000001;

      if (qtyGes !== 0 && Math.abs(qtyGes) < 1000 && hasDecimals) {
        qtyGes = Math.round(qtyGes * 1000);
      }
    }

    if (qtyGes < 0) {
      qtyGes = 0;
    }

    const diff = qtyInv - qtyGes;

    out.push({
      code,
      description: inv?.description ?? "",
      qtyInventory: qtyInv,
      qtyGestionale: qtyGes,
      diff,
      prezzoVenditaEur: inv?.prezzo ?? null,
      volumeMlPerUnit: isMlItem ? inv?.mlPerUnit ?? null : null,
      foundInInventory,
      foundInGestionale,
      categoryName: inv?.categoryName ?? null,
      subcategoryName: inv?.subcategoryName ?? null,
    });
  }

  out.sort((a, b) =>
    String(a.code || "").localeCompare(String(b.code || ""))
  );

  return out;
}




























