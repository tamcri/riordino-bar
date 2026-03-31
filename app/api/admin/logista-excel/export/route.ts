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

    const { parseLogistaPdf } = await import("@/lib/logista/parseLogistaPdf");
    const { buildLogistaExcel } = await import("@/lib/logista/buildLogistaExcel");

    const rows = await parseLogistaPdf(buffer);

    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "Nessuna riga valida trovata nel PDF Logista." },
        { status: 400 }
      );
    }

    const excelBuffer = await buildLogistaExcel(rows);

    const safeBaseName = file.name.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9-_]+/g, "_");
    const filename = `${safeBaseName || "logista_excel"}.xlsx`;

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