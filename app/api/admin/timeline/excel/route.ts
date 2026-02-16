import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f-]{36}$/i.test(v.trim());
}

function isIsoDate(v: string | null) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function isoToIt(iso: string) {
  if (!iso) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  const pv_id = (url.searchParams.get("pv_id") || "").trim();
  const category_id = (url.searchParams.get("category_id") || "").trim();
  const item_id = (url.searchParams.get("item_id") || "").trim();
  const date_from = (url.searchParams.get("date_from") || "").trim();
  const date_to = (url.searchParams.get("date_to") || "").trim();

  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  if (!isUuid(category_id)) return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  if (!isIsoDate(date_from) || !isIsoDate(date_to))
    return NextResponse.json({ ok: false, error: "date_from/date_to non valide" }, { status: 400 });

  // Query inventari nel periodo
  let q = supabaseAdmin
    .from("inventories")
    .select(
      `
      item_id,
      inventory_date,
      qty,
      items:items(code, description, prezzo_vendita_eur)
    `
    )
    .eq("pv_id", pv_id)
    .eq("category_id", category_id)
    .gte("inventory_date", date_from)
    .lte("inventory_date", date_to);

  if (item_id && isUuid(item_id)) q = q.eq("item_id", item_id);

  // NB: ordino per data (timeline), poi per codice articolo
  q = q.order("inventory_date", { ascending: true });

  const { data, error } = await q;

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (data || []) as any[];

  // Excel
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("TIMELINE");

  ws.columns = [
    { header: "Data", key: "date", width: 14 },
    { header: "Codice", key: "code", width: 18 },
    { header: "Descrizione", key: "description", width: 45 },
    { header: "Quantità", key: "qty", width: 12 },
    { header: "Δ Quantità", key: "delta_qty", width: 12 },
    { header: "Valore €", key: "value", width: 15 },
    { header: "Δ Valore €", key: "delta_value", width: 15 },
  ];
  ws.getRow(1).font = { bold: true };

  ws.getColumn("qty").numFmt = "0";
  ws.getColumn("delta_qty").numFmt = "0";
  ws.getColumn("value").numFmt = "€ #,##0.00";
  ws.getColumn("delta_value").numFmt = "€ #,##0.00";

  // Stato per delta: ultimo qty/value per item_id
  const lastByItem = new Map<string, { qty: number; value: number }>();

  let totalQty = 0;
  let totalValue = 0;
  let totalDeltaQty = 0;
  let totalDeltaValue = 0;

  for (const r of rows) {
    const itemId = String(r.item_id || "");
    const qty = Number(r.qty || 0);
    const price = Number(r?.items?.prezzo_vendita_eur || 0);
    const value = qty * price;

    const prev = itemId ? lastByItem.get(itemId) : undefined;
    const deltaQty = prev ? qty - prev.qty : 0;
    const deltaValue = prev ? value - prev.value : 0;

    if (itemId) lastByItem.set(itemId, { qty, value });

    totalQty += qty;
    totalValue += value;

    // i delta totali hanno senso solo se c’è prev (altrimenti è “prima misura”)
    if (prev) {
      totalDeltaQty += deltaQty;
      totalDeltaValue += deltaValue;
    }

    ws.addRow({
      date: isoToIt(r.inventory_date),
      code: r?.items?.code ?? "",
      description: r?.items?.description ?? "",
      qty,
      delta_qty: prev ? deltaQty : "",
      value,
      delta_value: prev ? deltaValue : "",
    });
  }

  const totalRow = ws.addRow({
    date: "",
    code: "",
    description: "TOTALE",
    qty: totalQty,
    delta_qty: totalDeltaQty,
    value: totalValue,
    delta_value: totalDeltaValue,
  });

  totalRow.font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `timeline_giacenze_${date_from}_${date_to}.xlsx`;

  return new NextResponse(new Uint8Array(buffer as any), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}



