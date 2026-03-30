// app/api/inventories/delete/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function isIsoDate(v: string | null) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

// interpreta "" / "null" come NULL
function normNullParam(v: string | null): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
}

export async function DELETE(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  const header_id = (url.searchParams.get("header_id") || url.searchParams.get("id") || "").trim();

  const pv_id = (url.searchParams.get("pv_id") || "").trim();
  const category_id = normNullParam(url.searchParams.get("category_id"));
  const subcategory_id = normNullParam(url.searchParams.get("subcategory_id"));
  const inventory_date = (url.searchParams.get("inventory_date") || "").trim();

  if (header_id) {
    if (!isUuid(header_id)) {
      return NextResponse.json({ ok: false, error: "header_id non valido" }, { status: 400 });
    }

    const { data: head, error: headErr } = await supabaseAdmin
      .from("inventories_headers")
      .select("id, pv_id, category_id, subcategory_id, inventory_date, rapid_session_id, label")
      .eq("id", header_id)
      .maybeSingle();

    if (headErr) {
      return NextResponse.json({ ok: false, error: headErr.message }, { status: 500 });
    }

    if (!head?.id) {
      return NextResponse.json({
        ok: true,
        already_deleted: true,
        deleted: {
          inventories: 0,
          inventories_headers: 0,
          inventory_recount_events: 0,
          inventory_progressivi_rows: 0,
          progressivi_report_rows: 0,
          progressivi_report_headers: 0,
        },
        deleted_header: { id: header_id, label: null },
      });
    }

    const hpv = String((head as any).pv_id || "").trim();
    const hdate = String((head as any).inventory_date || "").trim();
    const hcat = (head as any).category_id as string | null;
    const hsub = (head as any).subcategory_id as string | null;
    const hrapid = (head as any).rapid_session_id as string | null;

    if (!isUuid(hpv) || !isIsoDate(hdate)) {
      return NextResponse.json(
        { ok: false, error: "Header corrotto: pv_id/inventory_date non validi" },
        { status: 500 }
      );
    }

    let delRowsQ = supabaseAdmin
      .from("inventories")
      .delete()
      .eq("pv_id", hpv)
      .eq("inventory_date", hdate);

    if (hcat) delRowsQ = delRowsQ.eq("category_id", hcat);
    else delRowsQ = delRowsQ.is("category_id", null);

    if (hsub) delRowsQ = delRowsQ.eq("subcategory_id", hsub);
    else delRowsQ = delRowsQ.is("subcategory_id", null);

    if (hrapid) delRowsQ = delRowsQ.eq("rapid_session_id", hrapid);
    else delRowsQ = delRowsQ.is("rapid_session_id", null);

    const { data: delRowsData, error: delRowsErr } = await delRowsQ.select("id");
    if (delRowsErr) {
      return NextResponse.json({ ok: false, error: delRowsErr.message }, { status: 500 });
    }
    const rowsDeleted = Array.isArray(delRowsData) ? delRowsData.length : 0;

    const { data: delRecountData, error: delRecountErr } = await supabaseAdmin
      .from("inventory_recount_events")
      .delete()
      .eq("inventory_header_id", header_id)
      .select("id");

    if (delRecountErr) {
      return NextResponse.json({ ok: false, error: delRecountErr.message }, { status: 500 });
    }
    const recountDeleted = Array.isArray(delRecountData) ? delRecountData.length : 0;

    const { data: delProgressiviData, error: delProgressiviErr } = await supabaseAdmin
      .from("inventory_progressivi_rows")
      .delete()
      .eq("inventory_header_id", header_id)
      .select("id");

    if (delProgressiviErr) {
      return NextResponse.json({ ok: false, error: delProgressiviErr.message }, { status: 500 });
    }
    const progressiviDeleted = Array.isArray(delProgressiviData) ? delProgressiviData.length : 0;

    const { data: reportHeadersData, error: reportHeadersErr } = await supabaseAdmin
      .from("progressivi_report_headers")
      .select("id")
      .or(`current_header_id.eq.${header_id},previous_header_id.eq.${header_id}`);

    if (reportHeadersErr) {
      return NextResponse.json({ ok: false, error: reportHeadersErr.message }, { status: 500 });
    }

    const reportHeaderIds = Array.from(
      new Set(
        (reportHeadersData ?? [])
          .map((row: any) => String(row?.id ?? "").trim())
          .filter(Boolean)
      )
    );

    let reportRowsDeleted = 0;
    let reportHeadersDeleted = 0;

    if (reportHeaderIds.length > 0) {
      const { data: delReportRowsData, error: delReportRowsErr } = await supabaseAdmin
        .from("progressivi_report_rows")
        .delete()
        .in("report_header_id", reportHeaderIds)
        .select("id");

      if (delReportRowsErr) {
        return NextResponse.json({ ok: false, error: delReportRowsErr.message }, { status: 500 });
      }
      reportRowsDeleted = Array.isArray(delReportRowsData) ? delReportRowsData.length : 0;

      const { data: delReportHeadersData, error: delReportHeadersErr } = await supabaseAdmin
        .from("progressivi_report_headers")
        .delete()
        .in("id", reportHeaderIds)
        .select("id");

      if (delReportHeadersErr) {
        return NextResponse.json({ ok: false, error: delReportHeadersErr.message }, { status: 500 });
      }
      reportHeadersDeleted = Array.isArray(delReportHeadersData) ? delReportHeadersData.length : 0;
    }

    const { data: delHeadData, error: delHeadErr } = await supabaseAdmin
      .from("inventories_headers")
      .delete()
      .eq("id", header_id)
      .select("id");

    if (delHeadErr) {
      return NextResponse.json({ ok: false, error: delHeadErr.message }, { status: 500 });
    }
    const headersDeleted = Array.isArray(delHeadData) ? delHeadData.length : 0;

    const alreadyDeletedByRace = headersDeleted === 0;

    const warnings: string[] = [];
    if (rowsDeleted === 0) {
      warnings.push(
        "Header eliminato, ma non risultano righe inventario eliminate (dati storici/filtri non allineati)."
      );
    }

    return NextResponse.json({
      ok: true,
      ...(alreadyDeletedByRace ? { already_deleted: true } : {}),
      deleted: {
        inventories: rowsDeleted,
        inventories_headers: headersDeleted,
        inventory_recount_events: recountDeleted,
        inventory_progressivi_rows: progressiviDeleted,
        progressivi_report_rows: reportRowsDeleted,
        progressivi_report_headers: reportHeadersDeleted,
      },
      deleted_header: {
        id: head.id,
        label: (head as any).label ?? null,
      },
      ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
    });
  }

  if (!isUuid(pv_id)) {
    return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  }

  if (category_id !== null && !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }

  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }

  if (!isIsoDate(inventory_date)) {
    return NextResponse.json({ ok: false, error: "inventory_date non valida (YYYY-MM-DD)" }, { status: 400 });
  }

  const baseFilter = (q: any) => {
    q = q.eq("pv_id", pv_id).eq("inventory_date", inventory_date);

    if (category_id) q = q.eq("category_id", category_id);
    else q = q.is("category_id", null);

    if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
    else q = q.is("subcategory_id", null);

    return q;
  };

  const { data: heads, error: headsErr } = await baseFilter(
    supabaseAdmin.from("inventories_headers").select("id, label, rapid_session_id")
  ).limit(5);

  if (headsErr) {
    return NextResponse.json({ ok: false, error: headsErr.message }, { status: 500 });
  }

  const countHeads = Array.isArray(heads) ? heads.length : 0;

  if (countHeads === 0) {
    return NextResponse.json({
      ok: true,
      already_deleted: true,
      deleted: {
        inventories: 0,
        inventories_headers: 0,
      },
    });
  }

  if (countHeads > 1) {
    return NextResponse.json(
      {
        ok: false,
        code: "DELETE_AMBIGUOUS",
        error:
          "Eliminazione bloccata: esistono più inventari per PV/Data/Categoria. Aggiorna la UI per passare header_id (eliminazione per inventario singolo).",
        hint: "Invia header_id nella query string: /api/inventories/delete?header_id=...",
      },
      { status: 409 }
    );
  }

  const rapid_session_id =
    (heads?.[0] as any)?.rapid_session_id
      ? String((heads?.[0] as any)?.rapid_session_id).trim()
      : "";

  let delRowsQ: any = baseFilter(supabaseAdmin.from("inventories").delete());
  if (rapid_session_id && isUuid(rapid_session_id)) {
    delRowsQ = delRowsQ.eq("rapid_session_id", rapid_session_id);
  } else {
    delRowsQ = delRowsQ.is("rapid_session_id", null);
  }

  const { data: delRowsData, error: delRowsErr } = await delRowsQ.select("id");
  if (delRowsErr) {
    return NextResponse.json({ ok: false, error: delRowsErr.message }, { status: 500 });
  }
  const rowsDeleted = Array.isArray(delRowsData) ? delRowsData.length : 0;

  const delHeadQ = baseFilter(supabaseAdmin.from("inventories_headers").delete());
  const { data: delHeadData, error: delHeadErr } = await delHeadQ.select("id");
  if (delHeadErr) {
    return NextResponse.json({ ok: false, error: delHeadErr.message }, { status: 500 });
  }
  const headersDeleted = Array.isArray(delHeadData) ? delHeadData.length : 0;

  return NextResponse.json({
    ok: true,
    deleted: {
      inventories: rowsDeleted,
      inventories_headers: headersDeleted,
    },
  });
}

