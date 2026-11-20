import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireRole } from "@/lib/auth";
import { resolvePvAccess } from "@/lib/pvAccess";

export const runtime = "nodejs";

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const session = await requireRole(["admin"]);
    const access = await resolvePvAccess(session);
    if (access.profile !== "standard") throw new Error("FORBIDDEN");
    const body = await req.json().catch(() => null);
    const code = normalize(body?.code).toUpperCase();
    const name = normalize(body?.name);
    if (!code || !name) {
      return NextResponse.json({ ok: false, error: "Codice e Nome sono obbligatori" }, { status: 400 });
    }

    // Un PV riservato può essere creato soltanto dall'Admin principale.
    // Il valore deve essere esplicitamente true, mai ricavato da stringhe truthy.
    if (body?.is_reserved !== undefined && typeof body.is_reserved !== "boolean") {
      return NextResponse.json({ ok: false, error: "is_reserved non valido" }, { status: 400 });
    }
    const isReserved = body?.is_reserved === true;
    if (isReserved && !access.isPrimaryAdmin) throw new Error("FORBIDDEN");

    const { data, error } = await supabaseAdmin
      .from("pvs")
      .insert({ code, name, is_reserved: isReserved })
      .select("id, code, name, is_active, created_at")
      .single();

    if (error) {
      const msg = error.code === "23505" ? "Codice PV già esistente" : (error.message || "Errore DB");
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
    return NextResponse.json({ ok: true, pv: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore interno";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
