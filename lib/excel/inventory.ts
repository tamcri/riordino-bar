// lib/excel/inventory.ts
import ExcelJS from "exceljs";

export type InventoryExcelMeta = {
  inventoryDate: string; // YYYY-MM-DD
  operatore: string; // testo
  pvLabel: string; // es. "PV01 — Bar Centrale"
  categoryName: string; // es. "Tabacchi"
  subcategoryName: string; // es. "Sigarette" oppure "—"
};

export type InventoryExcelLine = {
  code: string;
  description: string;
  qty: number; // pezzi
  qty_gr?: number; // grammi
  qty_ml?: number; // ml
};

function isoToIt(iso: string) {
  const s = (iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}-${m}-${y}`;
}

export async function buildInventoryXlsx(meta: InventoryExcelMeta, lines: InventoryExcelLine[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("INVENTARIO");

  // Titolo
  ws.mergeCells("A1:E1");
  ws.getCell("A1").value = "INVENTARIO";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

  // Meta (header richiesto)
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

  for (const r of [3, 4, 5, 6, 7]) {
    ws.getCell(`A${r}`).font = { bold: true };
  }

  // Tabella
  const headerRow = 9;
  ws.getRow(headerRow).values = ["Codice", "Descrizione", "PZ", "GR", "ML"];
  ws.getRow(headerRow).font = { bold: true };

  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 60;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 12;

  let rr = headerRow + 1;

  let totPz = 0;
  let totGr = 0;
  let totMl = 0;

  for (const line of lines) {
    const pz = Number(line.qty || 0);
    const gr = Number((line as any).qty_gr || 0);
    const ml = Number((line as any).qty_ml || 0);

    ws.getRow(rr).values = [line.code || "", line.description || "", pz, gr, ml];
    ws.getCell(rr, 3).numFmt = "0";
    ws.getCell(rr, 4).numFmt = "0";
    ws.getCell(rr, 5).numFmt = "0";

    totPz += pz;
    totGr += gr;
    totMl += ml;

    rr++;
  }

  const totalRow = rr + 1;
  ws.getCell(totalRow, 2).value = "TOTALE";
  ws.getCell(totalRow, 3).value = totPz || "";
  ws.getCell(totalRow, 4).value = totGr || "";
  ws.getCell(totalRow, 5).value = totMl || "";
  ws.getRow(totalRow).font = { bold: true };
  ws.getCell(totalRow, 3).numFmt = "0";
  ws.getCell(totalRow, 4).numFmt = "0";
  ws.getCell(totalRow, 5).numFmt = "0";

  // Bordi (puliti)
  const last = totalRow;
  for (let r = headerRow; r <= last; r++) {
    for (let c = 1; c <= 5; c++) {
      ws.getCell(r, c).border = {
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

