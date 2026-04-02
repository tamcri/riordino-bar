import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";
import { isUuid, summarizePvOrderRows } from "@/lib/pv-orders";
import type { PvOrderDetail, PvOrderDetailRow } from "@/types/pv-orders";

export const runtime = "nodejs";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const id = String(context.params?.id ?? "").trim();
    if (!isUuid(id)) {
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
      .eq("id", id)
      .maybeSingle();

    if (headerError) {
      return NextResponse.json({ ok: false, error: headerError.message }, { status: 500 });
    }

    if (!header) {
      return NextResponse.json({ ok: false, error: "Ordine non trovato" }, { status: 404 });
    }

    if (session.role === "punto_vendita") {
      const r = await getPvIdForSession(session);
      const pv_id = r.pv_id;
      if (!pv_id) {
        return NextResponse.json({ ok: false, error: "Utente PV senza pv_id" }, { status: 400 });
      }
      if (String((header as any).pv_id) !== String(pv_id)) {
        return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
      }
    }

    const { data: rowsData, error: rowsError } = await supabaseAdmin
      .from("pv_order_rows")
      .select(`
        id,
        order_id,
        item_id,
        qty,
        qty_ml,
        qty_gr,
        row_status,
        created_at,
        updated_at,
        items:items(code, description),
        warehouse_item_id,
        warehouse_item_code,
        warehouse_item_description,
        warehouse_item_um
      `)
      .eq("order_id", id)
      .order("created_at", { ascending: true });

    if (rowsError) {
      return NextResponse.json({ ok: false, error: rowsError.message }, { status: 500 });
    }

    const rows: PvOrderDetailRow[] = (Array.isArray(rowsData) ? rowsData : []).map((row: any) => {
  const isWarehouse = !!row.warehouse_item_id;

  return {
    id: String(row.id),
    order_id: String(row.order_id),
    item_id: String(row.item_id),

    item_code: isWarehouse
      ? String(row.warehouse_item_code ?? "")
      : String(row?.items?.code ?? ""),

    item_description: isWarehouse
      ? String(row.warehouse_item_description ?? "")
      : String(row?.items?.description ?? ""),

    qty: Number(row.qty ?? 0) || 0,
    qty_ml: Number(row.qty_ml ?? 0) || 0,
    qty_gr: Number(row.qty_gr ?? 0) || 0,
    row_status: String(row.row_status ?? "DA_ORDINARE") as any,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
});

    const summary = summarizePvOrderRows(rows);

    const payload: PvOrderDetail = {
      header: {
        id: String((header as any).id),
        pv_id: String((header as any).pv_id),
        order_date: String((header as any).order_date),
        operatore: String((header as any).operatore ?? ""),
        created_by_username: (header as any).created_by_username
          ? String((header as any).created_by_username)
          : null,
        shipping_status: String((header as any).shipping_status) as any,
        created_at: String((header as any).created_at),
        updated_at: String((header as any).updated_at),
        pv_code: String((header as any)?.pvs?.code ?? ""),
        pv_name: String((header as any)?.pvs?.name ?? ""),
        order_status: summary.order_status,
        total_rows: summary.total_rows,
        pending_rows: summary.pending_rows,
        evaded_rows: summary.evaded_rows,
      },
      rows,
    };

    return NextResponse.json({ ok: true, ...payload });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}