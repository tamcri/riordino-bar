import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(v: string | null | undefined) {
  if (!v) return false;

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function n(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanSupplierSearch(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type PvRelation =
  | {
      code?: string | null;
      name?: string | null;
    }
  | {
      code?: string | null;
      name?: string | null;
    }[]
  | null;

type SummaryRow = {
  id?: string | null;
  pv_id?: string | null;
  data?: string | null;
  is_closed?: boolean | null;
  pvs?: PvRelation;
};

type SupplierPaymentRow = {
  id?: string | null;
  summary_id?: string | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  amount?: number | string | null;
  created_at?: string | null;
};

function getPvRelation(pvs: PvRelation | undefined) {
  if (Array.isArray(pvs)) {
    return pvs[0] ?? null;
  }

  return pvs ?? null;
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json(
        { ok: false, error: "Non autorizzato" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);

    const pv_id = cleanText(searchParams.get("pv_id"));
    const date_from = cleanText(searchParams.get("date_from"));
    const date_to = cleanText(searchParams.get("date_to"));
    const supplier = cleanSupplierSearch(cleanText(searchParams.get("supplier")));

    if (pv_id && !isUuid(pv_id)) {
      return NextResponse.json(
        { ok: false, error: "pv_id non valido" },
        { status: 400 }
      );
    }

    let summariesQuery = supabaseAdmin
      .from("pv_cash_summaries")
      .select(
        `
        id,
        pv_id,
        data,
        is_closed,
        pvs:pvs!inner(
          code,
          name
        )
      `
      )
      .order("data", { ascending: false });

    if (pv_id) {
      summariesQuery = summariesQuery.eq("pv_id", pv_id);
    }

    if (date_from) {
      summariesQuery = summariesQuery.gte("data", date_from);
    }

    if (date_to) {
      summariesQuery = summariesQuery.lte("data", date_to);
    }

    const { data: summariesData, error: summariesError } = await summariesQuery;

    if (summariesError) {
      return NextResponse.json(
        { ok: false, error: summariesError.message },
        { status: 500 }
      );
    }

    const summaries = Array.isArray(summariesData)
      ? (summariesData as SummaryRow[])
      : [];

    const summaryIds = Array.from(
      new Set(
        summaries
          .map((row) => cleanText(row?.id))
          .filter(Boolean)
      )
    );

    if (summaryIds.length === 0) {
      return NextResponse.json({
        ok: true,
        rows: [],
      });
    }

    const summariesById = summaries.reduce(
      (acc: Record<string, SummaryRow>, row) => {
        const id = cleanText(row?.id);
        if (!id) return acc;

        acc[id] = row;
        return acc;
      },
      {}
    );

    let paymentsQuery = supabaseAdmin
      .from("pv_cash_supplier_payments")
      .select(
        `
        id,
        summary_id,
        supplier_code,
        supplier_name,
        amount,
        created_at
      `
      )
      .in("summary_id", summaryIds)
      .order("created_at", { ascending: false });

    if (supplier) {
      paymentsQuery = paymentsQuery.or(
        `supplier_code.ilike.%${supplier}%,supplier_name.ilike.%${supplier}%`
      );
    }

    const { data: paymentsData, error: paymentsError } = await paymentsQuery;

    if (paymentsError) {
      return NextResponse.json(
        { ok: false, error: paymentsError.message },
        { status: 500 }
      );
    }

    const payments = Array.isArray(paymentsData)
      ? (paymentsData as SupplierPaymentRow[])
      : [];

    const rows = payments
      .map((payment) => {
        const summaryId = cleanText(payment?.summary_id);
        const summary = summariesById[summaryId];

        if (!summary) return null;

        const pv = getPvRelation(summary?.pvs);
        const isClosed = Boolean(summary?.is_closed);

        return {
          id: cleanText(payment?.id),
          summary_id: summaryId,
          date: cleanText(summary?.data),
          pv_id: cleanText(summary?.pv_id),
          pv_code: cleanText(pv?.code),
          pv_name: cleanText(pv?.name),
          supplier_code: cleanText(payment?.supplier_code),
          supplier_name: cleanText(payment?.supplier_name),
          amount: n(payment?.amount),
          summary_status: isClosed ? "closed" : "open",
          is_closed: isClosed,
          created_at: cleanText(payment?.created_at),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const dateA = cleanText(a?.date);
        const dateB = cleanText(b?.date);

        if (dateA !== dateB) {
          return dateA < dateB ? 1 : -1;
        }

        const pvA = cleanText(a?.pv_code || a?.pv_name);
        const pvB = cleanText(b?.pv_code || b?.pv_name);

        if (pvA !== pvB) {
          return pvA.localeCompare(pvB);
        }

        const supplierA = cleanText(a?.supplier_name || a?.supplier_code);
        const supplierB = cleanText(b?.supplier_name || b?.supplier_code);

        return supplierA.localeCompare(supplierB);
      });

    return NextResponse.json({
      ok: true,
      rows,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore imprevisto durante il caricamento scarichi fornitori";

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}