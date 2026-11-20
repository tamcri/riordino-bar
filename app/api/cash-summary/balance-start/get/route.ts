import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolvePvAccess, requirePvAccess } from "@/lib/pvAccess";

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

    const access = await resolvePvAccess(session);
    // I profili riservati richiedono la sessione aggiornata con UUID verificato.
    if (access.profile !== "standard" && session.userId !== access.userId) {
      return NextResponse.json({ ok: false, error: "Effettua nuovamente il login" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    let pv_id: string | null = null;
    let isVerifiedLegacyPv = false;

    if (["admin", "amministrativo"].includes(session.role)) {
      const pvFromQuery = String(searchParams.get("pv_id") ?? "").trim();
      if (!isUuid(pvFromQuery)) {
        return NextResponse.json({ ok: false, error: "PV non valido" }, { status: 400 });
      }
      pv_id = pvFromQuery;
    } else if (session.role === "punto_vendita") {
      if (access.profile === "cash_operator") {
        // Per il PV riservato non sono ammessi fallback basati sullo username.
        pv_id = access.assignedPvId;
      } else if (access.profile === "standard") {
        if (access.assignedPvId) {
          pv_id = access.assignedPvId;
        } else {
          // Compatibilita' con gli account PV storici privi di pv_id.
          // La derivazione dallo username non e' mai consentita per PV riservati.
          pv_id = await requirePvIdForPuntoVendita(session.username);
          isVerifiedLegacyPv = true;
        }
      } else {
        return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ ok: false, error: "Ruolo non autorizzato" }, { status: 403 });
    }

    if (!pv_id || !isUuid(pv_id)) {
      return NextResponse.json({ ok: false, error: "PV non assegnato" }, { status: 403 });
    }
    try {
      if (isVerifiedLegacyPv) {
        const { data: legacyPv, error: legacyError } = await supabaseAdmin
          .from("pvs")
          .select("id, is_reserved")
          .eq("id", pv_id)
          .maybeSingle();
        if (legacyError) throw legacyError;
        if (!legacyPv || legacyPv.is_reserved) {
          return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
        }
      } else {
        await requirePvAccess(access, pv_id, "read");
      }
    } catch (e: any) {
      if (e?.message !== "FORBIDDEN") throw e;
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
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