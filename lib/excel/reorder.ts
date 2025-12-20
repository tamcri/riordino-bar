import ExcelJS from "exceljs";

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

function rowToStrings(row: ExcelJS.Row): string[] {
  const out: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell) => {
    const v = cell?.value;
    if (v == null) out.push("");
    else if (typeof v === "string") out.push(v);
    else if (typeof v === "number") out.push(String(v));
    else if (typeof v === "object" && "text" in v) out.push(String((v as any).text || ""));
    else out.push(String(v));
  });
  return out;
}

function toNumberSafe(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(",", ".").replace(/[^\d.-]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeWeeks(weeks?: number): number {
  const w = Number(weeks);
  if (!Number.isFinite(w)) return 4;
  const wi = Math.trunc(w);
  if (wi < 1) return 1;
  if (wi > 4) return 4;
  return wi;
}

export async function processReorderExcel(
  input: ArrayBuffer,
  weeks: number = 4
): Promise<{
  xlsx: Uint8Array;
  rows: {
    codArticolo: string;
    descrizione: string;
    qtaVenduta: number;
    giacenza: number;
    qtaOrdine: number;
    pesoKg: number;
  }[];
}> {
  const WEEKS = sanitizeWeeks(weeks);

  const workbook = new ExcelJS.Workbook();

  // ✅ carico direttamente ArrayBuffer (niente Buffer)
  await workbook.xlsx.load(input);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Foglio Excel non trovato");

  // 1) Trova riga intestazioni nelle prime 30 righe
  let headerRowNumber = -1;
  let cCod = -1;
  let cDesc = -1;
  let cVenduta = -1;
  let cGiacenza = -1;
  let cOrdine = -1;
  let cPeso = -1;

  for (let r = 1; r <= Math.min(30, worksheet.rowCount); r++) {
    const row = worksheet.getRow(r);
    const cells = rowToStrings(row).map(normalize);

    const idxCod =
      cells.findIndex((x) => x.includes("cod") && x.includes("art")) ??
      -1;
    const idxDesc = cells.findIndex((x) => x.includes("descr")) ?? -1;

    const idxVend =
      cells.findIndex((x) => x.includes("vendut")) ??
      cells.findIndex((x) => x.includes("qta vend")) ??
      -1;

    const idxGiac =
      cells.findIndex((x) => x.includes("giac")) ??
      cells.findIndex((x) => x.includes("giacenza bar")) ??
      -1;

    if (idxCod >= 0 && idxDesc >= 0 && idxVend >= 0 && idxGiac >= 0) {
      headerRowNumber = r;

      // ExcelJS è 1-based
      cCod = idxCod + 1;
      cDesc = idxDesc + 1;
      cVenduta = idxVend + 1;
      cGiacenza = idxGiac + 1;

      // colonne output: se esistono le usiamo, altrimenti le creiamo in coda
      const existingOrd = cells.findIndex((x) => x.includes("da ordinare"));
      const existingPeso = cells.findIndex((x) => x.includes("peso") || x.includes("kg"));

      cOrdine = existingOrd >= 0 ? existingOrd + 1 : worksheet.columnCount + 1;
      cPeso = existingPeso >= 0 ? existingPeso + 1 : Math.max(worksheet.columnCount + 1, cOrdine + 1);

      break;
    }
  }

  if (headerRowNumber < 0) {
    throw new Error(
      "Intestazioni non trovate: servono almeno Cod. Articolo, Descrizione, Qtà Venduta, Giacenza BAR."
    );
  }

  // Se abbiamo creato colonne nuove in coda, aggiorna la columnCount di fatto
  const maxCol = Math.max(cCod, cDesc, cVenduta, cGiacenza, cOrdine, cPeso);
  if (worksheet.columnCount < maxCol) {
    worksheet.columns = Array.from({ length: maxCol }, (_, i) => worksheet.getColumn(i + 1));
  }

  const rows: {
    codArticolo: string;
    descrizione: string;
    qtaVenduta: number;
    giacenza: number;
    qtaOrdine: number;
    pesoKg: number;
  }[] = [];

  // 2) Scorri righe dati
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;

    const codArticolo = String(row.getCell(cCod).value ?? "").trim();
    const descrizione = String(row.getCell(cDesc).value ?? "").trim();
    const venduta = toNumberSafe(row.getCell(cVenduta).value);
    const giacenza = toNumberSafe(row.getCell(cGiacenza).value);

    const hasSomeData =
      codArticolo !== "" || descrizione !== "" || venduta !== 0 || giacenza !== 0;

    if (!hasSomeData) return;

    // ✅ Regola: fabbisogno basato su periodo selezionato (1–4 settimane)
    const fabbisogno = venduta * WEEKS;
    const mancante = Math.max(0, fabbisogno - giacenza);

    // confezione = 10 pezzi, arrotonda sempre per eccesso
    const qtaOrdine = Math.ceil(mancante / 10) * 10;

    // 10 pezzi = 0,2 kg => 1 pezzo = 0,02 kg
    const pesoKg = Number((qtaOrdine * 0.02).toFixed(1));

    // Scrivi nel file SOLO le colonne richieste
    row.getCell(cOrdine).value = qtaOrdine;
    row.getCell(cPeso).value = pesoKg;

    rows.push({ codArticolo, descrizione, qtaVenduta: venduta, giacenza, qtaOrdine, pesoKg });
  });

  // ✅ Forza le intestazioni (evita che Excel le mostri come 0 dopo il save)
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.getCell(cVenduta).value = "Qtà Venduta";
  headerRow.getCell(cGiacenza).value = "Giacenza BAR";
  headerRow.getCell(cOrdine).value = "Qtà da ordinare";
  headerRow.getCell(cPeso).value = "Qtà in peso (kg)";
  headerRow.commit?.();

  const out = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return { xlsx: new Uint8Array(out), rows };
}



