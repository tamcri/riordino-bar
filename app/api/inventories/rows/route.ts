import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const pv_id = (url.searchParams.get("pv_id") || "").trim();
  const category_id = (url.searchParams.get("category_id") || "").trim();
  const subcategory_id = (url.searchParams.get("subcategory_id") || "").trim();
  const inventory_date = (url.searchParams.get("inventory_date") || "").trim(); // YYYY-MM-DD

  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  if (!isUuid(category_id)) return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  if (subcategory_id && !isUuid(subcategory_id)) return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  if (!inventory_date) return NextResponse.json({ ok: false, error: "inventory_date mancante" }, { status: 400 });

  let q = supabaseAdmin
    .from("inventories")
    .select("id, pv_id, category_id, subcategory_id, item_id, qty, inventory_date, created_by_username, created_at, updated_at")
    .eq("pv_id", pv_id)
    .eq("category_id", category_id)
    .eq("inventory_date", inventory_date);

  if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
  else q = q.is("subcategory_id", null);

  const { data, error } = await q;

  if (error) {
    console.error("[inventories/rows] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data || [];
  const itemIds = Array.from(new Set(rows.map((r: any) => r.item_id)));

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("items")
    .select("id, code, description")
    .in("id", itemIds);

  if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

  const itemMap = new Map<string, { code: string; description: string }>();
  (items || []).forEach((it: any) => itemMap.set(it.id, { code: it.code, description: it.description }));

  const out = rows
    .map((r: any) => ({
      id: r.id,
      item_id: r.item_id,
      code: itemMap.get(r.item_id)?.code ?? "",
      description: itemMap.get(r.item_id)?.description ?? "",
      qty: r.qty ?? 0,
    }))
    .sort((a, b) => (a.code || "").localeCompare(b.code || ""));

  return NextResponse.json({ ok: true, rows: out });
}
