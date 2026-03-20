// app/api/admin/timeline/pivot-pdf/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function isIsoDate(v: string | null) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function isoToIt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

type InvRow = {
  item_id: string;
  inventory_date: string;
  category_id: string | null;
  qty: number | null;
  qty_gr: number | null;
  qty_ml: number | null;
};

type ItemMeta = {
  id: string;
  code: string;
  description: string;
  category_id: string | null;
};

type PivotItemRow = {
  code: string;
  description: string;
  unit: string;
  values: number[];
  deltas: number[];
};

function pickQtyAndUnit(r: { qty: number; qty_gr: number; qty_ml: number }) {
  const ml = Number(r.qty_ml || 0);
  const gr = Number(r.qty_gr || 0);
  const pz = Number(r.qty || 0);

  if (ml > 0) return { qty: ml, unit: "ML" };
  if (gr > 0) return { qty: gr, unit: "GR" };
  return { qty: pz, unit: "PZ" };
}

function matchCategory(requested: string, invCategoryId: string | null, itemCategoryId: string | null) {
  if (!requested) return true;
  if (requested === "__NULL__") return invCategoryId === null;
  if (isUuid(requested)) return invCategoryId === requested || itemCategoryId === requested;
  return true;
}

function formatNum(value: number) {
  const n = Number(value || 0);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, "");
}

function ellipsize(text: string, maxLen: number) {
  const s = String(text || "");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

function buildSectionPivotRows(
  rows: InvRow[],
  itemsMap: Map<string, ItemMeta>
): { dates: string[]; pivotRows: PivotItemRow[] } {
  const rowsWithItem = rows
    .map((r) => {
      const it = itemsMap.get(String(r.item_id || "").trim()) || null;
      return { r, it };
    })
    .filter((x) => x.it && (x.it.code || x.it.description));

  const dates = Array.from(new Set(rowsWithItem.map((x) => x.r.inventory_date))).sort();

  const map: Record<
    string,
    { code: string; description: string; unit: string; byDate: Record<string, number> }
  > = {};

  for (const x of rowsWithItem) {
    const key = x.it!.id;
    const picked = pickQtyAndUnit({
      qty: Number(x.r.qty || 0),
      qty_gr: Number(x.r.qty_gr || 0),
      qty_ml: Number(x.r.qty_ml || 0),
    });

    if (!map[key]) {
      map[key] = {
        code: x.it!.code,
        description: x.it!.description,
        unit: picked.unit,
        byDate: {},
      };
    }

    map[key].byDate[x.r.inventory_date] = picked.qty;
  }

  const keys = Object.keys(map).sort((a, b) => {
    const ac = map[a].code || "";
    const bc = map[b].code || "";
    return ac.localeCompare(bc, "it", { numeric: true, sensitivity: "base" });
  });

  const pivotRows: PivotItemRow[] = keys.map((k) => {
    const row = map[k];
    const values = dates.map((d) => Number(row.byDate[d] ?? 0));
    const deltas = values.slice(1).map((v, i) => Number(v) - Number(values[i]));

    return {
      code: row.code,
      description: row.description,
      unit: row.unit,
      values,
      deltas,
    };
  });

  return { dates, pivotRows };
}

const PAGE_W = 842; // A4 landscape
const PAGE_H = 595;
const MARGIN = 18;
const HEADER_H = 22;
const ROW_H = 18;

type ColumnDef = {
  key: string;
  label: string;
  width: number;
  align: "left" | "center" | "right";
};

function buildColumns(usableWidth: number, datesCount: number): ColumnDef[] {
  const fixedCode = 70;
  const fixedDesc = 210;
  const fixedUm = 42;
  const dynamicCount = datesCount + Math.max(0, datesCount - 1);

  let dynamicWidth = 48;
  const fixedTotal = fixedCode + fixedDesc + fixedUm;
  const remaining = usableWidth - fixedTotal;

  if (dynamicCount > 0) {
    dynamicWidth = Math.max(28, Math.floor(remaining / dynamicCount));
  }

  const cols: ColumnDef[] = [
    { key: "code", label: "Codice", width: fixedCode, align: "center" },
    { key: "description", label: "Descrizione", width: fixedDesc, align: "left" },
    { key: "unit", label: "UM", width: fixedUm, align: "center" },
  ];

  for (let i = 0; i < dynamicCount; i++) {
    cols.push({
      key: `dyn_${i}`,
      label: "",
      width: dynamicWidth,
      align: "center",
    });
  }

  return cols;
}

function drawRect(page: PDFPage, x: number, yTop: number, w: number, h: number, fill?: [number, number, number]) {
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
    align = "center",
    paddingX = 3,
  } = args;

  const available = Math.max(0, w - paddingX * 2);
  const fitted = fitText(text, font, size, available);
  const textWidth = font.widthOfTextAtSize(fitted, size);

  let tx = x + paddingX;
  if (align === "center") tx = x + (w - textWidth) / 2;
  if (align === "right") tx = x + w - paddingX - textWidth;

  const ty = yTop - h + (h - size) / 2 - 1;

  page.drawText(fitted, {
    x: tx,
    y: ty,
    size,
    font,
    color: rgb(color[0], color[1], color[2]),
  });
}

