import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

const USER_TABLE_CANDIDATES = ["app_user", "app_users", "utenti", "users"];

async function lookupPvIdFromUserTables(username: string): Promise<string | null> {
  for (const table of USER_TABLE_CANDIDATES) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("pv_id")
      .eq("username", username)
      .maybeSingle();

    if (error) continue;
    const pv_id = (data as any)?.pv_id ?? null;
    if (pv_id && isUuid(pv_id)) return pv_id;
    return null;
  }
  return null;
}

async function lookupPvIdFromUsernameCode(username: string): Promise<string | null> {
  const code = (username || "").trim().split(/\s+/)[0]?.toUpperCase();
  if (!code || code.length > 5) return null;

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("id")
    .eq("is_active", true)
    .eq("code", code)
    .maybeSingle();

  if (error) return null;
  return data?.id ?? null;
}

async function requirePvIdForPuntoVendita(username: string): Promise<string> {
  const pvFromUsers = await lookupPvIdFromUserTables(username);
  if (pvFromUsers) return pvFromUsers;

  const pvFromCode = await lookupPvIdFromUsernameCode(username);
  if (pvFromCode) return pvFromCode;

  throw new Error("Utente punto vendita senza PV assegnato (pv_id mancante).");
}

type InventoryRow = {
  pv_id: string;
  category_id: string;
  subcategory_id: string | null;
  inventory_date: string; // YYYY-MM-DD
  qty: number | null;
  created_by_username: string | null;
  created_at: string | null;
};

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  // ✅ ora permettiamo anche punto_vendita
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const category_id = (url.searchParams.get("category_id") || "").trim(); // opzionale
  const pv_id_qs = (url.searchParams.get("pv_id") || "").trim(); // opzionale (IGNORATO per PV)
  const subcategory_id = (url.searchParams.get("subcategory_id") || "").trim();
  const from = (url.searchParams.get("from") || "").trim(); // opzionale
  const to = (url.searchParams.get("to") || "").trim(); // opzionale
  const limitRows = Math.min(Number(url.searchParams.get("limit") || 8000), 20000);

  // ✅ validazioni
  if (category_id && !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }
  if (pv_id_qs && !isUuid(pv_id_qs)) {
    return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }

  // ✅ subcategory ha senso solo se c’è category
  if (subcategory_id && !category_id) {
    return NextResponse.json({ ok: false, error: "subcategory_id richiede anche category_id" }, { status: 400 });
  }

  // ✅ enforcement PV: se punto_vendita, forzo pv_id dall’utente loggato
  let effectivePvId = pv_id_qs;
  if (session.role === "punto_vendita") {
    try {
      effectivePvId = await requirePvIdForPuntoVendita(session.username);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || "Non autorizzato" }, { status: 401 });
    }
  }

  let q = supabaseAdmin
    .from("inventories")
    .select("pv_id, category_id, subcategory_id, inventory_date, qty, created_by_username, created_at")
    .limit(limitRows);

  // filtri opzionali
  if (category_id) q = q.eq("category_id", category_id);
  if (effectivePvId) q = q.eq("pv_id", effectivePvId);
  if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);

  // filtri data opzionali (YYYY-MM-DD)
  if (from) q = q.gte("inventory_date", from);
  if (to) q = q.lte("inventory_date", to);

  const { data, error } = await q;

  if (error) {
    console.error("[inventories/list] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data || []) as InventoryRow[];

  // raggruppo lato server
  type Group = {
    key: string;
    pv_id: string;
    category_id: string;
    subcategory_id: string | null;
    inventory_date: string;
    created_by_username: string | null;
    created_at: string | null;
    lines_count: number;
    qty_sum: number;
  };

  const groups = new Map<string, Group>();

  for (const r of rows) {
    const key = `${r.pv_id}|${r.category_id}|${r.subcategory_id ?? ""}|${r.inventory_date}`;
    const qty = Number(r.qty ?? 0);

    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        key,
        pv_id: r.pv_id,
        category_id: r.category_id,
        subcategory_id: r.subcategory_id ?? null,
        inventory_date: r.inventory_date,
        created_by_username: r.created_by_username ?? null,
        created_at: r.created_at ?? null,
        lines_count: 1,
        qty_sum: qty,
      });
    } else {
      g.lines_count += 1;
      g.qty_sum += qty;

      // tieni il created_at massimo come “ultimo aggiornamento”
      if (r.created_at && (!g.created_at || r.created_at > g.created_at)) {
        g.created_at = r.created_at;
        g.created_by_username = r.created_by_username ?? g.created_by_username;
      }
    }
  }

  const list = Array.from(groups.values());

  if (list.length === 0) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  // enrich: PV + Category names
  const pvIds = Array.from(new Set(list.map((x) => x.pv_id)));
  const catIds = Array.from(new Set(list.map((x) => x.category_id)));
  const subIds = Array.from(new Set(list.map((x) => x.subcategory_id).filter(Boolean))) as string[];

  const [pvsRes, catsRes, subsRes] = await Promise.all([
    pvIds.length
      ? supabaseAdmin.from("pvs").select("id, code, name").in("id", pvIds)
      : Promise.resolve({ data: [], error: null } as any),
    catIds.length
      ? supabaseAdmin.from("categories").select("id, name").in("id", catIds)
      : Promise.resolve({ data: [], error: null } as any),
    subIds.length
      ? supabaseAdmin.from("subcategories").select("id, name, category_id").in("id", subIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (pvsRes.error) return NextResponse.json({ ok: false, error: pvsRes.error.message }, { status: 500 });
  if (catsRes.error) return NextResponse.json({ ok: false, error: catsRes.error.message }, { status: 500 });
  // @ts-ignore
  if (subsRes?.error) return NextResponse.json({ ok: false, error: subsRes.error.message }, { status: 500 });

  const pvMap = new Map<string, { code: string; name: string }>();
  (pvsRes.data || []).forEach((p: any) => pvMap.set(p.id, { code: p.code, name: p.name }));

  const catMap = new Map<string, { name: string }>();
  (catsRes.data || []).forEach((c: any) => catMap.set(c.id, { name: c.name }));

  const subMap = new Map<string, { name: string }>();
  // @ts-ignore
  (subsRes?.data || []).forEach((s: any) => subMap.set(s.id, { name: s.name }));

  // sort: più recenti prima, poi PV code
  list.sort((a, b) => {
    if (a.inventory_date !== b.inventory_date) return a.inventory_date < b.inventory_date ? 1 : -1;
    const ap = pvMap.get(a.pv_id)?.code ?? "";
    const bp = pvMap.get(b.pv_id)?.code ?? "";
    return ap.localeCompare(bp);
  });

  const out = list.map((g) => ({
    key: g.key,
    pv_id: g.pv_id,
    pv_code: pvMap.get(g.pv_id)?.code ?? "",
    pv_name: pvMap.get(g.pv_id)?.name ?? "",
    category_id: g.category_id,
    category_name: catMap.get(g.category_id)?.name ?? "",
    subcategory_id: g.subcategory_id,
    subcategory_name: g.subcategory_id ? subMap.get(g.subcategory_id)?.name ?? "" : "",
    inventory_date: g.inventory_date,
    created_by_username: g.created_by_username,
    created_at: g.created_at,
    lines_count: g.lines_count,
    qty_sum: g.qty_sum,
  }));

  return NextResponse.json({ ok: true, rows: out });
}



