import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { resolvePvAccess, requirePvAccess } from "@/lib/pvAccess";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session) return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });

    const context = await resolvePvAccess(session);
    if (context.role !== "admin" || context.profile !== "cash_readonly" || !context.assignedPvId || !session.userId) {
      return NextResponse.json({ ok: false, error: "Accesso negato" }, { status: 403 });
    }
    await requirePvAccess(context, context.assignedPvId, "read");

    const url = new URL(req.url);
    const dateFrom = url.searchParams.get("date_from")?.trim() ?? "";
    const dateTo = url.searchParams.get("date_to")?.trim() ?? "";
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if ((dateFrom && !datePattern.test(dateFrom)) || (dateTo && !datePattern.test(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) {
      return NextResponse.json({ ok: false, error: "Intervallo date non valido" }, { status: 400 });
    }

    let query = supabaseAdmin
      .from("pv_cash_summaries")
      .select("id, pv_id, data, operatore, totale, incasso_totale, versamento, da_versare, tot_versato, fondo_cassa, status, is_closed")
      .eq("pv_id", context.assignedPvId)
      .order("data", { ascending: false });
    if (dateFrom) query = query.gte("data", dateFrom);
    if (dateTo) query = query.lte("data", dateTo);

    const { data: rows, error } = await query;
    if (error) throw error;
    const { data: pv, error: pvError } = await supabaseAdmin.from("pvs").select("code, name").eq("id", context.assignedPvId).single();
    if (pvError) throw pvError;

    return NextResponse.json({ ok: true, rows: rows ?? [], pv: { code: pv.code, name: pv.name } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Errore caricamento riepiloghi";
    const denied = reason === "FORBIDDEN" || reason === "UNAUTHORIZED";
    return NextResponse.json({ ok: false, error: denied ? "Accesso negato" : "Errore caricamento riepiloghi" }, { status: denied ? 403 : 500 });
  }
}
