import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const sessionCookie = cookie
    .split("; ")
    .find((c) => c.startsWith(COOKIE_NAME + "="))
    ?.split("=")[1];

  const session = parseSessionValue(sessionCookie);

  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  const user_id = body?.user_id;
  const pv_id_raw = body?.pv_id ?? null;
  const pv_id = pv_id_raw === "" ? null : pv_id_raw;

  if (!user_id || !isUuid(user_id)) {
    return NextResponse.json({ ok: false, error: "user_id non valido" }, { status: 400 });
  }

  if (pv_id !== null && !isUuid(pv_id)) {
    return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  }

  // Controllo PV se presente
  if (pv_id !== null) {
    const { data: pvRow, error: pvErr } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("id", pv_id)
      .maybeSingle();

    if (pvErr) return NextResponse.json({ ok: false, error: pvErr.message }, { status: 500 });
    if (!pvRow) return NextResponse.json({ ok: false, error: "PV non trovato" }, { status: 400 });
  }

  // (opzionale ma utile) controlliamo che l’utente esista
  const { data: userRow, error: userErr } = await supabaseAdmin
    .from("app_users")
    .select("id, role")
    .eq("id", user_id)
    .maybeSingle();

  if (userErr) return NextResponse.json({ ok: false, error: userErr.message }, { status: 500 });
  if (!userRow) return NextResponse.json({ ok: false, error: "Utente non trovato" }, { status: 400 });

  // Se vuoi essere rigido: assegniamo pv_id solo a ruolo punto_vendita
  if (userRow.role !== "punto_vendita") {
    return NextResponse.json(
      { ok: false, error: "Puoi assegnare un PV solo a utenti con ruolo punto_vendita" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("app_users")
    .update({ pv_id })
    .eq("id", user_id)
    .select("id, username, role, pv_id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, user: data });
}

