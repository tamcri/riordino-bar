import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const USER_TABLE_CANDIDATES = ["app_user", "app_users", "utenti", "users"];

async function lookupPvIdFromUserTables(username: string): Promise<{ pv_id: string | null; table?: string; error?: string }> {
  let lastErr: string | null = null;

  for (const table of USER_TABLE_CANDIDATES) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("pv_id")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      lastErr = `[${table}] ${error.message}`;
      continue;
    }

    const pv_id = (data as any)?.pv_id ?? null;
    return { pv_id, table };
  }

  return { pv_id: null, error: lastErr ?? "Nessuna tabella utenti valida trovata." };
}

async function lookupPvIdFromUsernameCode(username: string): Promise<{ pv_id: string | null; code?: string; error?: string }> {
  const code = (username || "").trim().split(/\s+/)[0]?.toUpperCase();

  // codice PV di solito tipo A1, B6, ecc.
  if (!code || code.length > 5) return { pv_id: null };

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("id, code")
    .eq("is_active", true)
    .eq("code", code)
    .maybeSingle();

  if (error) return { pv_id: null, code, error: error.message };
  return { pv_id: data?.id ?? null, code };
}

export async function GET() {
  const cookieStore = cookies();
  const session = parseSessionValue(cookieStore.get(COOKIE_NAME)?.value ?? null);

  if (!session) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const base = { username: session.username, role: session.role };

  if (session.role === "admin" || session.role === "amministrativo") {
    return NextResponse.json({ ok: true, ...base, pv_id: null });
  }

  // 1) Provo dalla tabella utenti
  const fromUsers = await lookupPvIdFromUserTables(session.username);

  if (fromUsers.pv_id) {
    return NextResponse.json({ ok: true, ...base, pv_id: fromUsers.pv_id });
  }

  // 2) Fallback: deduco dal codice PV nello username (es. "A1 DIVERSIVO" -> "A1")
  const fromCode = await lookupPvIdFromUsernameCode(session.username);

  if (fromCode.pv_id) {
    return NextResponse.json({
      ok: true,
      ...base,
      pv_id: fromCode.pv_id,
      warning: `pv_id non presente in tabella utenti; dedotto da username (${fromCode.code}). Consigliato assegnare pv_id correttamente all’utente.`,
    });
  }

  // 3) Errore chiaro finale
  return NextResponse.json(
    {
      ok: false,
      error:
        "Utente punto vendita senza PV assegnato. " +
        "pv_id non trovato nella tabella utenti e non deducibile dal codice nello username.",
      debug: {
        tried_user_tables: USER_TABLE_CANDIDATES,
        last_user_table_error: fromUsers.error ?? null,
      },
    },
    { status: 400 }
  );
}


