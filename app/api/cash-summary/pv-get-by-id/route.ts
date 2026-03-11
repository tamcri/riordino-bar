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

async function lookupPvIdFromUsernameCode(username: string): Promise<string | null> {
  const code = (username || "").trim().split(/\s+/)[0]?.toUpperCase();
  if (!code || code.length > 5) return null;

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("id")
    .eq("is_active", true)
    .eq("code", code)
    .maybeSingle();

  if (error) return null;
  return data?.id ?? null;
}

async function requirePvIdForPuntoVendita(username: string): Promise<string> {
  const pvFromUsers = await lookupPvIdFromUserTables(username);
  if (pvFromUsers) return pvFromUsers;

  const pvFromCode = await lookupPvIdFromUsernameCode(username);
  if (pvFromCode) return pvFromCode;

  throw new Error("Utente punto vendita senza PV assegnato (pv_id mancante).");
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json(
        { ok: false, error: "Non autorizzato" },
        { status: 401 }
      );
    }

    const pv_id = await requirePvIdForPuntoVendita(session.username);

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") ?? "").trim();

    if (!isUuid(id)) {
      return NextResponse.json(
        { ok: false, error: "ID non valido" },
        { status: 400 }
      );
    }

    const { data: summary, error: summaryErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select("*")
      .eq("id", id)
      .eq("pv_id", pv_id)
      .maybeSingle();

    if (summaryErr) {
      return NextResponse.json(
        { ok: false, error: summaryErr.message },
        { status: 500 }
      );
    }

    if (!summary) {
      return NextResponse.json(
        { ok: false, error: "Riepilogo non trovato" },
        { status: 404 }
      );
    }

    const { data: suppliers, error: suppliersErr } = await supabaseAdmin
      .from("pv_cash_supplier_payments")
      .select("*")
      .eq("summary_id", id)
      .order("created_at", { ascending: true });

    if (suppliersErr) {
      return NextResponse.json(
        { ok: false, error: suppliersErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      summary,
      suppliers: suppliers ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura dettaglio PV" },
      { status: 500 }
    );
  }
}