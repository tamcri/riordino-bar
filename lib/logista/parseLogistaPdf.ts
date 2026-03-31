export type ParsedRow = {
  riga: string;
  codice: string;
  quantita: string;
};

export type LogistaParseDebug = {
  tokens: string[];
  rowsPreview: ParsedRow[];
};

function decodePdfText(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function readTokens(buffer: Buffer): Promise<string[]> {
  const mod = await import("pdf2json");
  const PDFParser = (mod as any).default ?? mod;

  return await new Promise<string[]>((resolve, reject) => {
    const parser = new PDFParser(null, 1);

    parser.on("pdfParser_dataError", (errData: any) => {
      reject(errData?.parserError || new Error("Errore lettura PDF."));
    });

    parser.on("pdfParser_dataReady", (pdfData: any) => {
      try {
        const tokens: string[] = [];
        const pages = Array.isArray(pdfData?.Pages) ? pdfData.Pages : [];

        for (const page of pages) {
          const texts = Array.isArray(page?.Texts) ? page.Texts : [];

          for (const textItem of texts) {
            const runs = Array.isArray(textItem?.R) ? textItem.R : [];

            for (const run of runs) {
              const decoded = decodePdfText(String(run?.T ?? "")).trim();
              if (decoded) tokens.push(decoded);
            }
          }
        }

        resolve(tokens);
      } catch (error) {
        reject(error);
      }
    });

    parser.parseBuffer(buffer);
  });
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

export async function parseLogistaPdf(buffer: Buffer): Promise<ParsedRow[]> {
  const { rows } = await parseLogistaPdfWithDebug(buffer);
  return rows;
}

export async function parseLogistaPdfWithDebug(
  buffer: Buffer
): Promise<{ rows: ParsedRow[]; debug: LogistaParseDebug }> {
  const tokens = await readTokens(buffer);

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    if (!isRowNumber(current)) continue;

    const next = tokens[i + 1];
    if (!isCode(next)) continue;

    let quantita: string | null = null;

    for (let j = i + 2; j < i + 20 && j < tokens.length; j++) {
      if (isQuantity(tokens[j])) {
        quantita = tokens[j];
        break;
      }
    }

    if (!quantita) continue;

    const key = `${current}__${next}__${quantita}`;
    if (seen.has(key)) continue;

    seen.add(key);
    rows.push({
      riga: current,
      codice: next,
      quantita,
    });
  }

  return {
    rows,
    debug: {
      tokens: tokens.slice(0, 300),
      rowsPreview: rows.slice(0, 20),
    },
  };
}