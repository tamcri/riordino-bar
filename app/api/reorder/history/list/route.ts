import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function parseISODateOnly(s: string | null): string | null {
  if (!s) return null;
  const v = String(s).trim();
  // accettiamo solo YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

export async function GET(req: Request) {
  const cookieStore = cookies();
  const session = parseSessionValue(cookieStore.get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  const type = (url.searchParams.get("type") || "ALL").toUpperCase(); // ALL|TAB|GV
  const pvId = (url.searchParams.get("pvId") || "").trim(); // uuid o ""
  const from = parseISODateOnly(url.searchParams.get("from")); // YYYY-MM-DD
  const to = parseISODateOnly(url.searchParams.get("to")); // YYYY-MM-DD

  let q = supabaseAdmin
    .from("reorders")
    .select(
      "id, created_at, created_by_username, created_by_role, pv_label, pv_id, type, weeks, tot_rows, tot_order_qty, tot_weight_kg, tot_value_eur"
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (type === "TAB" || type === "GV") q = q.eq("type", type);
  if (pvId) q = q.eq("pv_id", pvId);

  // from/to su created_at
  // from: >= YYYY-MM-DDT00:00:00.000Z (ma usiamo formato ISO senza timezone lato supabase)
  if (from) q = q.gte("created_at", `${from}T00:00:00`);
  // to: < giorno dopo (così include tutto il giorno "to")
  if (to) {
    const [y, m, d] = to.split("-").map((x) => Number(x));
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 1);
    const y2 = dt.getFullYear();
    const m2 = String(dt.getMonth() + 1).padStart(2, "0");
    const d2 = String(dt.getDate()).padStart(2, "0");
    q = q.lt("created_at", `${y2}-${m2}-${d2}T00:00:00`);
  }

  const { data, error } = await q;

  if (error) {
    console.error("[history/list] error:", error);
    return NextResponse.json({ ok: false, error: error.message || "Errore DB" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data || [] });
}


