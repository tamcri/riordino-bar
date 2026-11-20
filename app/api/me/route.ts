// app/api/me/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canAccessPv, requirePvAccess, resolvePvAccess } from "@/lib/pvAccess";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
    }

    // Verifica identita', ruolo e profilo correnti sul database, non solo nel cookie.
    const access = await resolvePvAccess(session);
    const base = { role: access.role, username: access.username };

    if (access.role === "admin" || access.role === "amministrativo") {
      return NextResponse.json({
        ok: true,
        ...base,
        pv_id: null,
        pv_code: null,
        pv_name: null,
        is_admin: true,
      });
    }

    if (access.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
    }

    // Il profilo riservato non puo' utilizzare cookie vecchi o fallback sullo username.
    if (access.profile === "cash_operator" && session.userId !== access.userId) {
      return NextResponse.json({ ok: false, error: "Effettua nuovamente il login" }, { status: 401 });
    }

    let pvId = access.assignedPvId;
    let legacyFallback = false;
    let warning: string | undefined;

    // Compatibilita' solo con gli account ordinari storici senza pv_id assegnato.
    if (!pvId && access.profile === "standard") {
      const username = access.username.trim();
      const candidates = [username, username.split("-")[0]?.trim()]
        .filter((value): value is string => Boolean(value));

      for (const code of new Set(candidates)) {
        const { data: legacyPv, error } = await supabaseAdmin
          .from("pvs")
          .select("id, code, name, is_reserved")
          .eq("code", code)
          .maybeSingle();
        if (error) throw error;
        if (legacyPv && !legacyPv.is_reserved) {
          pvId = String(legacyPv.id);
          legacyFallback = true;
          warning = "pv_id dedotto dal codice nello username; consigliato assegnare pv_id in app_users.";
          break;
        }
      }
    }

    if (!pvId || !UUID.test(pvId)) {
      return NextResponse.json({ ok: false, ...base, error: "PV non trovato per utente" }, { status: 404 });
    }

    if (legacyFallback) {
      // Non estendere mai il fallback ai PV riservati.
      const { data: pv, error } = await supabaseAdmin
        .from("pvs")
        .select("id, code, name, is_reserved")
        .eq("id", pvId)
        .maybeSingle();
      if (error) throw error;
      if (!pv || pv.is_reserved || !canAccessPv({ ...access, assignedPvId: pvId }, pv, "read")) {
        return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
      }
    } else {
      try {
        await requirePvAccess(access, pvId, "read");
      } catch (error) {
        if (error instanceof Error && error.message === "FORBIDDEN") {
          return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
        }
        throw error;
      }
    }

    const { data: pv, error: pvError } = await supabaseAdmin
      .from("pvs")
      .select("code, name")
      .eq("id", pvId)
      .maybeSingle();
    if (pvError) throw pvError;
    if (!pv) {
      return NextResponse.json({ ok: false, ...base, error: "PV non trovato per utente" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      ...base,
      pv_id: pvId,
      pv_code: pv.code ?? null,
      pv_name: pv.name ?? null,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore server";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: status === 500 ? "Errore server" : message }, { status });
  }
}
