import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

function normText(v: any): string {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const pv_id_q = normText(url.searchParams.get("pv_id"));

  // PV target:
  // - admin/amministrativo: pv_id query obbligatorio
  // - punto_vendita: pv_id = quello dell'utente
  let pv_id: string | null = null;
  let warning: string | undefined;

  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    pv_id = r.pv_id;
    warning = r.warning;
    if (!pv_id) return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
  } else {
    pv_id = pv_id_q || null;
    if (!pv_id) return NextResponse.json({ ok: false, error: "pv_id obbligatorio" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("deposits")
    .select("id, pv_id, code, name, is_active, created_at")
    .eq("pv_id", pv_id)
    .order("code", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deposits: data || [], ...(warning ? { warning } : {}) });
}