function renderSectionTable(args: {
  pdfDoc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  title: string;
  dateFrom: string;
  dateTo: string;
  dates: string[];
  rows: PivotItemRow[];
}) {
  const { pdfDoc, regular, bold, title, dateFrom, dateTo, dates, rows } = args;

  const usableWidth = PAGE_W - MARGIN * 2;
  const columns = buildColumns(usableWidth, dates.length);

  const fontSizeHeader = dates.length >= 8 ? 5.5 : dates.length >= 6 ? 6 : 7;
  const fontSizeBody = dates.length >= 8 ? 5.5 : dates.length >= 6 ? 6 : 7;
  const descMax = dates.length >= 8 ? 32 : dates.length >= 6 ? 40 : 52;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawPageHeader = () => {
    page.drawText("Timeline Giacenze (Pivot + Diff)", {
      x: MARGIN,
      y: y - 14,
      size: 14,
      font: bold,
      color: rgb(0.07, 0.09, 0.12),
    });
    y -= 18;

    page.drawText(title, {
      x: MARGIN,
      y: y - 11,
      size: 11,
      font: bold,
      color: rgb(0.07, 0.09, 0.12),
    });
    y -= 14;

    page.drawText(`Periodo: ${isoToIt(dateFrom)} - ${isoToIt(dateTo)}`, {
      x: MARGIN,
      y: y - 9,
      size: 9,
      font: regular,
      color: rgb(0.22, 0.25, 0.31),
    });
    y -= 20;
  };

  const drawTableHeader = () => {
    let x = MARGIN;

    columns.forEach((col, idx) => {
      drawRect(page, x, y, col.width, HEADER_H, [0.95, 0.96, 0.97]);

      let label = col.label;
      if (idx >= 3) {
        const dynIndex = idx - 3;
        if (dynIndex < dates.length) {
          label = isoToIt(dates[dynIndex]);
        } else {
          const deltaIndex = dynIndex - dates.length + 1;
          label = `Diff ${isoToIt(dates[deltaIndex])}`;
        }
      }

      drawTextInCell({
        page,
        text: label,
        x,
        yTop: y,
        w: col.width,
        h: HEADER_H,
        font: bold,
        size: fontSizeHeader,
        align: col.align,
      });

      x += col.width;
    });

    y -= HEADER_H;
  };

  const newPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    drawPageHeader();
    drawTableHeader();
  };

  drawPageHeader();
  drawTableHeader();

  if (rows.length === 0) {
    drawRect(page, MARGIN, y, usableWidth, ROW_H);
    drawTextInCell({
      page,
      text: "Nessun dato nel periodo selezionato",
      x: MARGIN,
      yTop: y,
      w: usableWidth,
      h: ROW_H,
      font: regular,
      size: 8,
      align: "left",
      color: [0.42, 0.45, 0.50],
      paddingX: 6,
    });
    return;
  }

  for (const row of rows) {
    if (y - ROW_H < MARGIN) {
      newPage();
    }

    let x = MARGIN;

    const baseCells = [
      { text: ellipsize(row.code || "", 18), align: "center" as const, color: [0.07, 0.09, 0.12] as [number, number, number] },
      { text: ellipsize(row.description || "", descMax), align: "left" as const, color: [0.07, 0.09, 0.12] as [number, number, number] },
      { text: row.unit || "", align: "center" as const, color: [0.07, 0.09, 0.12] as [number, number, number] },
    ];

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      drawRect(page, x, y, col.width, ROW_H);

      if (i < 3) {
        const cell = baseCells[i];
        drawTextInCell({
          page,
          text: cell.text,
          x,
          yTop: y,
          w: col.width,
          h: ROW_H,
          font: regular,
          size: fontSizeBody,
          align: cell.align,
          color: cell.color,
          paddingX: i === 1 ? 4 : 2,
        });
      } else {
        const dynIndex = i - 3;

        if (dynIndex < row.values.length) {
          drawTextInCell({
            page,
            text: formatNum(row.values[dynIndex]),
            x,
            yTop: y,
            w: col.width,
            h: ROW_H,
            font: regular,
            size: fontSizeBody,
            align: "center",
          });
        } else {
          const deltaIndex = dynIndex - row.values.length;
          const delta = row.deltas[deltaIndex];
          const color: [number, number, number] =
            delta < 0 ? [0.73, 0.11, 0.11] : delta > 0 ? [0.02, 0.47, 0.34] : [0.07, 0.09, 0.12];

          drawTextInCell({
            page,
            text: formatNum(delta),
            x,
            yTop: y,
            w: col.width,
            h: ROW_H,
            font: delta !== 0 ? bold : regular,
            size: fontSizeBody,
            align: "center",
            color,
          });
        }
      }

      x += col.width;
    }

    y -= ROW_H;
  }
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const pv_id = (url.searchParams.get("pv_id") || "").trim();
  const category_id = (url.searchParams.get("category_id") || "").trim();
  const date_from = (url.searchParams.get("date_from") || "").trim();
  const date_to = (url.searchParams.get("date_to") || "").trim();

  if (!isUuid(pv_id)) {
    return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  }

  if (!isIsoDate(date_from) || !isIsoDate(date_to)) {
    return NextResponse.json({ ok: false, error: "date non valide (YYYY-MM-DD)" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("inventories")
    .select("item_id, inventory_date, category_id, qty, qty_gr, qty_ml")
    .eq("pv_id", pv_id)
    .gte("inventory_date", date_from)
    .lte("inventory_date", date_to);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const invAll = (data || []) as InvRow[];

  const itemIds = Array.from(new Set(invAll.map((r) => String(r.item_id || "")).filter((id) => isUuid(id))));
  const itemsMap = new Map<string, ItemMeta>();

  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("items")
      .select("id, code, description, category_id")
      .in("id", itemIds);

    if (itemsErr) {
      return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
    }

    for (const it of (items || []) as any[]) {
      const id = String(it?.id ?? "").trim();
      if (!isUuid(id)) continue;

      itemsMap.set(id, {
        id,
        code: String(it?.code ?? ""),
        description: String(it?.description ?? ""),
        category_id: it?.category_id ? String(it.category_id) : null,
      });
    }
  }

  const catIds = Array.from(
    new Set(
      Array.from(itemsMap.values())
        .map((x) => x.category_id)
        .filter((x): x is string => !!x && isUuid(x))
    )
  );

  const categoriesMap = new Map<string, string>();

  if (catIds.length > 0) {
    const { data: cats, error: catsErr } = await supabaseAdmin.from("categories").select("id, name").in("id", catIds);

    if (catsErr) {
      return NextResponse.json({ ok: false, error: catsErr.message }, { status: 500 });
    }

    for (const c of (cats || []) as any[]) {
      const id = String(c?.id ?? "").trim();
      const name = String(c?.name ?? "").trim();
      if (isUuid(id) && name) categoriesMap.set(id, name);
    }
  }

  const inv = invAll.filter((r) => {
    const it = itemsMap.get(String(r.item_id || "").trim()) || null;
    return matchCategory(category_id, r.category_id ?? null, it?.category_id ?? null);
  });

  function sectionLabelForRow(r: InvRow) {
    if (category_id === "__NULL__") return "SENZA_CATEGORIA_INV";
    if (isUuid(category_id)) return categoriesMap.get(category_id) || "CATEGORIA";

    const it = itemsMap.get(String(r.item_id || "").trim()) || null;
    const itemCatId = it?.category_id ?? null;
    return itemCatId ? categoriesMap.get(itemCatId) || "CATEGORIA" : "SENZA_CATEGORIA";
  }

  const sections = new Map<string, { label: string; rows: InvRow[] }>();

  for (const r of inv) {
    const label = sectionLabelForRow(r);
    const s = sections.get(label);
    if (!s) sections.set(label, { label, rows: [r] });
    else s.rows.push(r);
  }

  const sectionList = Array.from(sections.values()).sort((a, b) => a.label.localeCompare(b.label, "it"));

  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle("Timeline Giacenze (Pivot + Diff)");
    pdfDoc.setAuthor("Riordino Bar");

    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    if (sectionList.length === 0) {
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      page.drawText("Timeline Giacenze (Pivot + Diff)", {
        x: MARGIN,
        y: PAGE_H - MARGIN - 14,
        size: 14,
        font: bold,
        color: rgb(0.07, 0.09, 0.12),
      });

      page.drawText(`Periodo: ${isoToIt(date_from)} - ${isoToIt(date_to)}`, {
        x: MARGIN,
        y: PAGE_H - MARGIN - 34,
        size: 10,
        font: regular,
        color: rgb(0.22, 0.25, 0.31),
      });

      page.drawText("Nessun dato disponibile.", {
        x: MARGIN,
        y: PAGE_H - MARGIN - 60,
        size: 10,
        font: regular,
        color: rgb(0.42, 0.45, 0.50),
      });
    } else {
      for (const section of sectionList) {
        const { dates, pivotRows } = buildSectionPivotRows(section.rows, itemsMap);

        renderSectionTable({
          pdfDoc,
          regular,
          bold,
          title: section.label,
          dateFrom: date_from,
          dateTo: date_to,
          dates,
          rows: pivotRows,
        });
      }
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="timeline_pivot_${date_from}_${date_to}.pdf"`,
        "cache-control": "no-store",
        "content-length": String(pdfBytes.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore generazione PDF pivot" },
      { status: 500 }
    );
  }
}






