import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const category = (url.searchParams.get("category") || "TAB").toUpperCase();
  const q = (url.searchParams.get("q") || "").trim();
  const active = (url.searchParams.get("active") || "1").toLowerCase(); // 1 | 0 | all
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

  if (!["TAB", "GV"].includes(category)) {
    return NextResponse.json({ ok: false, error: "Categoria non valida" }, { status: 400 });
  }

  let query = supabaseAdmin
    .from("items")
    .select("id, category, code, description, is_active, created_at, updated_at")
    .eq("category", category)
    .order("code", { ascending: true })
    .limit(limit);

  if (active === "1") query = query.eq("is_active", true);
  else if (active === "0") query = query.eq("is_active", false);

  if (q) {
    // ricerca su code o description
    // (PostgREST: OR via string)
    query = query.or(`code.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[items/list] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data || [] });
}
