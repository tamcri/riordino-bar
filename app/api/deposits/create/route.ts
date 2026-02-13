import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

type Body = {
  pv_id?: string;
  code?: string;
  name?: string | null;
};

function normText(v: any): string {
  return String(v ?? "").trim();
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON non valido" }, { status: 400 });
  }

  const code = normText(body.code).toUpperCase();
  const name = body.name == null ? null : normText(body.name);

  if (!code) return NextResponse.json({ ok: false, error: "code obbligatorio" }, { status: 400 });

  // PV target:
  // - admin/amministrativo: pv_id obbligatorio
  // - punto_vendita: pv_id = quello dell'utente (ignoro eventuale pv_id passato)
  let pv_id: string | null = null;
  let warning: string | undefined;

  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    pv_id = r.pv_id;
    warning = r.warning;
    if (!pv_id) {
      return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    }
  } else {
    pv_id = normText(body.pv_id);
    if (!pv_id) return NextResponse.json({ ok: false, error: "pv_id obbligatorio" }, { status: 400 });
  }

  // Verifica PV esistente
  const { data: pvRow, error: pvErr } = await supabaseAdmin.from("pvs").select("id, code").eq("id", pv_id).maybeSingle();

  if (pvErr) return NextResponse.json({ ok: false, error: pvErr.message }, { status: 500 });
  if (!pvRow) return NextResponse.json({ ok: false, error: "Punto vendita non trovato" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("deposits")
    .insert({ pv_id, code, name, is_active: true })
    .select("id, pv_id, code, name, is_active, created_at")
    .single();

  if (error) {
    // unique(pv_id, code) -> messaggio chiaro
    const msg = /duplicate key|unique/i.test(error.message)
      ? "Esiste già un deposito con questo codice per il PV selezionato"
      : error.message;
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true, deposit: data, ...(warning ? { warning } : {}) });
}
