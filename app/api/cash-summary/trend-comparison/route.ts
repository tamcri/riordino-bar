import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ALLOWED_METRICS = new Set([
  "incasso_totale", "gv_pagati", "vendita_tabacchi", "vendita_gv", "lis_plus", "mooney", "pos",
]);

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const params = new URL(req.url).searchParams;
    const dateFrom = params.get("date_from") ?? "";
    const dateTo = params.get("date_to") ?? "";
    const metric = params.get("metric") ?? "";
    const status = params.get("status") ?? "all";
    const pvId = params.get("pv_id") ?? "";

    if (!isValidDate(dateFrom) || !isValidDate(dateTo) || dateFrom > dateTo) {
      return NextResponse.json({ ok: false, error: "Intervallo date non valido" }, { status: 400 });
    }
    const days = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000 + 1;
    if (days > 1500) {
      return NextResponse.json({ ok: false, error: "Periodo troppo esteso" }, { status: 400 });
    }
    if (!ALLOWED_METRICS.has(metric) || !["all", "open", "closed"].includes(status)) {
      return NextResponse.json({ ok: false, error: "Parametri di confronto non validi" }, { status: 400 });
    }
    if (pvId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pvId)) {
      return NextResponse.json({ ok: false, error: "PV non valido" }, { status: 400 });
    }

    // Consulta solo i campi necessari, con paginazione per non superare i limiti Supabase.
    const rows: Array<{ pv_id: string; data: string; value: number | null }> = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      let query = supabaseAdmin
        .from("pv_cash_summaries")
        .select("pv_id,data,is_closed,incasso_totale,gv_pagati,vendita_tabacchi,vendita_gv,lis_plus,mooney,pos")
        .gte("data", dateFrom)
        .lte("data", dateTo)
        .order("data", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (pvId) query = query.eq("pv_id", pvId);
      if (status !== "all") query = query.eq("is_closed", status === "closed");
      const { data, error } = await query;
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      const batch = Array.isArray(data) ? data : [];
      for (const record of batch) {
        const value = (record as Record<string, unknown>)[metric];
        const parsed = value == null ? null : Number(value);
        rows.push({
          pv_id: String(record.pv_id),
          data: String(record.data),
          value: parsed !== null && Number.isFinite(parsed) ? parsed : null,
        });
      }
      if (batch.length < pageSize) break;
      if (offset >= 20000) {
        return NextResponse.json({ ok: false, error: "Troppi dati per il confronto" }, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true, rows });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Errore confronto PV" }, { status: 500 });
  }
}
