import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f-]{36}$/i.test(v.trim());
}

export async function GET(req: Request) {
  try {
    const c = cookies();
    const session = parseSessionValue(c.get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);

    const inventory_header_id = String(url.searchParams.get("inventory_header_id") ?? "").trim();

    if (!isUuid(inventory_header_id)) {
      return NextResponse.json(
        { ok: false, error: "inventory_header_id obbligatorio e non valido" },
        { status: 400 }
      );
    }

    const { count, error } = await supabaseAdmin
      .from("inventory_progressivi_rows")
      .select("id", { count: "exact", head: true })
      .eq("inventory_header_id", inventory_header_id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      exists: (count ?? 0) > 0,
      count: count ?? 0,
      mode: "by_header",
    });
  } catch (err: any) {
    console.error("[progressivi status]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}