import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireRole } from "@/lib/auth";
import { resolvePvAccess } from "@/lib/pvAccess";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const session = await requireRole(["admin"]);
    const access = await resolvePvAccess(session);
    if (access.profile !== "standard") throw new Error("FORBIDDEN");
    const body = await req.json().catch(() => null);
    const userId = body?.user_id;
    const pvId = body?.pv_id === "" || body?.pv_id == null ? null : body.pv_id;
    if (typeof userId !== "string" || !UUID.test(userId)) {
      return NextResponse.json({ ok: false, error: "user_id non valido" }, { status: 400 });
    }
    if (pvId !== null && (typeof pvId !== "string" || !UUID.test(pvId))) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }

    if (pvId !== null) {
      const { data: pv, error } = await supabaseAdmin
        .from("pvs")
        .select("id, is_reserved")
        .eq("id", pvId)
        .maybeSingle();
      if (error) throw error;
      if (!pv) return NextResponse.json({ ok: false, error: "PV non trovato" }, { status: 400 });
      // La modifica delle assegnazioni dei profili riservati si fa solo
      // attraverso la procedura dedicata che aggiorna anche i permessi.
      if (pv.is_reserved) throw new Error("FORBIDDEN");
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from("app_users")
      .select("id, role, access_profile, pv_id")
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return NextResponse.json({ ok: false, error: "Utente non trovato" }, { status: 400 });
    if (user.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Puoi assegnare un PV solo a utenti con ruolo punto_vendita" }, { status: 400 });
    }
    if (user.access_profile !== "standard") throw new Error("FORBIDDEN");

    const { data, error } = await supabaseAdmin
      .from("app_users")
      .update({ pv_id: pvId })
      .eq("id", userId)
      .select("id, username, role, pv_id")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, user: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore interno";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
