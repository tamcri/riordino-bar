import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  const pv_id = String(body?.pv_id ?? "").trim();
  const category_id = String(body?.category_id ?? "").trim();
  const subcategory_id = body?.subcategory_id == null ? null : String(body.subcategory_id).trim();
  const inventory_date = String(body?.inventory_date ?? "").trim();

  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  if (!isUuid(category_id)) return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  if (subcategory_id && !isUuid(subcategory_id)) return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  if (!isIsoDate(inventory_date)) return NextResponse.json({ ok: false, error: "inventory_date non valida (YYYY-MM-DD)" }, { status: 400 });

  // 1) elimina righe inventario
  let q1 = supabaseAdmin
    .from("inventories")
    .delete()
    .eq("pv_id", pv_id)
    .eq("category_id", category_id)
    .eq("inventory_date", inventory_date);

  if (subcategory_id) q1 = q1.eq("subcategory_id", subcategory_id);
  else q1 = q1.is("subcategory_id", null);

  const { error: err1 } = await q1;
  if (err1) {
    console.error("[inventories/delete] inventories error:", err1);
    return NextResponse.json({ ok: false, error: err1.message }, { status: 500 });
  }

  // 2) elimina testata (operatore ecc.)
  let q2 = supabaseAdmin
    .from("inventories_headers")
    .delete()
    .eq("pv_id", pv_id)
    .eq("category_id", category_id)
    .eq("inventory_date", inventory_date);

  if (subcategory_id) q2 = q2.eq("subcategory_id", subcategory_id);
  else q2 = q2.is("subcategory_id", null);

  const { error: err2 } = await q2;
  if (err2) {
    console.error("[inventories/delete] inventories_headers error:", err2);
    return NextResponse.json({ ok: false, error: err2.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
