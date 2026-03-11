import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

async function getPvIdFromSession(session: any) {
  const username = String(session?.username ?? "").trim();
  if (!username) return null;

  const tableCandidates = ["app_user", "app_users", "utenti", "users"];

  for (const table of tableCandidates) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("pv_id")
      .eq("username", username)
      .maybeSingle();

    if (error) continue;

    const pvId = String((data as any)?.pv_id ?? "").trim();
    if (pvId) return pvId;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["pv", "punto_vendita"].includes(String(session.role ?? ""))) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const pvId = await getPvIdFromSession(session);

    if (!pvId) {
      return NextResponse.json({ ok: false, error: "PV non trovato" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const id = String(body?.id ?? "").trim();

    if (!isUuid(id)) {
      return NextResponse.json({ ok: false, error: "ID notifica non valido" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("pv_cash_summary_notifications")
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("pv_id", pvId);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      id,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore aggiornamento notifica PV" },
      { status: 500 }
    );
  }
}