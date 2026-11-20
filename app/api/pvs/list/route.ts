import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { filterVisiblePvs, resolvePvAccess } from "@/lib/pvAccess";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cookieStore = cookies();
    const session = parseSessionValue(cookieStore.get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    // Identita', profilo e permessi sono verificati sul server.
    const access = await resolvePvAccess(session);

    const { data, error } = await supabaseAdmin
      .from("pvs")
      .select("id, code, name, is_active, is_reserved")
      .eq("is_active", true)
      .order("code", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message || "Errore DB" }, { status: 500 });
    }

    const allPvs = data ?? [];

    // Compatibilita': gli account standard continuano a ricevere l'elenco
    // dei PV ordinari come prima. Solo il principale vede anche i riservati.
    // I nuovi profili limitati vedono esclusivamente il PV autorizzato.
    const visiblePvs = access.isPrimaryAdmin
      ? allPvs
      : access.profile === "standard"
        ? allPvs.filter((pv) => pv.is_reserved === false)
        : filterVisiblePvs(access, allPvs);

    // Mantiene esattamente il formato della risposta precedente.
    const rows = visiblePvs.map(({ id, code, name, is_active }) => ({
      id,
      code,
      name,
      is_active,
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Errore lettura PV";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ ok: false, error: "Accesso negato" }, { status: 403 });
    }
    console.error("GET /api/pvs/list:", error);
    return NextResponse.json({ ok: false, error: "Errore lettura PV" }, { status: 500 });
  }
}
