import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type ConfirmBodyRow = {
  warehouse_item_id?: string;
  counted_qty?: number | string | null;
};

type ConfirmBody = {
  inventory_date?: string;
  operatore?: string;
  notes?: string | null;
  rows?: ConfirmBodyRow[];
};

type NormalizedRow = {
  warehouse_item_id: string;
  counted_qty: number;
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
    const body = (await req.json().catch(() => null)) as ConfirmBody | null;

    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Body non valido" },
        { status: 400 }
      );
    }

    const inventoryDate = String(body.inventory_date ?? "").trim();
    const operatore = String(body.operatore ?? "").trim();
    const notesRaw = String(body.notes ?? "").trim();
    const notes = notesRaw || null;
    const inputRows = Array.isArray(body.rows) ? body.rows : [];

    if (!isIsoDate(inventoryDate)) {
      return NextResponse.json(
        { ok: false, error: "inventory_date non valida (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    if (!operatore) {
      return NextResponse.json(
        { ok: false, error: "Operatore obbligatorio" },
        { status: 400 }
      );
    }

    if (inputRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessuna riga da confermare" },
        { status: 400 }
      );
    }

    const normalizedRowsRaw = inputRows
      .map((row) => {
        const warehouse_item_id = String(row?.warehouse_item_id ?? "").trim();
        const counted_qty = toQty(row?.counted_qty);

        return {
          warehouse_item_id,
          counted_qty,
        };
      })
      .filter((row) => row.warehouse_item_id && row.counted_qty !== null);

    if (normalizedRowsRaw.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Inserisci almeno una quantità contata valida" },
        { status: 400 }
      );
    }

    const normalizedByItemId = new Map<string, NormalizedRow>();

    for (const row of normalizedRowsRaw) {
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

      // ultimo valore vince, così evitiamo duplicati sporchi lato client
      normalizedByItemId.set(row.warehouse_item_id, {
        warehouse_item_id: row.warehouse_item_id,
        counted_qty: row.counted_qty,
      });
    }

    const normalizedRows = Array.from(normalizedByItemId.values());

    if (normalizedRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessuna riga valida da confermare" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin.rpc("confirm_warehouse_inventory", {
      p_inventory_date: inventoryDate,
      p_operatore: operatore,
      p_notes: notes,
      p_created_by_username: session.username,
      p_rows: normalizedRows,
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message || "Errore conferma inventario",
        },
        { status: 500 }
      );
    }

    const result = data as any;

    if (!result || result.ok !== true) {
      return NextResponse.json(
        { ok: false, error: "Conferma inventario fallita" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      header_id: result.header_id,
      saved_rows: result.saved_rows,
      shortage_rows: result.shortage_rows,
      excess_rows: result.excess_rows,
      equal_rows: result.equal_rows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}