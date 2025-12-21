import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function normCode(v: string) {
  return v.trim().toUpperCase();
}
function normName(v: string) {
  return v.trim();
}

export async function POST(req: Request) {
  const cookieStore = cookies();
  const session = parseSessionValue(cookieStore.get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = normCode(String(body?.code ?? ""));
  const name = normName(String(body?.name ?? ""));

  if (!code || !name) {
    return NextResponse.json({ ok: false, error: "Codice e Nome sono obbligatori" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .insert({ code, name })
    .select("id, code, name, is_active, created_at")
    .single();

  if (error) {
    const msg = error.code === "23505" ? "Codice PV già esistente" : (error.message || "Errore DB");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true, pv: data });
}

