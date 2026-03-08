import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { getProgressiviReportData } from "@/lib/progressivi/report";

export const runtime = "nodejs";

const COLORS = {
  previous: "FCE7F3", // rosa chiaro pastello
  current: "E0F2FE", // azzurro chiaro pastello
  riscontro: "FFEDD5", // arancio chiaro
  manual: "FEF3C7", // giallo più evidente
  neutralHeader: "F9FAFB",
  totalNeutral: "E5E7EB",
  totalPrevious: "FBCFE8",
  totalCurrent: "BAE6FD",
  totalRiscontro: "FDBA74",
  totalManual: "FDE68A",
  border: "D1D5DB",
  noteText: "4B5563",
};

function formatDateIT(iso: string | null | undefined) {
  const s = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function applyBorder(row: ExcelJS.Row, from: number, to: number) {
  for (let i = from; i <= to; i++) {
    row.getCell(i).border = {
      top: { style: "thin", color: { argb: COLORS.border } },
      left: { style: "thin", color: { argb: COLORS.border } },
      bottom: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
  }
}

function euroFormula(priceCell: string, qtyCell: string) {
  return `${qtyCell}*${priceCell}`;
}

function getHeaderFill(colNumber: number) {
  if (colNumber === 6 || colNumber === 11) return COLORS.manual;
  if (colNumber >= 4 && colNumber <= 8) return COLORS.previous;
  if (colNumber >= 9 && colNumber <= 13) return COLORS.current;
  if (colNumber >= 14 && colNumber <= 15) return COLORS.riscontro;
  return COLORS.neutralHeader;
}

function getDataFill(colNumber: number) {
  if (colNumber === 6 || colNumber === 11) return COLORS.manual;
  if (colNumber >= 4 && colNumber <= 8) return COLORS.previous;
  if (colNumber >= 9 && colNumber <= 13) return COLORS.current;
  if (colNumber >= 14 && colNumber <= 15) return COLORS.riscontro;
  return null;
}

function getTotalFill(colNumber: number) {
  if (colNumber === 6 || colNumber === 11) return COLORS.totalManual;
  if (colNumber >= 4 && colNumber <= 8) return COLORS.totalPrevious;
  if (colNumber >= 9 && colNumber <= 13) return COLORS.totalCurrent;
  if (colNumber >= 14 && colNumber <= 15) return COLORS.totalRiscontro;
  return COLORS.totalNeutral;
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);

    const data = await getProgressiviReportData({
      header_id: url.searchParams.get("header_id"),
      pv_id: url.searchParams.get("pv_id"),
      inventory_date: url.searchParams.get("inventory_date"),
      category_id: url.searchParams.get("category_id"),
      subcategory_id: url.searchParams.get("subcategory_id"),
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Report Progressivi", {
      views: [{ state: "frozen", ySplit: 4, xSplit: 3 }],
    });

    ws.columns = [
      { width: 18 }, // A Codice
      { width: 40 }, // B Descrizione
      { width: 8 }, // C UM
      { width: 14 }, // D Prev Inventario
      { width: 18 }, // E Prev Giacenza gestionale
      { width: 18 }, // F Prev Carico non registrato
      { width: 14 }, // G Prev Giacenza
      { width: 18 }, // H Prev Valore inventario
      { width: 14 }, // I Curr Inventario
      { width: 18 }, // J Curr Giacenza gestionale
      { width: 18 }, // K Curr Carico non registrato
      { width: 14 }, // L Curr Giacenza
      { width: 18 }, // M Curr Valore inventario
      { width: 14 }, // N Differenza
      { width: 18 }, // O Valore differenza
      { width: 12 }, // P Prezzo unitario nascosto
    ];

    ws.mergeCells("A1:P1");
    ws.getCell("A1").value = `${data.pv.label} — Report Progressivi`;
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.getCell("A1").alignment = { vertical: "middle" };

    ws.mergeCells("A2:P2");
    ws.getCell("A2").value = `Label: ${data.current_header.label || "—"}`;
    ws.getCell("A2").font = { italic: true, color: { argb: COLORS.noteText } };

    ws.mergeCells("D3:H3");
    ws.getCell("D3").value = formatDateIT(data.previous_header?.inventory_date);
    ws.getCell("D3").alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell("D3").font = { bold: true };
    ws.getCell("D3").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.previous },
    };

    ws.mergeCells("I3:M3");
    ws.getCell("I3").value = formatDateIT(data.current_header.inventory_date);
    ws.getCell("I3").alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell("I3").font = { bold: true };
    ws.getCell("I3").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.current },
    };

    ws.mergeCells("N3:O3");
    ws.getCell("N3").value = "RISCONTRO";
    ws.getCell("N3").alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell("N3").font = { bold: true };
    ws.getCell("N3").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.riscontro },
    };

    const headerRow = ws.getRow(4);
    headerRow.values = [
      "Codice",
      "Descrizione",
      "UM",
      "INVENTARIO",
      "GIACENZA DA GESTIONALE",
      "CARICO NON REGISTRATO",
      "GIACENZA",
      "VALORE INVENTARIO",
      "INVENTARIO",
      "GIACENZA DA GESTIONALE",
      "CARICO NON REGISTRATO",
      "GIACENZA",
      "VALORE INVENTARIO",
      "DIFFERENZA",
      "VALORE DIFFERENZA",
      "PREZZO",
    ];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    headerRow.height = 34;

    headerRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: getHeaderFill(colNumber) },
      };
    });

    applyBorder(headerRow, 1, 16);

    let rowIndex = 5;

    for (const row of data.rows) {
      const excelRow = ws.getRow(rowIndex);

      const priceCell = `P${rowIndex}`;
      const prevInventarioCell = `D${rowIndex}`;
      const prevGestCell = `E${rowIndex}`;
      const prevCaricoCell = `F${rowIndex}`;
      const prevGiacenzaCell = `G${rowIndex}`;
      const currInventarioCell = `I${rowIndex}`;
      const currGestCell = `J${rowIndex}`;
      const currCaricoCell = `K${rowIndex}`;
      const currGiacenzaCell = `L${rowIndex}`;
      const diffCell = `N${rowIndex}`;

      excelRow.getCell(1).value = row.item_code;
      excelRow.getCell(2).value = row.description;
      excelRow.getCell(3).value = row.um || "";

      excelRow.getCell(4).value = row.previous.inventario;
      excelRow.getCell(5).value = row.previous.giacenza_da_gestionale;
      excelRow.getCell(6).value = 0;
      excelRow.getCell(7).value = { formula: `${prevInventarioCell}-${prevGestCell}-${prevCaricoCell}` };
      excelRow.getCell(8).value = { formula: euroFormula(priceCell, prevInventarioCell) };

      excelRow.getCell(9).value = row.current.inventario;
      excelRow.getCell(10).value = row.current.giacenza_da_gestionale;
      excelRow.getCell(11).value = 0;
      excelRow.getCell(12).value = { formula: `${currInventarioCell}-${currGestCell}-${currCaricoCell}` };
      excelRow.getCell(13).value = { formula: euroFormula(priceCell, currInventarioCell) };

      excelRow.getCell(14).value = { formula: `${currGiacenzaCell}-${prevGiacenzaCell}` };
      excelRow.getCell(15).value = { formula: euroFormula(priceCell, diffCell) };

      // colonna tecnica nascosta
      excelRow.getCell(16).value = row.prezzo_vendita_eur;

      excelRow.alignment = { vertical: "middle", wrapText: true };
      excelRow.getCell(1).numFmt = "@";

      for (const idx of [4, 5, 6, 7, 9, 10, 11, 12, 14, 16]) {
        excelRow.getCell(idx).numFmt = "0.000";
      }

      for (const idx of [8, 13, 15]) {
        excelRow.getCell(idx).numFmt = '€ #,##0.00;[Red]-€ #,##0.00';
      }

      for (let col = 1; col <= 16; col++) {
        const fill = getDataFill(col);
        if (!fill) continue;
        excelRow.getCell(col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fill },
        };
      }

      applyBorder(excelRow, 1, 16);
      rowIndex += 1;
    }

    const totalRow = ws.getRow(rowIndex);
    totalRow.getCell(2).value = "TOTALI";

    totalRow.getCell(4).value = { formula: `SUM(D5:D${rowIndex - 1})` };
    totalRow.getCell(5).value = { formula: `SUM(E5:E${rowIndex - 1})` };
    totalRow.getCell(6).value = { formula: `SUM(F5:F${rowIndex - 1})` };
    totalRow.getCell(7).value = { formula: `SUM(G5:G${rowIndex - 1})` };
    totalRow.getCell(8).value = { formula: `SUM(H5:H${rowIndex - 1})` };

    totalRow.getCell(9).value = { formula: `SUM(I5:I${rowIndex - 1})` };
    totalRow.getCell(10).value = { formula: `SUM(J5:J${rowIndex - 1})` };
    totalRow.getCell(11).value = { formula: `SUM(K5:K${rowIndex - 1})` };
    totalRow.getCell(12).value = { formula: `SUM(L5:L${rowIndex - 1})` };
    totalRow.getCell(13).value = { formula: `SUM(M5:M${rowIndex - 1})` };

    totalRow.getCell(14).value = { formula: `SUM(N5:N${rowIndex - 1})` };
    totalRow.getCell(15).value = { formula: `SUM(O5:O${rowIndex - 1})` };

    totalRow.font = { bold: true };

    for (let col = 1; col <= 16; col++) {
      totalRow.getCell(col).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: getTotalFill(col) },
      };
    }

    for (const idx of [4, 5, 6, 7, 9, 10, 11, 12, 14, 16]) {
      totalRow.getCell(idx).numFmt = "0.000";
    }

    for (const idx of [8, 13, 15]) {
      totalRow.getCell(idx).numFmt = '€ #,##0.00;[Red]-€ #,##0.00';
    }

    applyBorder(totalRow, 1, 16);

    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: 15 },
    };

    ws.getColumn(16).hidden = true;
    ws.getRow(1).height = 22;
    ws.getRow(3).height = 20;

    const noteRowIndex = rowIndex + 2;
    ws.mergeCells(`A${noteRowIndex}:O${noteRowIndex}`);
    ws.getCell(`A${noteRowIndex}`).value =
      "Nota: le colonne 'CARICO NON REGISTRATO' sono modificabili solo nel file Excel. Le colonne GIACENZA, DIFFERENZA e VALORE DIFFERENZA si aggiornano automaticamente tramite formula.";
    ws.getCell(`A${noteRowIndex}`).font = {
      italic: true,
      color: { argb: COLORS.noteText },
    };

    const buf = await wb.xlsx.writeBuffer();
    const filename = `report_progressivi_${data.pv.code}_${data.current_header.inventory_date}.xlsx`;

    return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore generazione report progressivi" },
      { status: 400 }
    );
  }
}