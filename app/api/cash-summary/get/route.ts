import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const USER_TABLE_CANDIDATES = ["app_user", "app_users", "utenti", "users"];

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

async function lookupPvIdFromUserTables(username: string): Promise<string | null> {
  for (const table of USER_TABLE_CANDIDATES) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("pv_id")
      .eq("username", username)
      .maybeSingle();

    if (error) continue;

    const pv_id = (data as any)?.pv_id ?? null;

    if (pv_id && isUuid(pv_id)) return pv_id;
  }

  return null;
}

export async function GET(req: Request) {
  try {

    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const pv_id = await lookupPvIdFromUserTables(session.username);

    if (!pv_id) {
      return NextResponse.json(
        { ok: false, error: "PV non assegnato all'utente" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);

    const data = searchParams.get("data");

    if (!data) {
      return NextResponse.json({ ok: false, error: "Data mancante" }, { status: 400 });
    }

    const { data: summary, error } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select("*")
      .eq("pv_id", pv_id)
      .eq("data", data)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!summary) {
      return NextResponse.json({
        ok: true,
        exists: false
      });
    }

    const { data: suppliers } = await supabaseAdmin
      .from("pv_cash_supplier_payments")
      .select("*")
      .eq("summary_id", summary.id);

    return NextResponse.json({
      ok: true,
      exists: true,
      summary,
      suppliers: suppliers ?? []
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura riepilogo" },
      { status: 500 }
    );
  }
}