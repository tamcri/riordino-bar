import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { resolvePvAccess, requirePvAccess } from "@/lib/pvAccess";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session) return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    const context = await resolvePvAccess(session);
    if (context.role !== "admin" || context.profile !== "cash_readonly" || !context.assignedPvId || !session.userId) {
      return NextResponse.json({ ok: false, error: "Accesso negato" }, { status: 403 });
    }
    await requirePvAccess(context, context.assignedPvId, "read");

    const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
    if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "ID non valido" }, { status: 400 });

    const { data: summary, error } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select("*")
      .eq("id", id)
      .eq("pv_id", context.assignedPvId)
      .maybeSingle();
    if (error) throw error;
    if (!summary) return NextResponse.json({ ok: false, error: "Riepilogo non trovato" }, { status: 404 });

    const [{ data: suppliers, error: suppliersError }, { data: pv, error: pvError }] = await Promise.all([
      supabaseAdmin.from("pv_cash_supplier_payments").select("supplier_code, supplier_name, amount").eq("summary_id", summary.id),
      supabaseAdmin.from("pvs").select("code, name").eq("id", context.assignedPvId).single(),
    ]);
    if (suppliersError) throw suppliersError;
    if (pvError) throw pvError;
    const pvCode = String(pv.code ?? "");
    const pvName = String(pv.name ?? "");
    return NextResponse.json({
      ok: true,
      summary: { ...summary, pv_code: pvCode, pv_name: pvName, pv_label: `${pvCode} - ${pvName}`.trim() },
      suppliers: suppliers ?? [],
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const denied = reason === "FORBIDDEN" || reason === "UNAUTHORIZED";
    return NextResponse.json({ ok: false, error: denied ? "Accesso negato" : "Errore caricamento dettaglio" }, { status: denied ? 403 : 500 });
  }
}
