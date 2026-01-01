import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
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

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  const pv_id_qs = (url.searchParams.get("pv_id") || "").trim();
  const category_id = (url.searchParams.get("category_id") || "").trim();
  const subcategory_id = (url.searchParams.get("subcategory_id") || "").trim();
  const inventory_date = (url.searchParams.get("inventory_date") || "").trim(); // YYYY-MM-DD

  if (!isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }
  if (!inventory_date) {
    return NextResponse.json({ ok: false, error: "inventory_date mancante" }, { status: 400 });
  }

  // ✅ enforcement PV: se punto_vendita, ignoro pv_id in query e uso quello “suo”
  let effectivePvId = pv_id_qs;

  if (session.role === "punto_vendita") {
    try {
      effectivePvId = await requirePvIdForPuntoVendita(session.username);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message || "Non autorizzato" },
        { status: 401 }
      );
    }
  } else {
    // admin/amministrativo: pv_id obbligatorio
    if (!isUuid(effectivePvId)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }
  }

  let q = supabaseAdmin
    .from("inventories")
    .select(
      "id, item_id, qty, pv_id, category_id, subcategory_id, inventory_date, created_by_username, created_at, updated_at"
    )
    .eq("pv_id", effectivePvId)
    .eq("category_id", category_id)
    .eq("inventory_date", inventory_date);

  // ✅ IMPORTANTISSIMO:
  // il PV deve prefillare SOLO il SUO inventario (quello creato dal suo utente),
  // così non si “porta dietro” i numeri inseriti da admin/amministrativo sullo stesso PV.
  if (session.role === "punto_vendita") {
    q = q.eq("created_by_username", session.username);
  }

  // subcategory: se richiesta, filtro; se NON richiesta, voglio quelle con subcategory_id NULL
  if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
  else q = q.is("subcategory_id", null);

  const { data, error } = await q;

  if (error) {
    console.error("[inventories/rows] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data || [];
  const itemIds = Array.from(new Set(rows.map((r: any) => r.item_id))).filter(Boolean);

  if (itemIds.length === 0) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("items")
    .select("id, code, description")
    .in("id", itemIds);

  if (itemsErr) {
    return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
  }

  const itemMap = new Map<string, { code: string; description: string }>();
  (items || []).forEach((it: any) => itemMap.set(it.id, { code: it.code, description: it.description }));

  const out = rows
    .map((r: any) => ({
      id: r.id,
      item_id: r.item_id,
      code: itemMap.get(r.item_id)?.code ?? "",
      description: itemMap.get(r.item_id)?.description ?? "",
      qty: Number(r.qty ?? 0),
    }))
    .sort((a, b) => (a.code || "").localeCompare(b.code || ""));

  return NextResponse.json({ ok: true, rows: out });
}




