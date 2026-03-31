import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
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

    const { parseLogistaPdfWithDebug } = await import("@/lib/logista/parseLogistaPdf");

    const { rows, debug } = await parseLogistaPdfWithDebug(buffer);

    return NextResponse.json({
      ok: true,
      rows,
      count: rows.length,
      debugTokens: debug.tokens,
      debugRowsPreview: debug.rowsPreview,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore parsing PDF." },
      { status: 500 }
    );
  }
}