import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";
import {
  isDateOnly,
  isPvOrderShippingStatus,
  summarizePvOrderRows,
} from "@/lib/pv-orders";
import type { PvOrderListRow } from "@/types/pv-orders";

export const runtime = "nodejs";

function norm(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);
    const from = norm(url.searchParams.get("from"));
    const to = norm(url.searchParams.get("to"));
    const pv_id_param = norm(url.searchParams.get("pv_id"));
    const shipping_status_param = norm(url.searchParams.get("shipping_status"));

    let pv_id: string | null = null;

    if (session.role === "punto_vendita") {
      const r = await getPvIdForSession(session);
      pv_id = r.pv_id;
      if (!pv_id) {
        return NextResponse.json({ ok: false, error: "Utente PV senza pv_id" }, { status: 400 });
      }
    } else {
      pv_id = pv_id_param || null;
    }

    let q = supabaseAdmin
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
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);

    if (pv_id) q = q.eq("pv_id", pv_id);
    if (isDateOnly(from)) q = q.gte("order_date", from);
    if (isDateOnly(to)) q = q.lte("order_date", to);
    if (isPvOrderShippingStatus(shipping_status_param)) {
      q = q.eq("shipping_status", shipping_status_param);
    }

    const { data: headers, error: headersError } = await q;
    if (headersError) {
      return NextResponse.json({ ok: false, error: headersError.message }, { status: 500 });
    }

    const headerRows = Array.isArray(headers) ? headers : [];
    const headerIds = headerRows.map((h: any) => String(h.id)).filter(Boolean);

    let rowsByOrderId = new Map<string, Array<{ row_status: string | null }>>();

    if (headerIds.length > 0) {
      const { data: rowData, error: rowsError } = await supabaseAdmin
        .from("pv_order_rows")
        .select("order_id, row_status")
        .in("order_id", headerIds);

      if (rowsError) {
        return NextResponse.json({ ok: false, error: rowsError.message }, { status: 500 });
      }

      for (const row of Array.isArray(rowData) ? rowData : []) {
        const order_id = String((row as any)?.order_id ?? "");
        if (!order_id) continue;
        const list = rowsByOrderId.get(order_id) ?? [];
        list.push({ row_status: (row as any)?.row_status ?? null });
        rowsByOrderId.set(order_id, list);
      }
    }

    const rows: PvOrderListRow[] = headerRows.map((header: any) => {
      const orderRows = rowsByOrderId.get(String(header.id)) ?? [];
      const summary = summarizePvOrderRows(orderRows);

      return {
        id: String(header.id),
        pv_id: String(header.pv_id),
        order_date: String(header.order_date),
        operatore: String(header.operatore ?? ""),
        created_by_username: header.created_by_username ? String(header.created_by_username) : null,
        shipping_status: String(header.shipping_status) as any,
        created_at: String(header.created_at),
        updated_at: String(header.updated_at),
        pv_code: String(header?.pvs?.code ?? ""),
        pv_name: String(header?.pvs?.name ?? ""),
        order_status: summary.order_status,
        total_rows: summary.total_rows,
        pending_rows: summary.pending_rows,
        evaded_rows: summary.evaded_rows,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}