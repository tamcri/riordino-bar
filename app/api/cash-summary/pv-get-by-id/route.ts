import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SessionData } from "@/lib/auth";
import { resolvePvAccess, requirePvAccess } from "@/lib/pvAccess";

export const runtime = "nodejs";

function isUuid(v: string | null | undefined) {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

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

function buildPvLabel(pv: { code?: string | null; name?: string | null } | null) {
  const code = String(pv?.code ?? "").trim();
  const name = String(pv?.name ?? "").trim();

  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  if (code) return code;
  return "";
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json(
        { ok: false, error: "Non autorizzato" },
        { status: 401 }
      );
    }

    const pv_id = await ownPvId(session, "read");

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") ?? "").trim();

    if (!isUuid(id)) {
      return NextResponse.json(
        { ok: false, error: "ID non valido" },
        { status: 400 }
      );
    }

    const { data: summary, error: summaryErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select("*")
      .eq("id", id)
      .eq("pv_id", pv_id)
      .maybeSingle();

    if (summaryErr) {
      return NextResponse.json(
        { ok: false, error: summaryErr.message },
        { status: 500 }
      );
    }

    if (!summary) {
      return NextResponse.json(
        { ok: false, error: "Riepilogo non trovato" },
        { status: 404 }
      );
    }

    const { data: pvRow } = await supabaseAdmin
      .from("pvs")
      .select("code, name")
      .eq("id", pv_id)
      .maybeSingle();

    const pvLabel = buildPvLabel(pvRow ?? null);

    const { data: suppliers, error: suppliersErr } = await supabaseAdmin
      .from("pv_cash_supplier_payments")
      .select("*")
      .eq("summary_id", id)
      .order("created_at", { ascending: true });

    if (suppliersErr) {
      return NextResponse.json(
        { ok: false, error: suppliersErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      summary: {
        ...summary,
        pv_code: String(pvRow?.code ?? "").trim(),
        pv_name: String(pvRow?.name ?? "").trim(),
        pv_label: pvLabel,
      },
      suppliers: suppliers ?? [],
    });
  } catch (e: any) {
    if (accessError(e)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
    }
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura dettaglio PV" },
      { status: 500 }
    );
  }
}