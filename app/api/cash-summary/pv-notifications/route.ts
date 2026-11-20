import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SessionData } from "@/lib/auth";
import { resolvePvAccess, requirePvAccess } from "@/lib/pvAccess";

export const runtime = "nodejs";

// Risolve il PV solo da identita' verificata. Il fallback sul codice e'
// riservato agli account standard storici e non puo' raggiungere PV riservati.
async function ownPvId(session: SessionData, action: "read" | "write"): Promise<string> {
  const context = await resolvePvAccess(session);
  if (context.role !== "punto_vendita" ||
      (context.profile !== "standard" && context.profile !== "cash_operator")) {
    throw new Error("FORBIDDEN");
  }

  if (context.profile === "cash_operator" && session.userId !== context.userId) {
    throw new Error("FORBIDDEN");
  }

  if (context.assignedPvId) {
    await requirePvAccess(context, context.assignedPvId, action);
    return context.assignedPvId;
  }

  if (context.profile !== "standard") throw new Error("FORBIDDEN");
  const code = context.username.trim().split(/\s+/)[0]?.toUpperCase();
  if (!code || code.length > 5) throw new Error("FORBIDDEN");

  const { data: pv, error } = await supabaseAdmin
    .from("pvs")
    .select("id")
    .eq("code", code)
    .eq("is_active", true)
    .eq("is_reserved", false)
    .maybeSingle();
  if (error) throw error;
  if (!pv?.id) throw new Error("FORBIDDEN");
  return String(pv.id);
}

function accessError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message === "UNAUTHORIZED" || message === "FORBIDDEN";
}

export async function GET() {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["pv", "punto_vendita"].includes(String(session.role ?? ""))) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const pvId = await ownPvId(session, "read");

    if (!pvId) {
      return NextResponse.json({ ok: false, error: "PV non trovato" }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("pv_cash_summary_notifications")
      .select(`
        id,
        summary_id,
        pv_id,
        summary_date,
        message,
        changed_fields,
        changed_values,
        is_read,
        created_at,
        read_at
      `)
      .eq("pv_id", pvId)
      .eq("is_read", false)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      rows: data ?? [],
    });
  } catch (e: any) {
    if (accessError(e)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
    }
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura notifiche PV" },
      { status: 500 }
    );
  }
}