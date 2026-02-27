import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

function norm(v: any) {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);
    const from = norm(url.searchParams.get("from"));
    const to = norm(url.searchParams.get("to"));
    const pv_id_param = norm(url.searchParams.get("pv_id"));

    let pv_id: string | null = null;
    if (session.role === "punto_vendita") {
      const r = await getPvIdForSession(session);
      pv_id = r.pv_id;
      if (!pv_id) return NextResponse.json({ ok: false, error: "Utente PV senza pv_id" }, { status: 400 });
    } else {
      pv_id = pv_id_param || null;
    }

    let q = supabaseAdmin
      .from("waste_headers")
      .select(
        `id, pv_id, waste_date, operatore, created_by_username, created_at,
         pvs:pvs(code, name)`
      )
      .order("waste_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (pv_id) q = q.eq("pv_id", pv_id);
    if (from) q = q.gte("waste_date", from);
    if (to) q = q.lte("waste_date", to);

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Errore" }, { status: 500 });
  }
}
