import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type PreviewBodyRow = {
  warehouse_item_id?: string;
  counted_qty?: number | string | null;
};

type PreviewBody = {
  inventory_date?: string;
  operatore?: string;
  rows?: PreviewBodyRow[];
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f-]{36}$/i.test(String(v).trim());
}

function isIsoDate(v: string | null | undefined) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
}

function toQty(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;

  const normalized = String(v).replace(",", ".").trim();
  if (!normalized) return null;

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;

  return Number(n.toFixed(3));
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può accedere" },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json().catch(() => null)) as PreviewBody | null;

    if (!body) {
      return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });
    }

    const inventoryDate = String(body.inventory_date ?? "").trim();
    const operatore = String(body.operatore ?? "").trim();
    const inputRows = Array.isArray(body.rows) ? body.rows : [];

    if (!isIsoDate(inventoryDate)) {
      return NextResponse.json(
        { ok: false, error: "inventory_date non valida (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    if (!operatore) {
      return NextResponse.json({ ok: false, error: "Operatore obbligatorio" }, { status: 400 });
    }

    if (inputRows.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessuna riga da verificare" }, { status: 400 });
    }

    const normalizedRows = inputRows
      .map((row) => {
        const warehouse_item_id = String(row?.warehouse_item_id ?? "").trim();
        const counted_qty = toQty(row?.counted_qty);

        return {
          warehouse_item_id,
          counted_qty,
        };
      })
      .filter((row) => row.warehouse_item_id && row.counted_qty !== null);

    if (normalizedRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Inserisci almeno una quantità contata valida" },
        { status: 400 }
      );
    }

    for (const row of normalizedRows) {
      if (!isUuid(row.warehouse_item_id)) {
        return NextResponse.json(
          { ok: false, error: "warehouse_item_id non valido" },
          { status: 400 }
        );
      }

      if (row.counted_qty === null || row.counted_qty < 0) {
        return NextResponse.json(
          { ok: false, error: "counted_qty non valida" },
          { status: 400 }
        );
      }
    }

    // 1) PV centrale
    const { data: pv, error: pvErr } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("is_central_warehouse", true)
      .maybeSingle();

    if (pvErr) {
      return NextResponse.json({ ok: false, error: pvErr.message }, { status: 500 });
    }

    if (!pv) {
      return NextResponse.json(
        { ok: false, error: "Magazzino centrale non configurato" },
        { status: 400 }
      );
    }

    // 2) Deposito centrale
    const { data: deposit, error: depErr } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("pv_id", pv.id)
      .eq("code", "DEP-CENTRALE")
      .maybeSingle();

    if (depErr) {
      return NextResponse.json({ ok: false, error: depErr.message }, { status: 500 });
    }

    if (!deposit) {
      return NextResponse.json(
        { ok: false, error: "Deposito centrale non trovato" },
        { status: 400 }
      );
    }

    const warehouseItemIds = Array.from(
      new Set(normalizedRows.map((row) => row.warehouse_item_id))
    );

    const { data, error } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .select(
        `
        id,
        warehouse_item_id,
        stock_qty,
        is_active,
        warehouse_items (
          code,
          description,
          um
        )
      `
      )
      .eq("deposit_id", deposit.id)
      .eq("is_active", true)
      .in("warehouse_item_id", warehouseItemIds);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const depositRows = Array.isArray(data) ? data : [];
    const depositByWarehouseItemId = new Map<string, any>();

    for (const row of depositRows) {
      const warehouseItemId = String(row?.warehouse_item_id ?? "").trim();
      if (!warehouseItemId) continue;
      depositByWarehouseItemId.set(warehouseItemId, row);
    }

    const previewRows = normalizedRows.map((row) => {
      const depositRow = depositByWarehouseItemId.get(row.warehouse_item_id);

      if (!depositRow) {
        return {
          warehouse_item_id: row.warehouse_item_id,
          code: "",
          description: "",
          um: null,
          stock_qty_before: 0,
          counted_qty: row.counted_qty ?? 0,
          difference_qty: row.counted_qty ?? 0,
          shortage_qty: 0,
          excess_qty: row.counted_qty ?? 0,
          _missing_deposit_row: true,
        };
      }

      const stockQtyBefore = Number(depositRow.stock_qty ?? 0) || 0;
      const countedQty = Number(row.counted_qty ?? 0) || 0;
      const differenceQty = Number((countedQty - stockQtyBefore).toFixed(3));

      return {
        warehouse_item_id: row.warehouse_item_id,
        code: depositRow.warehouse_items?.code ?? "",
        description: depositRow.warehouse_items?.description ?? "",
        um: depositRow.warehouse_items?.um ?? null,
        stock_qty_before: stockQtyBefore,
        counted_qty: countedQty,
        difference_qty: differenceQty,
        shortage_qty: differenceQty < 0 ? Math.abs(differenceQty) : 0,
        excess_qty: differenceQty > 0 ? differenceQty : 0,
      };
    });

    const missingRows = previewRows.filter((row) => (row as any)._missing_deposit_row);
    if (missingRows.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Uno o più articoli non risultano presenti nel deposito centrale attivo",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      rows: previewRows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}