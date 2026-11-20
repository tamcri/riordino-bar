import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireRole } from "@/lib/auth";
import { resolvePvAccess } from "@/lib/pvAccess";

export async function GET(req: Request) {
  try {
    const session = await requireRole(["admin"]);
    const access = await resolvePvAccess(session);
    if (access.profile !== "standard") throw new Error("FORBIDDEN");
    const url = new URL(req.url);
    const role = url.searchParams.get("role")?.trim().toLowerCase();

    let query = supabaseAdmin
      .from("app_users")
      .select("id, username, role, pv_id, access_profile, created_at")
      .order("username", { ascending: true });
    if (role) query = query.eq("role", role);
    const { data, error } = await query;
    if (error) throw error;

    let rows = data ?? [];
    if (!access.isPrimaryAdmin) {
      const { data: reserved, error: pvError } = await supabaseAdmin
        .from("pvs")
        .select("id")
        .eq("is_reserved", true);
      if (pvError) throw pvError;
      const reservedIds = new Set((reserved ?? []).map((pv) => String(pv.id)));
      rows = rows.filter((user) =>
        user.access_profile === "standard" &&
        (!user.pv_id || !reservedIds.has(String(user.pv_id)))
      );
    }
    // Mantiene invariata la forma JSON usata dalla pagina Utenti.
    const users = rows.map(({ id, username, role: userRole, pv_id, created_at }) => ({
      id, username, role: userRole, pv_id, created_at,
    }));
    return NextResponse.json({ ok: true, users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore interno";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
