import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

function isIsoDate(v: string | null | undefined) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può accedere" },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);

    const dateFrom = norm(searchParams.get("date_from"));
    const dateTo = norm(searchParams.get("date_to"));
    const q = norm(searchParams.get("q")).toLowerCase();

    let query = supabaseAdmin
      .from("warehouse_inventory_headers")
      .select(
        `
        id,
        inventory_date,
        operatore,
        notes,
        created_by_username,
        created_at,
        updated_at
      `
      )
      .order("inventory_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (dateFrom) {
      if (!isIsoDate(dateFrom)) {
        return NextResponse.json(
          { ok: false, error: "date_from non valida (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      query = query.gte("inventory_date", dateFrom);
    }

    if (dateTo) {
      if (!isIsoDate(dateTo)) {
        return NextResponse.json(
          { ok: false, error: "date_to non valida (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      query = query.lte("inventory_date", dateTo);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    let headers = Array.isArray(data) ? data : [];

    if (q && q.length >= 2) {
      headers = headers.filter((row: any) => {
        const operatore = String(row?.operatore ?? "").toLowerCase();
        const notes = String(row?.notes ?? "").toLowerCase();
        const createdBy = String(row?.created_by_username ?? "").toLowerCase();

        return (
          operatore.includes(q) ||
          notes.includes(q) ||
          createdBy.includes(q)
        );
      });
    }

    const headerIds = headers
      .map((row: any) => String(row?.id ?? "").trim())
      .filter(Boolean);

    let rowsCountMap = new Map<string, number>();

    if (headerIds.length > 0) {
      const { data: rowsData, error: rowsErr } = await supabaseAdmin
        .from("warehouse_inventory_rows")
        .select("header_id")
        .in("header_id", headerIds);

      if (rowsErr) {
        return NextResponse.json({ ok: false, error: rowsErr.message }, { status: 500 });
      }

      rowsCountMap = new Map<string, number>();

      for (const row of rowsData || []) {
        const headerId = String((row as any)?.header_id ?? "").trim();
        if (!headerId) continue;
        rowsCountMap.set(headerId, (rowsCountMap.get(headerId) ?? 0) + 1);
      }
    }

    const rows = headers.map((row: any) => ({
      id: row.id,
      inventory_date: row.inventory_date,
      operatore: row.operatore ?? null,
      notes: row.notes ?? null,
      created_by_username: row.created_by_username ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      rows_count: rowsCountMap.get(String(row.id)) ?? 0,
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}