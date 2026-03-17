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

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Non autorizzato" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);

    let pv_id: string | null = null;

    if (["admin", "amministrativo"].includes(session.role)) {
      const pvFromQuery = String(searchParams.get("pv_id") ?? "").trim();

      if (!isUuid(pvFromQuery)) {
        return NextResponse.json(
          { ok: false, error: "PV non valido" },
          { status: 400 }
        );
      }

      pv_id = pvFromQuery;
    } else if (session.role === "punto_vendita") {
      try {
        pv_id = await requirePvIdForPuntoVendita(session.username);
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, error: e?.message || "PV non assegnato" },
          { status: 401 }
        );
      }
    } else {
      return NextResponse.json(
        { ok: false, error: "Ruolo non autorizzato" },
        { status: 403 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("pv_cash_balance_start")
      .select("id, pv_id, start_date, saldo_iniziale")
      .eq("pv_id", pv_id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: data ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura saldo iniziale" },
      { status: 500 }
    );
  }
}