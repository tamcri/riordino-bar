import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f-]{36}$/i.test(String(v).trim());
}

export async function GET(
  _req: Request,
  context: { params: { id: string } }
) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può accedere" },
      { status: 401 }
    );
  }

  try {
    const id = String(context.params?.id ?? "").trim();

    if (!isUuid(id)) {
      return NextResponse.json(
        { ok: false, error: "ID inventario non valido" },
        { status: 400 }
      );
    }

    const { data: header, error: headerErr } = await supabaseAdmin
      .from("warehouse_inventory_headers")
      .select(
        `
        id,
        pv_id,
        deposit_id,
        inventory_date,
        operatore,
        notes,
        created_by_username,
        created_at,
        updated_at
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (headerErr) {
      return NextResponse.json({ ok: false, error: headerErr.message }, { status: 500 });
    }

    if (!header) {
      return NextResponse.json(
        { ok: false, error: "Inventario non trovato" },
        { status: 404 }
      );
    }

    const { data: rowsData, error: rowsErr } = await supabaseAdmin
      .from("warehouse_inventory_rows")
      .select(
        `
        id,
        header_id,
        warehouse_item_id,
        qty,
        qty_ml,
        qty_gr,
        stock_qty_before,
        difference_qty,
        created_at,
        warehouse_items (
          code,
          description,
          um
        )
      `
      )
      .eq("header_id", id)
      .order("created_at", { ascending: true });

    if (rowsErr) {
      return NextResponse.json({ ok: false, error: rowsErr.message }, { status: 500 });
    }

    const rows = (Array.isArray(rowsData) ? rowsData : []).map((row: any) => {
      const qty = Number(row?.qty ?? 0) || 0;
      const stockQtyBefore = Number(row?.stock_qty_before ?? 0) || 0;
      const differenceQty = Number(row?.difference_qty ?? 0) || 0;

      return {
        id: row.id,
        header_id: row.header_id,
        warehouse_item_id: row.warehouse_item_id,
        code: row.warehouse_items?.code ?? "",
        description: row.warehouse_items?.description ?? "",
        um: row.warehouse_items?.um ?? null,
        qty,
        qty_ml: row?.qty_ml ?? null,
        qty_gr: row?.qty_gr ?? null,
        stock_qty_before: stockQtyBefore,
        difference_qty: differenceQty,
        shortage_qty: differenceQty < 0 ? Math.abs(differenceQty) : 0,
        excess_qty: differenceQty > 0 ? differenceQty : 0,
        created_at: row.created_at,
      };
    });

    return NextResponse.json({
      ok: true,
      header: {
        id: header.id,
        pv_id: header.pv_id,
        deposit_id: header.deposit_id,
        inventory_date: header.inventory_date,
        operatore: header.operatore ?? null,
        notes: header.notes ?? null,
        created_by_username: header.created_by_username ?? null,
        created_at: header.created_at,
        updated_at: header.updated_at,
      },
      rows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}