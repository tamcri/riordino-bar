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

function cellToNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  // ExcelJS spesso usa oggetti tipo { richText } o { text }
  if (typeof val === "object" && val !== null && "text" in (val as any)) {
    return String((val as any).text ?? "").trim();
  }
  return String(val).trim();
}

export async function processReorderExcel(
  input: ArrayBuffer
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
  const workbook = new ExcelJS.Workbook();

  // ✅ carico direttamente ArrayBuffer (niente Buffer)
  await workbook.xlsx.load(input);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Foglio Excel non trovato");

  // 1) Trova riga intestazioni nelle prime 30 righe
  let headerRowNumber = -1;
  let headers: string[] = [];
  const previewDebug: string[] = [];

  for (let r = 1; r <= 30; r++) {
    const row = worksheet.getRow(r);
    const vals = rowToStrings(row);
    const joined = normalize(vals.join(" | "));

    if (joined.replace(/\|/g, "").trim().length > 0) {
      previewDebug.push(`R${r}: ${vals.join(" | ")}`);
    }

    // euristica: intestazione contiene "vend" e "giacen"
    if (joined.includes("vend") && joined.includes("giacen")) {
      headerRowNumber = r;
      headers = vals;
      break;
    }
  }

  if (headerRowNumber === -1 || headers.length === 0) {
    throw new Error(
      "Non trovo la riga intestazioni (Venduta / Giacenza). Prime righe viste:\n" +
        previewDebug.slice(0, 10).join("\n")
    );
  }

  // 2) Trova colonne necessarie (varianti)
  const idxCodArticolo = findColumnIndex(headers, [
    "cod. articolo",
    "cod articolo",
    "codice articolo",
    "cod. art",
    "cod art",
    "articolo", // fallback
  ]);

  const idxDescrizione = findColumnIndex(headers, ["descrizione", "desc", "descr"]);

  const idxVenduta = findColumnIndex(headers, [
    "qta venduta",
    "qtà venduta",
    "quantita venduta",
    "venduta",
    "vendite",
  ]);

  const idxGiacenza = findColumnIndex(headers, ["giacenza bar", "giacenza", "giacenze"]);

  const idxOrdine = findColumnIndex(headers, [
    "qta da ordinare",
    "qtà da ordinare",
    "quantita da ordinare",
    "da ordinare",
    "ordinare",
  ]);

  const idxPeso = findColumnIndex(headers, ["qta in peso", "qtà in peso", "peso", "kg"]);

  if (idxCodArticolo === -1)
    throw new Error("Colonna 'Cod. Articolo' non trovata. Intestazioni: " + headers.join(" | "));
  if (idxDescrizione === -1)
    throw new Error("Colonna 'Descrizione' non trovata. Intestazioni: " + headers.join(" | "));
  if (idxVenduta === -1)
    throw new Error("Colonna 'Qtà Venduta' non trovata. Intestazioni: " + headers.join(" | "));
  if (idxGiacenza === -1)
    throw new Error("Colonna 'Giacenza BAR' non trovata. Intestazioni: " + headers.join(" | "));
  if (idxOrdine === -1)
    throw new Error("Colonna 'Qtà da ordinare' non trovata. Intestazioni: " + headers.join(" | "));
  if (idxPeso === -1)
    throw new Error("Colonna 'Qtà in peso (kg)' non trovata. Intestazioni: " + headers.join(" | "));

  // Indici Excel (1-based)
  const cCodArticolo = idxCodArticolo + 1;
  const cDescrizione = idxDescrizione + 1;
  const cVenduta = idxVenduta + 1;
  const cGiacenza = idxGiacenza + 1;
  const cOrdine = idxOrdine + 1;
  const cPeso = idxPeso + 1;

  const rows: {
    codArticolo: string;
    descrizione: string;
    qtaVenduta: number;
    giacenza: number;
    qtaOrdine: number;
    pesoKg: number;
  }[] = [];

  // 3) Elabora righe dati dalla riga dopo l’intestazione
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;

    const codArticolo = cellToString(row.getCell(cCodArticolo).value);
    const descrizione = cellToString(row.getCell(cDescrizione).value);

    const venduta = cellToNumber(row.getCell(cVenduta).value);
    const giacenza = cellToNumber(row.getCell(cGiacenza).value);

    // se la riga è vuota, saltala
    const hasSomeData =
      codArticolo !== "" || descrizione !== "" || venduta !== 0 || giacenza !== 0;

    if (!hasSomeData) return;

    // Regola: copertura settimana corrente + 3 future => 4 settimane
    const fabbisogno = venduta * 4;
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


