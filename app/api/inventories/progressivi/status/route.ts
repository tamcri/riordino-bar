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

    const pv_id = String(url.searchParams.get("pv_id") ?? "").trim();
    const inventory_date = String(url.searchParams.get("inventory_date") ?? "").trim();

    // ✅ NUOVO
    const inventory_header_id = String(url.searchParams.get("inventory_header_id") ?? "").trim();

    // =========================
    // ✅ NUOVA LOGICA (PRIORITARIA)
    // =========================
    if (isUuid(inventory_header_id)) {
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
    }

    // =========================
    // ⚠️ FALLBACK (VECCHIA LOGICA)
    // =========================
    if (!isUuid(pv_id)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(inventory_date)) {
      return NextResponse.json({ ok: false, error: "inventory_date non valido" }, { status: 400 });
    }

    const { count, error } = await supabaseAdmin
      .from("inventory_progressivi_rows")
      .select("id", { count: "exact", head: true })
      .eq("pv_id", pv_id)
      .lt("inventory_date", inventory_date);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      exists: (count ?? 0) > 0,
      count: count ?? 0,
      mode: "legacy",
    });
  } catch (err: any) {
    console.error("[progressivi status]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}