import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Row = {
  item_id: string;
  qty: number;
};

type Body = {
  pv_id?: string;
  category_id?: string;
  subcategory_id?: string | null;
  inventory_date?: string; // YYYY-MM-DD
  rows?: Row[];
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function clampInt(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.trunc(x));
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });

  const pv_id = body.pv_id?.trim();
  const category_id = body.category_id?.trim();
  const subcategory_id = (body.subcategory_id ?? null)?.toString().trim() || null;
  const inventory_date = (body.inventory_date || "").trim(); // opzionale

  if (!isUuid(pv_id) || !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "pv_id o category_id non validi" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga da salvare" }, { status: 400 });
  }

  // Limite difensivo
  if (rows.length > 3000) {
    return NextResponse.json({ ok: false, error: "Troppe righe in un colpo (max 3000)" }, { status: 400 });
  }

  // Inventory date: se non arriva, usa default DB
  const dateOrNull = inventory_date && /^\d{4}-\d{2}-\d{2}$/.test(inventory_date) ? inventory_date : null;

  // Payload: upsert su (pv_id, item_id, inventory_date)
  const payload = rows
    .filter((r) => isUuid(r.item_id))
    .map((r) => ({
      pv_id,
      category_id,
      subcategory_id,
      item_id: r.item_id,
      qty: clampInt(r.qty),
      inventory_date: dateOrNull ?? undefined,
      created_by_username: session.username,
    }));

  if (payload.length === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga valida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("inventories")
    .upsert(payload as any, { onConflict: "pv_id,item_id,inventory_date" });

  if (error) {
    console.error("[inventories/save] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: payload.length });
}
