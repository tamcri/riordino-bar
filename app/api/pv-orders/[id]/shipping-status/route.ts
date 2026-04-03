import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isPvOrderShippingStatus, isUuid } from "@/lib/pv-orders";

export const runtime = "nodejs";

type RouteContext = {
  params: {
    id: string;
  };
};

type Body = {
  shipping_status?: string;
};

type ShippingStatus = "NON_SPEDITO" | "PARZIALE" | "SPEDITO";
type RowStatus = "DA_ORDINARE" | "EVASO";

type OrderRow = {
  id: string;
  order_id: string;
  warehouse_item_id: string | null;
  qty: number;
  row_status: RowStatus;
  warehouse_stock_deducted: boolean;
};

export async function POST(req: Request, context: RouteContext) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const orderId = String(context.params?.id ?? "").trim();
    if (!isUuid(orderId)) {
      return NextResponse.json({ ok: false, error: "ID ordine non valido" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });
    }

    const shipping_status = String(body.shipping_status ?? "").trim().toUpperCase() as ShippingStatus;
    if (!isPvOrderShippingStatus(shipping_status)) {
      return NextResponse.json(
        { ok: false, error: "Stato spedizione non valido" },
        { status: 400 }
      );
    }

    const { data: header, error: headerError } = await supabaseAdmin
      .from("pv_order_headers")
      .select("id, shipping_status")
      .eq("id", orderId)
      .maybeSingle();

    if (headerError) {
      return NextResponse.json({ ok: false, error: headerError.message }, { status: 500 });
    }

    if (!header) {
      return NextResponse.json({ ok: false, error: "Ordine non trovato" }, { status: 404 });
    }

    // Caso semplice: NON_SPEDITO non scarica nulla, aggiorna solo stato header
    if (shipping_status === "NON_SPEDITO") {
      const { error: updateHeaderError } = await supabaseAdmin
        .from("pv_order_headers")
        .update({
          shipping_status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (updateHeaderError) {
        return NextResponse.json({ ok: false, error: updateHeaderError.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        order_id: orderId,
        shipping_status,
        deducted_rows: 0,
        affected_items: 0,
      });
    }

    // Per PARZIALE e SPEDITO devo scaricare eventuali righe evase non ancora scaricate
    const { data: orderRowsData, error: orderRowsError } = await supabaseAdmin
      .from("pv_order_rows")
      .select("id, order_id, warehouse_item_id, qty, row_status, warehouse_stock_deducted")
      .eq("order_id", orderId);

    if (orderRowsError) {
      return NextResponse.json({ ok: false, error: orderRowsError.message }, { status: 500 });
    }

    const orderRows = (Array.isArray(orderRowsData) ? orderRowsData : []) as OrderRow[];

    const rowsToDeduct = orderRows.filter(
      (row) =>
        row.row_status === "EVASO" &&
        row.warehouse_stock_deducted !== true
    );

    // Recupero PV centrale
    const { data: centralPv, error: centralPvErr } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("is_central_warehouse", true)
      .maybeSingle();

    if (centralPvErr) {
      return NextResponse.json({ ok: false, error: centralPvErr.message }, { status: 500 });
    }

    if (!centralPv) {
      return NextResponse.json(
        { ok: false, error: "Magazzino centrale non configurato" },
        { status: 400 }
      );
    }

    // Recupero deposito centrale
    const { data: centralDeposit, error: centralDepositErr } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("pv_id", centralPv.id)
      .eq("code", "DEP-CENTRALE")
      .maybeSingle();

    if (centralDepositErr) {
      return NextResponse.json({ ok: false, error: centralDepositErr.message }, { status: 500 });
    }

    if (!centralDeposit) {
      return NextResponse.json(
        { ok: false, error: "Deposito centrale non trovato" },
        { status: 400 }
      );
    }

    // Se ci sono righe da scaricare, validazioni + scarico
    let deductedRows = 0;
    let affectedItems = 0;

    if (rowsToDeduct.length > 0) {
      const invalidWarehouseRows = rowsToDeduct.filter(
        (row) => !row.warehouse_item_id || !isUuid(row.warehouse_item_id)
      );

      if (invalidWarehouseRows.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Una o più righe EVASE non hanno warehouse_item_id valido.",
          },
          { status: 400 }
        );
      }

      const qtyByWarehouseItemId = new Map<string, number>();

      for (const row of rowsToDeduct) {
        const warehouseItemId = String(row.warehouse_item_id).trim();
        const qty = Number(row.qty ?? 0);

        if (!Number.isFinite(qty) || qty <= 0) {
          continue;
        }

        qtyByWarehouseItemId.set(
          warehouseItemId,
          (qtyByWarehouseItemId.get(warehouseItemId) ?? 0) + qty
        );
      }

      const warehouseItemIds = Array.from(qtyByWarehouseItemId.keys());

      if (warehouseItemIds.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Le righe EVASE non ancora scaricate non hanno quantità valide.",
          },
          { status: 400 }
        );
      }

      const { data: depositItemsData, error: depositItemsError } = await supabaseAdmin
        .from("warehouse_deposit_items")
        .select("id, warehouse_item_id, stock_qty, is_active")
        .eq("deposit_id", centralDeposit.id)
        .eq("is_active", true)
        .in("warehouse_item_id", warehouseItemIds);

      if (depositItemsError) {
        return NextResponse.json({ ok: false, error: depositItemsError.message }, { status: 500 });
      }

      const depositItems = Array.isArray(depositItemsData) ? depositItemsData : [];
      const depositByWarehouseItemId = new Map<string, any>();

      for (const item of depositItems) {
        const warehouseItemId = String(item?.warehouse_item_id ?? "").trim();
        if (!warehouseItemId) continue;
        depositByWarehouseItemId.set(warehouseItemId, item);
      }

      const missingDepositItems = warehouseItemIds.filter(
        (warehouseItemId) => !depositByWarehouseItemId.has(warehouseItemId)
      );

      if (missingDepositItems.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Uno o più articoli evasi non risultano presenti nel deposito centrale attivo.",
          },
          { status: 400 }
        );
      }

      // Validazione stock prima di aggiornare qualsiasi riga
      for (const [warehouseItemId, qtyToSubtract] of qtyByWarehouseItemId.entries()) {
        const depositItem = depositByWarehouseItemId.get(warehouseItemId);
        const currentStock = Number(depositItem?.stock_qty ?? 0);

        if (!Number.isFinite(currentStock)) {
          return NextResponse.json(
            {
              ok: false,
              error: "Stock deposito non valido per uno o più articoli.",
            },
            { status: 500 }
          );
        }

        if (currentStock < qtyToSubtract) {
          return NextResponse.json(
            {
              ok: false,
              error: "Stock insufficiente nel Deposito Centrale per evadere l’ordine.",
            },
            { status: 400 }
          );
        }
      }

      const nowIso = new Date().toISOString();

      // Scarico stock aggregato per articolo
      for (const [warehouseItemId, qtyToSubtract] of qtyByWarehouseItemId.entries()) {
        const depositItem = depositByWarehouseItemId.get(warehouseItemId);
        const currentStock = Number(depositItem?.stock_qty ?? 0);
        const nextStock = Number((currentStock - qtyToSubtract).toFixed(3));

        const { error: updateStockError } = await supabaseAdmin
          .from("warehouse_deposit_items")
          .update({
            stock_qty: nextStock,
            updated_at: nowIso,
          })
          .eq("id", depositItem.id);

        if (updateStockError) {
          return NextResponse.json(
            {
              ok: false,
              error: updateStockError.message,
            },
            { status: 500 }
          );
        }
      }

      // Marco le righe appena scaricate
      const rowIdsToDeduct = rowsToDeduct.map((row) => row.id);
      const { error: updateRowsError } = await supabaseAdmin
        .from("pv_order_rows")
        .update({
          warehouse_stock_deducted: true,
          updated_at: nowIso,
        })
        .in("id", rowIdsToDeduct);

      if (updateRowsError) {
        return NextResponse.json(
          {
            ok: false,
            error: updateRowsError.message,
          },
          { status: 500 }
        );
      }

      deductedRows = rowsToDeduct.length;
      affectedItems = warehouseItemIds.length;
    }

    // Aggiorno stato spedizione header anche se non c'erano nuove righe da scaricare
    const { error: updateHeaderError } = await supabaseAdmin
      .from("pv_order_headers")
      .update({
        shipping_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateHeaderError) {
      return NextResponse.json({ ok: false, error: updateHeaderError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      shipping_status,
      deducted_rows: deductedRows,
      affected_items: affectedItems,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}