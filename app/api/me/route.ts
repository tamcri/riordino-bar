// app/api/me/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

async function lookupPvInfo(
  pv_id: string
): Promise<{ pv_code: string | null; pv_name: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("code, name")
    .eq("id", pv_id)
    .maybeSingle();

  if (error || !data) return { pv_code: null, pv_name: null };

  return {
    pv_code: (data as any).code ?? null,
    pv_name: (data as any).name ?? null,
  };
}

function isAdminRole(role: any) {
  const r = String(role || "").toLowerCase().trim();
  return (
    r === "admin" ||
    r === "amministrativo" ||
    r === "utente_amministrativo" ||
    r === "superadmin"
  );
}

export async function GET() {
  try {
    const c = cookies();
    const sessionRaw = c.get(COOKIE_NAME)?.value || "";
    const session = parseSessionValue(sessionRaw);

    if (!session) {
      return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
    }

    const role = (session as any).role ?? undefined;
    const user_id = (session as any).user_id || (session as any).id || null;
    const username = (session as any).username || null;

    const base = {
      role,
      username: (session as any).username ?? undefined,
    };

    // ✅ ADMIN / AMMINISTRATIVO: non richiediamo pv_id
    //    (potranno vedere tutti i PV o scegliere un PV dalla UI)
    if (isAdminRole(role)) {
      return NextResponse.json({
        ok: true,
        ...base,
        pv_id: null,
        pv_code: null,
        pv_name: null,
        is_admin: true,
      });
    }

    // ✅ 1) Punto vendita: prendo pv_id da app_users usando user_id
    if (user_id) {
      const { data: fromUsers, error: errUsers } = await supabaseAdmin
        .from("app_users")
        .select("pv_id")
        .eq("id", user_id)
        .maybeSingle();

      if (!errUsers && fromUsers?.pv_id) {
        const pvInfo = await lookupPvInfo(fromUsers.pv_id);
        return NextResponse.json({
          ok: true,
          ...base,
          pv_id: fromUsers.pv_id,
          ...pvInfo,
        });
      }
    }

    // ✅ 1B) Se non trovo per user_id, provo per username
    if (username) {
      const { data: uRow, error: uErr } = await supabaseAdmin
        .from("app_users")
        .select("pv_id")
        .eq("username", username)
        .maybeSingle();

      if (!uErr && uRow?.pv_id) {
        const pvInfo = await lookupPvInfo(uRow.pv_id);
        return NextResponse.json({
          ok: true,
          ...base,
          pv_id: uRow.pv_id,
          ...pvInfo,
          warning: "pv_id trovato cercando app_users per username (non per user_id).",
        });
      }
    }

    // ✅ 2) Fallback extra: deduco PV da pvs.code usando username (solo se username è tipo "A1-DIVERSIVO" o "A1-...")
    if (username) {
      const u = String(username).trim();

      const { data: byExact, error: errExact } = await supabaseAdmin
        .from("pvs")
        .select("id")
        .eq("code", u)
        .maybeSingle();

      if (!errExact && byExact?.id) {
        const pvInfo = await lookupPvInfo(byExact.id);
        return NextResponse.json({
          ok: true,
          ...base,
          pv_id: byExact.id,
          ...pvInfo,
          warning:
            `pv_id non trovato in app_users; dedotto da username (match esatto: ${u}). ` +
            `Consigliato assegnare pv_id in app_users.`,
        });
      }

      const prefix = u.split("-")[0]?.trim();
      if (prefix) {
        const { data: byPrefix, error: errPrefix } = await supabaseAdmin
          .from("pvs")
          .select("id")
          .eq("code", prefix)
          .maybeSingle();

        if (!errPrefix && byPrefix?.id) {
          const pvInfo = await lookupPvInfo(byPrefix.id);
          return NextResponse.json({
            ok: true,
            ...base,
            pv_id: byPrefix.id,
            ...pvInfo,
            warning:
              `pv_id non trovato in app_users; dedotto da username (prefisso: ${prefix}). ` +
              `Consigliato assegnare pv_id in app_users.`,
          });
        }
      }
    }

    return NextResponse.json(
      { ok: false, ...base, error: "PV non trovato per utente" },
      { status: 404 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}


