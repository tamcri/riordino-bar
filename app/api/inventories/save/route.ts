import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Row = {
  item_id: string;
  qty: number;
};

type Body = {
  pv_id?: string;
  category_id?: string;
  subcategory_id?: string | null;
  inventory_date?: string; // YYYY-MM-DD
  rows?: Row[];
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function clampInt(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.trunc(x));
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

    // tabella trovata ma pv_id vuoto
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

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  // ✅ ora anche amministrativo può salvare (come da regole)
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });

  const category_id = body.category_id?.trim();
  const subcategory_id = (body.subcategory_id ?? null)?.toString().trim() || null;
  const inventory_date = (body.inventory_date || "").trim();

  // ✅ category obbligatoria
  if (!isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga da salvare" }, { status: 400 });
  }

  // Limite difensivo
  if (rows.length > 3000) {
    return NextResponse.json({ ok: false, error: "Troppe righe in un colpo (max 3000)" }, { status: 400 });
  }

  // Inventory date: se non arriva o è invalida, usa default DB
  const dateOrNull = inventory_date && /^\d{4}-\d{2}-\d{2}$/.test(inventory_date) ? inventory_date : null;

  // ✅ pv_id effettivo:
  // - admin/amministrativo: da body (obbligatorio)
  // - punto_vendita: IGNORA body.pv_id e prende dal profilo utente
  let pv_id: string | null = (body.pv_id || "").trim() || null;

  if (session.role === "punto_vendita") {
    try {
      pv_id = await requirePvIdForPuntoVendita(session.username);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || "Non autorizzato" }, { status: 401 });
    }
  } else {
    // admin/amministrativo: pv_id obbligatorio e valido
    if (!isUuid(pv_id)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }
  }

  if (!pv_id) {
    return NextResponse.json({ ok: false, error: "pv_id mancante" }, { status: 400 });
  }

  // Payload: upsert su (pv_id, item_id, inventory_date)
  const payload = rows
    .filter((r) => isUuid(r.item_id))
    .map((r) => ({
      pv_id,
      category_id,
      subcategory_id,
      item_id: r.item_id,
      qty: clampInt(r.qty),
      inventory_date: dateOrNull ?? undefined,
      created_by_username: session.username,
    }));

  if (payload.length === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga valida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("inventories")
    .upsert(payload as any, { onConflict: "pv_id,item_id,inventory_date" });

  if (error) {
    console.error("[inventories/save] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    saved: payload.length,
    pv_id,
    // se PV, chiarisco che pv_id è stato forzato lato server
    enforced_pv: session.role === "punto_vendita",
  });
}

