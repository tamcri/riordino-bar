import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  // ✅ categorie leggibili da utenti autenticati (anche punto_vendita)
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id, name, slug, is_active")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, rows: data ?? [] });
}



