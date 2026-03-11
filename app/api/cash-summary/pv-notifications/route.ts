import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

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

export async function GET() {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["pv", "punto_vendita"].includes(String(session.role ?? ""))) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const pvId = await getPvIdFromSession(session);

    if (!pvId) {
      return NextResponse.json({ ok: false, error: "PV non trovato" }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("pv_cash_summary_notifications")
      .select(`
        id,
        summary_id,
        pv_id,
        summary_date,
        message,
        changed_fields,
        field_comments,
        is_read,
        created_at,
        read_at
      `)
      .eq("pv_id", pvId)
      .eq("is_read", false)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      rows: data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura notifiche PV" },
      { status: 500 }
    );
  }
}