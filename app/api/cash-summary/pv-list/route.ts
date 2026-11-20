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

    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json(
        { ok: false, error: "Non autorizzato" },
        { status: 401 }
      );
    }

    const pv_id = await ownPvId(session, "read");

    const { data, error } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select(`
        id,
        data,
        operatore,
        totale,
        pos,
        spese_extra,
        versamento,
        da_versare,
        tot_versato,
        status,
        is_closed,
        created_at
      `)
      .eq("pv_id", pv_id)
      .order("data", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
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
      { ok: false, error: e?.message || "Errore lettura riepiloghi PV" },
      { status: 500 }
    );
  }
}