import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid, summarizePvOrderRows } from "@/lib/pv-orders";

export const runtime = "nodejs";

type RouteContext = {
  params: {
    id: string;
  };
};

type PdfRow = {
  item_code: string;
  item_description: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
  row_status: string;
};

function formatDateIT(value: string) {
  if (!value) return "—";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function shippingStatusLabel(status: string) {
  switch (String(status || "").trim().toUpperCase()) {
    case "SPEDITO":
      return "Spedito";
    case "PARZIALE":
      return "Parziale";
    default:
      return "Non spedito";
  }
}

function rowStatusLabel(status: string) {
  return String(status || "").trim().toUpperCase() === "EVASO" ? "Evaso" : "Da ordinare";
}

function orderStatusLabel(status: string) {
  return String(status || "").trim().toUpperCase() === "COMPLETO"
    ? "Completo"
    : "Da completare";
}

function safeFileName(value: string) {
  return String(value || "ordine")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80);
}

function ellipsize(text: string, maxLen: number) {
  const s = String(text || "");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

function drawRect(
  page: PDFPage,
  x: number,
  yTop: number,
  w: number,
  h: number,
  fill?: [number, number, number]
) {
  page.drawRectangle({
    x,
    y: yTop - h,
    width: w,
    height: h,
    borderWidth: 0.6,
    borderColor: rgb(0.82, 0.85, 0.88),
    color: fill ? rgb(fill[0], fill[1], fill[2]) : undefined,
  });
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const raw = String(text || "");
  if (!raw) return "";
  if (font.widthOfTextAtSize(raw, size) <= maxWidth) return raw;

  let out = raw;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function drawTextInCell(args: {
  page: PDFPage;
  text: string;
  x: number;
  yTop: number;
  w: number;
  h: number;
  font: PDFFont;
  size: number;
  color?: [number, number, number];
  align?: "left" | "center" | "right";
  paddingX?: number;
}) {
  const {
    page,
    text,
    x,
    yTop,
    w,
    h,
    font,
    size,
    color = [0.07, 0.09, 0.12],
    align = "left",
    paddingX = 4,
  } = args;

  const available = Math.max(0, w - paddingX * 2);
  const fitted = fitText(text, font, size, available);
  const textWidth = font.widthOfTextAtSize(fitted, size);

  let tx = x + paddingX;
  if (align === "center") tx = x + (w - textWidth) / 2;
  if (align === "right") tx = x + w - paddingX - textWidth;

  const ty = yTop - h / 2 - size / 2 + 4;

  page.drawText(fitted, {
    x: tx,
    y: ty,
    size,
    font,
    color: rgb(color[0], color[1], color[2]),
  });
}

function norm(v: unknown) {
  return String(v ?? "").trim();
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const orderId = String(context.params?.id ?? "").trim();
    if (!isUuid(orderId)) {
      return NextResponse.json({ ok: false, error: "ID ordine non valido" }, { status: 400 });
    }

    const { data: header, error: headerError } = await supabaseAdmin
      .from("pv_order_headers")
      .select(`
        id,
        pv_id,
        order_date,
        operatore,
        created_by_username,
        shipping_status,
        created_at,
        updated_at,
        pvs:pvs(code, name)
      `)
      .eq("id", orderId)
      .maybeSingle();

    if (headerError) {
      return NextResponse.json({ ok: false, error: headerError.message }, { status: 500 });
    }

    if (!header) {
      return NextResponse.json({ ok: false, error: "Ordine non trovato" }, { status: 404 });
    }

    const { data: rowsData, error: rowsError } = await supabaseAdmin
      .from("pv_order_rows")
      .select(`
        id,
        order_id,
        item_id,
        warehouse_item_id,
        warehouse_item_code,
        warehouse_item_description,
        warehouse_item_um,
        qty,
        qty_ml,
        qty_gr,
        row_status,
        items:items(code, description)
      `)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (rowsError) {
      return NextResponse.json({ ok: false, error: rowsError.message }, { status: 500 });
    }

    const rows: PdfRow[] = (Array.isArray(rowsData) ? rowsData : []).map((row: any) => {
      const isWarehouse = !!row?.warehouse_item_id;

      return {
        item_code: isWarehouse
          ? String(row?.warehouse_item_code ?? "")
          : String(row?.items?.code ?? ""),
        item_description: isWarehouse
          ? String(row?.warehouse_item_description ?? "")
          : String(row?.items?.description ?? ""),
        qty: Number(row?.qty ?? 0) || 0,
        qty_ml: Number(row?.qty_ml ?? 0) || 0,
        qty_gr: Number(row?.qty_gr ?? 0) || 0,
        row_status: String(row?.row_status ?? "DA_ORDINARE"),
      };
    });

    const summary = summarizePvOrderRows(rows.map((r) => ({ row_status: r.row_status })));

    const pdf = await PDFDocument.create();
    const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // A4 verticale
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 24;
    const usableWidth = pageWidth - margin * 2;
    const headerHeight = 22;
    const rowHeight = 20;

    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    function drawPageHeader() {
      page.drawText("Ordine PV", {
        x: margin,
        y,
        size: 18,
        font: fontBold,
        color: rgb(0.06, 0.09, 0.13),
      });

      y -= 24;

      const pvLabel = `${String((header as any)?.pvs?.code ?? "")}${
        (header as any)?.pvs?.name ? ` — ${String((header as any).pvs.name)}` : ""
      }`;

      const infoLines = [
        `PV: ${pvLabel || "—"}`,
        `Operatore: ${String((header as any)?.operatore ?? "") || "—"}`,
        `Data ordine: ${formatDateIT(String((header as any)?.order_date ?? ""))}`,
        `Stato ordine: ${orderStatusLabel(summary.order_status)}`,
        `Stato spedizione: ${shippingStatusLabel(String((header as any)?.shipping_status ?? ""))}`,
      ];

      for (const line of infoLines) {
        page.drawText(line, {
          x: margin,
          y,
          size: 10,
          font: fontRegular,
          color: rgb(0.25, 0.29, 0.34),
        });
        y -= 14;
      }

      y -= 8;

      const kpiBoxWidth = (usableWidth - 16) / 3;
      const kpiY = y;

      const kpis = [
        ["Righe ordine", String(summary.total_rows)],
        ["Righe evase", String(summary.evaded_rows)],
        ["Righe da ordinare", String(summary.pending_rows)],
      ];

      for (let i = 0; i < kpis.length; i++) {
        const [label, value] = kpis[i];
        const x = margin + i * (kpiBoxWidth + 8);

        page.drawRectangle({
          x,
          y: kpiY - 36,
          width: kpiBoxWidth,
          height: 36,
          borderWidth: 0.8,
          borderColor: rgb(0.85, 0.88, 0.91),
          color: rgb(0.97, 0.98, 0.99),
        });

        page.drawText(label, {
          x: x + 8,
          y: kpiY - 12,
          size: 9,
          font: fontRegular,
          color: rgb(0.39, 0.45, 0.52),
        });

        page.drawText(value, {
          x: x + 8,
          y: kpiY - 26,
          size: 13,
          font: fontBold,
          color: rgb(0.06, 0.09, 0.13),
        });
      }

      y = kpiY - 52;

      const columns = [
        { key: "code", label: "Codice", width: 78, align: "left" as const },
        { key: "description", label: "Descrizione", width: 218, align: "left" as const },
        { key: "qty", label: "Pz", width: 44, align: "center" as const },
        { key: "qty_ml", label: "ML", width: 44, align: "center" as const },
        { key: "qty_gr", label: "GR", width: 44, align: "center" as const },
        { key: "status", label: "Stato riga", width: 119, align: "center" as const },
      ];

      let x = margin;
      for (const col of columns) {
        drawRect(page, x, y, col.width, headerHeight, [0.94, 0.96, 0.98]);
        drawTextInCell({
          page,
          text: col.label,
          x,
          yTop: y,
          w: col.width,
          h: headerHeight,
          font: fontBold,
          size: 9,
          align: col.align,
          color: [0.07, 0.09, 0.12],
        });
        x += col.width;
      }

      y -= headerHeight;

      return columns;
    }

    let columns = drawPageHeader();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (y - rowHeight < margin + 24) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
        columns = drawPageHeader();
      }

      const fill: [number, number, number] | undefined =
        i % 2 === 0 ? [1, 1, 1] : [0.985, 0.99, 0.995];

      const values = [
        ellipsize(row.item_code || "—", 22),
        ellipsize(row.item_description || "—", 48),
        String(row.qty || 0),
        String(row.qty_ml || 0),
        String(row.qty_gr || 0),
        rowStatusLabel(row.row_status),
      ];

      let x = margin;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        drawRect(page, x, y, col.width, rowHeight, fill);
        drawTextInCell({
          page,
          text: values[c],
          x,
          yTop: y,
          w: col.width,
          h: rowHeight,
          font: fontRegular,
          size: 8.5,
          align: col.align,
          color: [0.16, 0.18, 0.22],
        });
        x += col.width;
      }

      y -= rowHeight;
    }

    const pages = pdf.getPages();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      p.drawText(`Pagina ${i + 1} / ${pages.length}`, {
        x: pageWidth - margin - 70,
        y: 14,
        size: 8,
        font: fontRegular,
        color: rgb(0.45, 0.5, 0.56),
      });
    }

    const bytes = await pdf.save();

    const pvCode = String((header as any)?.pvs?.code ?? "PV");
    const dateLabel = String((header as any)?.order_date ?? "");
    const filename = `${safeFileName(pvCode)}_ordine_${safeFileName(dateLabel || orderId)}.pdf`;

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}