import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireRole } from "@/lib/auth";
import { resolvePvAccess } from "@/lib/pvAccess";
import { filterVisiblePvs } from "@/lib/pvAccess";

export async function GET() {
  try {
    const session = await requireRole(["admin"]);
    const access = await resolvePvAccess(session);
    if (access.profile !== "standard") throw new Error("FORBIDDEN");
    const { data, error } = await supabaseAdmin
      .from("pvs")
      .select("id, code, name, is_reserved")
      .order("code", { ascending: true });
    if (error) throw error;
    const visible = filterVisiblePvs(access, data ?? []).map(({ id, code, name }) => ({ id, code, name }));
    return NextResponse.json({ ok: true, pvs: visible });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore interno";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
