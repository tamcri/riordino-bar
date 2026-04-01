import ExcelJS from "exceljs";

export type LogistaExcelRow = {
  riga: string;
  codice: string;
  quantita: string;
};

export async function buildLogistaExcel(rows: LogistaExcelRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Logista");

  // Definizione colonne con spazi vuoti
  worksheet.columns = [
    { header: "Riga", key: "riga", width: 12 }, // A
    { header: "Cod. AAMS", key: "codice", width: 18 }, // B
    { header: "", key: "empty1", width: 5 }, // C (vuota)
    { header: "", key: "empty2", width: 5 }, // D (vuota)
    { header: "Quantità(Kgc)", key: "quantita", width: 18 }, // E
  ];

  // Stile header
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };

  // Inserimento righe con numerazione progressiva ricostruita
  for (const [index, row] of rows.entries()) {
    worksheet.addRow({
      riga: String(index + 1),
      codice: row.codice,
      empty1: "",
      empty2: "",
      quantita: row.quantita,
    });
  }

  // Allineamento globale
  worksheet.eachRow((row) => {
    row.alignment = { vertical: "middle", horizontal: "left" };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}