import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = cookies();
  const session = parseSessionValue(cookieStore.get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("id, code, name, is_active")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message || "Errore DB" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data || [] });
}

