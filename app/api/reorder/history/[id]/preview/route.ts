// app/api/reorder/history/[id]/preview/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type ReorderRow = {
  id: string;
  type: "TAB" | "GV";
  pv_label: string | null;
  weeks: number | null;
  days: number | null;

  created_at: string | null;
  created_by_username: string | null;

  tot_rows: number | null;
  tot_order_qty: number | null;
  tot_weight_kg: number | null;
  tot_value_eur: number | null;

  preview: any[] | null;
  preview_count: number | null;

  totals_by_item: any[] | null;
  totals_by_item_count: number | null;
};

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const id = String(ctx.params.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "ID mancante" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("reorders")
      .select(
        [
          "id",
          "type",
          "pv_label",
          "weeks",
          "days",
          "preview",
          "preview_count",
          "tot_rows",
          "tot_order_qty",
          "tot_weight_kg",
          "tot_value_eur",
          "totals_by_item",
          "totals_by_item_count",
          "created_at",
          "created_by_username",
        ].join(",")
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[reorder preview] db error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ ok: false, error: "Ordine non trovato" }, { status: 404 });

    // ✅ FIX TS: tipizzo in modo esplicito
    const row = data as unknown as ReorderRow;

    const preview = Array.isArray(row.preview) ? row.preview : [];
    const totalsByItem = Array.isArray(row.totals_by_item) ? row.totals_by_item : [];

    return NextResponse.json({
      ok: true,
      meta: {
        id: row.id,
        type: row.type,
        pv_label: row.pv_label,
        weeks: row.weeks,
        days: row.days,
        created_at: row.created_at,
        created_by_username: row.created_by_username,

        // ✅ TOT COMPLETI (fonte DB)
        tot_rows: row.tot_rows ?? null,
        tot_order_qty: row.tot_order_qty ?? null,
        tot_weight_kg: row.tot_weight_kg ?? null,
        tot_value_eur: row.tot_value_eur ?? null,

        // preview
        preview_count: row.preview_count ?? preview.length,

        // ✅ Totali per articolo (completi)
        totals_by_item_count: row.totals_by_item_count ?? totalsByItem.length,
      },

      // righe preview (max 200) salvate nel DB
      rows: preview,

      // tabella completa raggruppata salvata nel DB
      totals_by_item: totalsByItem,
    });
  } catch (e: any) {
    console.error("[reorder preview] FATAL:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Errore interno" }, { status: 500 });
  }
}


