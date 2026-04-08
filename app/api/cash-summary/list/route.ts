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

type BalanceStartRow = {
  pv_id?: string | null;
  start_date?: string | null;
  saldo_iniziale?: number | null;
};

type SummaryAggRow = {
  pv_id?: string | null;
  data?: string | null;
  da_versare?: number | null;
};

function n(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
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

    const rows = Array.isArray(data) ? data : [];

    const pvIdsFromRows = Array.from(
      new Set(rows.map((row: any) => String(row?.pv_id ?? "").trim()).filter(Boolean))
    );

    const pvIdsToLoad = pv_id ? [pv_id] : pvIdsFromRows;

    let saldo_iniziale_by_pv: Record<string, number> = {};
    let balance_start_date_by_pv: Record<string, string> = {};

    const firstFilteredDateByPv = rows.reduce((acc: Record<string, string>, row: any) => {
      const key = String(row?.pv_id ?? "").trim();
      const rowDate = String(row?.data ?? "").trim();

      if (!key || !rowDate) return acc;

      if (!acc[key] || rowDate < acc[key]) {
        acc[key] = rowDate;
      }

      return acc;
    }, {});

    if (pvIdsToLoad.length > 0) {
      const { data: balanceRows, error: balanceErr } = await supabaseAdmin
        .from("pv_cash_balance_start")
        .select("pv_id, start_date, saldo_iniziale")
        .in("pv_id", pvIdsToLoad)
        .order("start_date", { ascending: true });

      if (balanceErr) {
        return NextResponse.json({ ok: false, error: balanceErr.message }, { status: 500 });
      }

      const groupedByPv = (balanceRows ?? []).reduce(
        (acc: Record<string, BalanceStartRow[]>, row: BalanceStartRow) => {
          const key = String(row?.pv_id ?? "").trim();
          if (!key) return acc;

          if (!acc[key]) {
            acc[key] = [];
          }

          acc[key].push(row);
          return acc;
        },
        {}
      );

      let rowsBeforeFilterByPv: Record<string, number> = {};

      if (date_from) {
        const { data: preFilterRows, error: preFilterErr } = await supabaseAdmin
          .from("pv_cash_summaries")
          .select("pv_id, data, da_versare")
          .in("pv_id", pvIdsToLoad)
          .lt("data", date_from)
          .order("data", { ascending: true });

        if (preFilterErr) {
          return NextResponse.json({ ok: false, error: preFilterErr.message }, { status: 500 });
        }

        rowsBeforeFilterByPv = (preFilterRows ?? []).reduce(
          (acc: Record<string, number>, row: SummaryAggRow) => {
            const key = String(row?.pv_id ?? "").trim();
            if (!key) return acc;

            acc[key] = n(acc[key]) + n(row?.da_versare);
            return acc;
          },
          {}
        );
      } else {
        rowsBeforeFilterByPv = {};
      }

      for (const currentPvId of pvIdsToLoad) {
        const pvKey = String(currentPvId ?? "").trim();
        if (!pvKey) continue;

        const rowsForPv = groupedByPv[pvKey] ?? [];
        if (rowsForPv.length === 0) {
          saldo_iniziale_by_pv[pvKey] = n(rowsBeforeFilterByPv[pvKey]);
          continue;
        }

        const firstFilteredDate =
          firstFilteredDateByPv[pvKey] || date_from || "";

        let selectedRow: BalanceStartRow | null = null;

        if (firstFilteredDate) {
          for (const row of rowsForPv) {
            const startDate = String(row?.start_date ?? "").trim();
            if (!startDate) continue;

            if (startDate <= firstFilteredDate) {
              selectedRow = row;
            }
          }
        }

        if (!selectedRow) {
          selectedRow = rowsForPv[rowsForPv.length - 1] ?? null;
        }

        const baseSaldo = selectedRow ? n(selectedRow.saldo_iniziale) : 0;
        const cumulativeBeforeFilter = n(rowsBeforeFilterByPv[pvKey]);

        saldo_iniziale_by_pv[pvKey] = baseSaldo + cumulativeBeforeFilter;
        balance_start_date_by_pv[pvKey] = String(selectedRow?.start_date ?? "").trim();
      }
    }

    const summaryIds = Array.from(
      new Set(rows.map((row: any) => String(row?.id ?? "").trim()).filter(Boolean))
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
      rows,
      saldo_iniziale_by_pv,
      balance_start_date_by_pv,
      checks_by_summary,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura riepiloghi" },
      { status: 500 }
    );
  }
}