// File: app/api/debug/u88-grid/route.ts
import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Rect = { x: number; y: number; width: number; height: number };

function rectToObj(r: any): Rect {
  // pdf-lib: rectangle può essere { x, y, width, height }
  // ma in alcuni casi è array; gestiamo entrambi.
  if (!r) return { x: 0, y: 0, width: 0, height: 0 };

  if (typeof r.x === "number") {
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  // fallback array [x1,y1,x2,y2]
  if (Array.isArray(r) && r.length === 4) {
    const [x1, y1, x2, y2] = r;
    return { x: Number(x1), y: Number(y1), width: Number(x2) - Number(x1), height: Number(y2) - Number(y1) };
  }

  return { x: 0, y: 0, width: 0, height: 0 };
}

export async function GET() {
  const pdfPath = path.join(process.cwd(), "lib", "pdf", "templates", "u88-grid.pdf");

  let bytes: Uint8Array;
  try {
    const buf = await fs.readFile(pdfPath);
    bytes = new Uint8Array(buf);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `File non trovato: ${pdfPath}` },
      { status: 500 }
    );
  }

  const pdfDoc = await PDFDocument.load(bytes);
  const form = pdfDoc.getForm();

  // Mappa ref pagina -> index (serve per capire su che pagina sta il widget)
  const pages = pdfDoc.getPages();
  const pageRefToIndex = new Map<string, number>();
  pages.forEach((p: any, i: number) => {
    // pdf-lib: p.ref c’è
    if (p?.ref) pageRefToIndex.set(String(p.ref), i + 1); // pages 1-based
  });

  const out: any[] = [];

  for (const f of form.getFields()) {
    const name = f.getName();
    const type = f?.constructor?.name || "UnknownField";

    // acroField/widgets (pdf-lib interno)
    const acro: any = (f as any).acroField;
    const widgets: any[] = acro?.getWidgets?.() || [];

    const widgetInfo = widgets.map((w) => {
      const rect = rectToObj(w.getRectangle?.());

      // pagina: se c’è P() la mappiamo, altrimenti null
      const pref = w.P?.(); // PDFRef o undefined
      const page = pref ? (pageRefToIndex.get(String(pref)) || null) : null;

      return {
        page,
        rect,
      };
    });

    out.push({
      name,
      type,
      widgets: widgetInfo,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      pdf: "u88-grid.pdf",
      pages: pages.length,
      fields: out.length,
      data: out,
    },
    { status: 200 }
  );
}


