export type ParsedRow = {
  riga: string;
  codice: string;
  quantita: string;
};

export type LogistaParseDebug = {
  tokens: string[];
  rowsPreview: ParsedRow[];
};

type PdfTextItem = {
  x: number;
  y: number;
  text: string;
};

function decodePdfText(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isQuantity(value: string) {
  return /^\d+,\d+$/.test(value);
}

function isCode(value: string) {
  return /^[A-Z0-9]+$/i.test(value);
}

function isRowNumber(value: string) {
  return /^\d+$/.test(value);
}

function shouldSkipLine(lineText: string) {
  const normalized = normalizeSpaces(lineText).toLowerCase();

  if (!normalized) return true;

  const blockedStarts = [
    "dep.fisc",
    "rivendita",
    "comune",
    "titolare",
    "cod.tit",
    "pagina ",
    "totale ",
    "modello assentito",
    "d.p.r.",
  ];

  if (blockedStarts.some((value) => normalized.startsWith(value))) {
    return true;
  }

  if (
    normalized.includes("numero ordine") ||
    normalized.includes("tipo levata") ||
    normalized.includes("data consegna")
  ) {
    return true;
  }

  if (
    normalized.includes("riga") &&
    normalized.includes("cod.aams") &&
    normalized.includes("quantità")
  ) {
    return true;
  }

  return false;
}

async function readPageTextItems(buffer: Buffer): Promise<PdfTextItem[][]> {
  const mod = await import("pdf2json");
  const PDFParser = (mod as any).default ?? mod;

  return await new Promise<PdfTextItem[][]>((resolve, reject) => {
    const parser = new PDFParser(null, 1);

    parser.on("pdfParser_dataError", (errData: any) => {
      reject(errData?.parserError || new Error("Errore lettura PDF."));
    });

    parser.on("pdfParser_dataReady", (pdfData: any) => {
      try {
        const pages = Array.isArray(pdfData?.Pages) ? pdfData.Pages : [];
        const result: PdfTextItem[][] = [];

        for (const page of pages) {
          const texts = Array.isArray(page?.Texts) ? page.Texts : [];
          const pageItems: PdfTextItem[] = [];

          for (const textItem of texts) {
            const runs = Array.isArray(textItem?.R) ? textItem.R : [];
            const decodedText = runs
              .map((run: any) => decodePdfText(String(run?.T ?? "")).trim())
              .filter(Boolean)
              .join(" ")
              .trim();

            if (!decodedText) continue;

            pageItems.push({
              x: Number(textItem?.x ?? 0),
              y: Number(textItem?.y ?? 0),
              text: decodedText,
            });
          }

          result.push(pageItems);
        }

        resolve(result);
      } catch (error) {
        reject(error);
      }
    });

    parser.parseBuffer(buffer);
  });
}

function groupPageItemsIntoLines(items: PdfTextItem[]) {
  const sortedItems = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) <= 0.2) return a.x - b.x;
    return a.y - b.y;
  });

  const lines: PdfTextItem[][] = [];

  for (const item of sortedItems) {
    const lastLine = lines[lines.length - 1];

    if (!lastLine) {
      lines.push([item]);
      continue;
    }

    const referenceY = lastLine[0]?.y ?? item.y;

    if (Math.abs(item.y - referenceY) <= 0.2) {
      lastLine.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines.map((line) => [...line].sort((a, b) => a.x - b.x));
}

function extractRowFromLine(line: PdfTextItem[]): ParsedRow | null {
  const tokens = line.map((item) => normalizeSpaces(item.text)).filter(Boolean);
  if (!tokens.length) return null;

  const lineText = normalizeSpaces(tokens.join(" "));
  if (shouldSkipLine(lineText)) return null;

  const first = tokens[0];
  const second = tokens[1];
  const last = tokens[tokens.length - 1];

  if (!isRowNumber(first)) return null;
  if (!second || !isCode(second)) return null;
  if (!isQuantity(last)) return null;

  return {
    riga: first,
    codice: second,
    quantita: last,
  };
}

export async function parseLogistaPdf(buffer: Buffer): Promise<ParsedRow[]> {
  const { rows } = await parseLogistaPdfWithDebug(buffer);
  return rows;
}

export async function parseLogistaPdfWithDebug(
  buffer: Buffer
): Promise<{ rows: ParsedRow[]; debug: LogistaParseDebug }> {
  const pages = await readPageTextItems(buffer);

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  const debugTokens: string[] = [];

  for (const pageItems of pages) {
    const lines = groupPageItemsIntoLines(pageItems);

    for (const line of lines) {
      const lineText = normalizeSpaces(line.map((item) => item.text).join(" "));
      if (lineText) {
        debugTokens.push(lineText);
      }

      const parsed = extractRowFromLine(line);
      if (!parsed) continue;

      const key = `${parsed.riga}__${parsed.codice}__${parsed.quantita}`;
      if (seen.has(key)) continue;

      seen.add(key);
      rows.push(parsed);
    }
  }

  return {
    rows,
    debug: {
      tokens: debugTokens.slice(0, 300),
      rowsPreview: rows.slice(0, 20),
    },
  };
}