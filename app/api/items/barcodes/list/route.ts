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

  // lettura consentita dove serve (admin/amministrativo/pv se vuoi farlo anche in inventario)
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const item_id = String(url.searchParams.get("item_id") ?? "").trim();

  if (!isUuid(item_id)) {
    return NextResponse.json({ ok: false, error: "item_id non valido" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("item_barcodes")
    .select("id, barcode, created_at, updated_at")
    .eq("item_id", item_id)
    .order("barcode", { ascending: true })
    .limit(2000);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data || [] });
}
