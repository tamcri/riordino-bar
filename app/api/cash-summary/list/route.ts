import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);

    const pv_id = String(searchParams.get("pv_id") ?? "").trim();
    const date_from = String(searchParams.get("date_from") ?? "").trim();
    const date_to = String(searchParams.get("date_to") ?? "").trim();

    let query = supabaseAdmin
      .from("pv_cash_summaries")
      .select(`
        id,
        pv_id,
        data,
        operatore,
        incasso_totale,
        gv_pagati,
        lis_plus,
        mooney,
        vendita_gv,
        vendita_tabacchi,
        pos,
        spese_extra,
        versamento,
        da_versare,
        fondo_cassa,
        is_closed,
        pvs:pvs!inner(
          code,
          name
        )
      `)
      .order("data", { ascending: true });

    if (pv_id) {
      if (!isUuid(pv_id)) {
        return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
      }
      query = query.eq("pv_id", pv_id);
    }

    if (date_from) {
      query = query.gte("data", date_from);
    }

    if (date_to) {
      query = query.lte("data", date_to);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    let saldo_iniziale_by_pv: Record<string, number> = {};

    const pvIdsFromRows = Array.from(
      new Set((data ?? []).map((row: any) => String(row?.pv_id ?? "").trim()).filter(Boolean))
    );

    const pvIdsToLoad = pv_id ? [pv_id] : pvIdsFromRows;

    if (pvIdsToLoad.length > 0) {
      const { data: balanceRows, error: balanceErr } = await supabaseAdmin
        .from("pv_cash_balance_start")
        .select("pv_id, saldo_iniziale")
        .in("pv_id", pvIdsToLoad);

      if (balanceErr) {
        return NextResponse.json({ ok: false, error: balanceErr.message }, { status: 500 });
      }

      saldo_iniziale_by_pv = (balanceRows ?? []).reduce((acc: Record<string, number>, row: any) => {
        const key = String(row?.pv_id ?? "").trim();
        if (!key) return acc;
        acc[key] = Number(row?.saldo_iniziale ?? 0) || 0;
        return acc;
      }, {});
    }

    const summaryIds = Array.from(
      new Set((data ?? []).map((row: any) => String(row?.id ?? "").trim()).filter(Boolean))
    );

    let checks_by_summary: Record<string, Record<string, "ok" | "check">> = {};

    if (summaryIds.length > 0) {
      const { data: checkRows, error: checkErr } = await supabaseAdmin
        .from("cash_summary_metric_checks")
        .select("summary_id, metric_key, status")
        .in("summary_id", summaryIds);

      if (checkErr) {
        return NextResponse.json({ ok: false, error: checkErr.message }, { status: 500 });
      }

      checks_by_summary = (checkRows ?? []).reduce(
        (acc: Record<string, Record<string, "ok" | "check">>, row: any) => {
          const summaryId = String(row?.summary_id ?? "").trim();
          const metricKey = String(row?.metric_key ?? "").trim();
          const status = String(row?.status ?? "").trim() as "ok" | "check";

          if (!summaryId || !metricKey || !["ok", "check"].includes(status)) {
            return acc;
          }

          if (!acc[summaryId]) {
            acc[summaryId] = {};
          }

          acc[summaryId][metricKey] = status;
          return acc;
        },
        {}
      );
    }

    return NextResponse.json({
      ok: true,
      rows: data ?? [],
      saldo_iniziale_by_pv,
      checks_by_summary,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura riepiloghi" },
      { status: 500 }
    );
  }
}