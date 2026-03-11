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
    const id = String(searchParams.get("id") ?? "").trim();

    if (!isUuid(id)) {
      return NextResponse.json({ ok: false, error: "id non valido" }, { status: 400 });
    }

    const { data: summary, error: summaryErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select(`
        *,
        pvs:pvs!inner(
          id,
          code,
          name
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (summaryErr) {
      return NextResponse.json({ ok: false, error: summaryErr.message }, { status: 500 });
    }

    if (!summary) {
      return NextResponse.json({ ok: false, error: "Riepilogo non trovato" }, { status: 404 });
    }

    const { data: suppliers, error: suppliersErr } = await supabaseAdmin
      .from("pv_cash_supplier_payments")
      .select("*")
      .eq("summary_id", id)
      .order("created_at", { ascending: true });

    if (suppliersErr) {
      return NextResponse.json({ ok: false, error: suppliersErr.message }, { status: 500 });
    }

    const { data: fieldCommentsRows, error: fieldCommentsErr } = await supabaseAdmin
      .from("cash_summary_field_comments")
      .select("field_key, comment_text")
      .eq("summary_id", id);

    if (fieldCommentsErr) {
      return NextResponse.json({ ok: false, error: fieldCommentsErr.message }, { status: 500 });
    }

    const field_comments = (fieldCommentsRows ?? []).reduce(
      (acc: Record<string, string>, row: any) => {
        const fieldKey = String(row?.field_key ?? "").trim();
        const commentText = String(row?.comment_text ?? "").trim();

        if (!fieldKey) return acc;
        acc[fieldKey] = commentText;
        return acc;
      },
      {}
    );

    return NextResponse.json({
      ok: true,
      summary,
      suppliers: suppliers ?? [],
      field_comments,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura dettaglio riepilogo" },
      { status: 500 }
    );
  }
}