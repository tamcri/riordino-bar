import { NextResponse } from "next/server";

type ParsedRow = {
  riga: string;
  codice: string;
  quantita: string;
};

function isValidRow(row: any): row is ParsedRow {
  return (
    row &&
    typeof row === "object" &&
    typeof row.riga === "string" &&
    row.riga.trim().length > 0 &&
    typeof row.codice === "string" &&
    row.codice.trim().length > 0 &&
    typeof row.quantita === "string" &&
    row.quantita.trim().length > 0
  );
}

function sanitizeFilename(value: string | null | undefined) {
  const base = String(value || "logista_excel")
    .replace(/\.pdf$/i, "")
    .replace(/\.xlsx$/i, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${base || "logista_excel"}.xlsx`;
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    const { buildLogistaExcel } = await import("@/lib/logista/buildLogistaExcel");

    // Nuovo flusso: export dalle righe già validate/escluse nel frontend
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);
      const rows = Array.isArray(body?.rows) ? body.rows.filter(isValidRow) : [];
      const filename = sanitizeFilename(body?.filename);

      if (!rows.length) {
        return NextResponse.json(
          { ok: false, error: "Nessuna riga valida da esportare." },
          { status: 400 }
        );
      }

      const excelBuffer = await buildLogistaExcel(rows);

      return new NextResponse(new Uint8Array(excelBuffer), {
        status: 200,
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    }

    // Fallback compatibile con il vecchio flusso
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "File PDF mancante." },
        { status: 400 }
      );
    }

    const lowerName = file.name.toLowerCase();
    const isPdfMime = file.type === "application/pdf";
    const isPdfName = lowerName.endsWith(".pdf");

    if (!isPdfMime && !isPdfName) {
      return NextResponse.json(
        { ok: false, error: "Il file caricato non è un PDF valido." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { parseLogistaPdf } = await import("@/lib/logista/parseLogistaPdf");
    const rows = await parseLogistaPdf(buffer);

    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "Nessuna riga valida trovata nel PDF Logista." },
        { status: 400 }
      );
    }

    const excelBuffer = await buildLogistaExcel(rows);
    const filename = sanitizeFilename(file.name);

    return new NextResponse(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore generazione Excel Logista." },
      { status: 500 }
    );
  }
}