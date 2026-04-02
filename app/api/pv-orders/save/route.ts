import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";
import { isDateOnly, sanitizePvOrderRows } from "@/lib/pv-orders";

export const runtime = "nodejs";

type Body = {
  order_date?: string;
  operatore?: string;
  rows?: unknown[];
};

function clampInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function norm(v: unknown) {
  return String(v ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });
    }

    const order_date = norm(body.order_date);
    if (!isDateOnly(order_date)) {
      return NextResponse.json({ ok: false, error: "Data ordine non valida" }, { status: 400 });
    }

    const operatore = norm(body.operatore);
    if (!operatore) {
      return NextResponse.json({ ok: false, error: "Operatore mancante" }, { status: 400 });
    }
    if (operatore.length > 80) {
      return NextResponse.json(
        { ok: false, error: "Operatore troppo lungo (max 80)" },
        { status: 400 }
      );
    }

    const cleanRows = sanitizePvOrderRows(Array.isArray(body.rows) ? body.rows : []);
    if (cleanRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Inserisci almeno una riga con quantità." },
        { status: 400 }
      );
    }

    const pvLookup = await getPvIdForSession(session);
    const pv_id = pvLookup.pv_id;
    if (!pv_id) {
      return NextResponse.json(
        { ok: false, error: "Utente PV senza pv_id assegnato" },
        { status: 400 }
      );
    }

    const { data: header, error: headerError } = await supabaseAdmin
      .from("pv_order_headers")
      .insert({
        pv_id,
        order_date,
        operatore,
        created_by_username: session.username ?? null,
        shipping_status: "NON_SPEDITO",
      })
      .select("id")
      .single();

    if (headerError) {
      return NextResponse.json({ ok: false, error: headerError.message }, { status: 500 });
    }

    const order_id = norm((header as any)?.id);
    if (!order_id) {
      return NextResponse.json(
        { ok: false, error: "Ordine salvato ma order_id mancante" },
        { status: 500 }
      );
    }

    // 1) Trova il PV magazzino centrale
    const { data: centralPv, error: centralPvError } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("is_central_warehouse", true)
      .maybeSingle();

    if (centralPvError) {
      return NextResponse.json({ ok: false, error: centralPvError.message }, { status: 500 });
    }

    if (!centralPv) {
      return NextResponse.json(
        { ok: false, error: "Magazzino centrale non configurato" },
        { status: 400 }
      );
    }

    // 2) Trova il deposito centrale
    const { data: centralDeposit, error: centralDepositError } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("pv_id", (centralPv as any).id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (centralDepositError) {
      return NextResponse.json({ ok: false, error: centralDepositError.message }, { status: 500 });
    }

    if (!centralDeposit) {
      return NextResponse.json(
        { ok: false, error: "Deposito magazzino non trovato" },
        { status: 400 }
      );
    }

    // 3) Gli item_id che arrivano dal client ora sono id di warehouse_items
    const warehouseItemIds = Array.from(
      new Set(cleanRows.map((row) => norm((row as any).item_id)).filter(Boolean))
    );

    if (warehouseItemIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessun articolo valido da salvare" },
        { status: 400 }
      );
    }

    // 4) Valida che gli articoli esistano davvero nel deposito centrale
    const { data: centralRows, error: centralRowsError } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .select(
        `
        warehouse_item_id,
        is_active,
        warehouse_items!inner (
          id,
          code,
          description,
          um,
          is_active
        )
        `
      )
      .eq("deposit_id", (centralDeposit as any).id)
      .eq("is_active", true)
      .in("warehouse_item_id", warehouseItemIds);

    if (centralRowsError) {
      return NextResponse.json({ ok: false, error: centralRowsError.message }, { status: 500 });
    }

    const warehouseMap = new Map<
      string,
      {
        id: string;
        code: string;
        description: string;
        um: string | null;
      }
    >();

    for (const row of Array.isArray(centralRows) ? centralRows : []) {
      const it = (row as any)?.warehouse_items;
      const id = norm((row as any)?.warehouse_item_id || it?.id);
      if (!id) continue;
      if (!it) continue;
      if ((it as any)?.is_active === false) continue;

      warehouseMap.set(id, {
        id,
        code: norm((it as any)?.code),
        description: norm((it as any)?.description),
        um: norm((it as any)?.um) || null,
      });
    }

    const payload = cleanRows
      .map((row) => {
        const warehouse_item_id = norm((row as any).item_id);
        const qty = clampInt((row as any).qty);

        if (!warehouse_item_id || qty <= 0) return null;

        const meta = warehouseMap.get(warehouse_item_id);
        if (!meta) return null;

        return {
          order_id,
          item_id: null,
          warehouse_item_id: meta.id,
          warehouse_item_code: meta.code,
          warehouse_item_description: meta.description,
          warehouse_item_um: meta.um,
          qty,
          qty_ml: 0,
          qty_gr: 0,
          row_status: "DA_ORDINARE",
        };
      })
      .filter(Boolean);

    if (payload.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessun articolo valido trovato nel deposito centrale" },
        { status: 400 }
      );
    }

    const { error: rowsError } = await supabaseAdmin
      .from("pv_order_rows")
      .insert(payload);

    if (rowsError) {
      return NextResponse.json({ ok: false, error: rowsError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      order_id,
      warning: pvLookup.warning ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}