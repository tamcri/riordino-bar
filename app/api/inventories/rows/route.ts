// app/api/inventories/rows/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
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

const USER_TABLE_CANDIDATES = ["app_user", "app_users", "utenti", "users"];

async function lookupPvIdFromUserTables(username: string): Promise<string | null> {
  for (const table of USER_TABLE_CANDIDATES) {
    const { data, error } = await supabaseAdmin.from(table).select("pv_id").eq("username", username).maybeSingle();
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

function clampInt(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.trunc(x));
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
  if (!isIsoDate(inventory_date)) {
    return NextResponse.json({ ok: false, error: "inventory_date non valida (YYYY-MM-DD)" }, { status: 400 });
  }

  // PV enforcement
  let effectivePvId = pv_id_qs;

  if (session.role === "punto_vendita") {
    try {
      effectivePvId = await requirePvIdForPuntoVendita(session.username);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || "Non autorizzato" }, { status: 401 });
    }
  } else {
    if (!isUuid(effectivePvId)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }
  }

  try {
    let q = supabaseAdmin
      .from("inventories")
      .select(
        "id, item_id, qty, qty_ml, qty_gr, created_by_username, items:items(code, description, prezzo_vendita_eur, volume_ml_per_unit, peso_kg, um)"
      )
      .eq("pv_id", effectivePvId)
      .eq("category_id", category_id)
      .eq("inventory_date", inventory_date);

    if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
    else q = q.is("subcategory_id", null);

    const { data, error } = await q;

    if (error) {
      console.error("[inventories/rows] supabase error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (data || []) as any[];

    const out = rows
      .map((r: any) => {
        const qty = clampInt(r?.qty ?? 0);
        const qty_ml = clampInt(r?.qty_ml ?? 0);
        const qty_gr = clampInt(r?.qty_gr ?? 0);

        const volume = Number(r?.items?.volume_ml_per_unit ?? 0);
        const volume_ml_per_unit = Number.isFinite(volume) && volume > 0 ? Math.trunc(volume) : null;

        const um = String(r?.items?.um ?? "").toLowerCase();
        const peso_kg = Number(r?.items?.peso_kg ?? 0);
        const peso_kg_norm = Number.isFinite(peso_kg) && peso_kg > 0 ? peso_kg : null;

        const ml_mode: "mixed" | "fixed" | null =
          volume_ml_per_unit && volume_ml_per_unit > 0 ? (qty === 0 && qty_ml > 0 ? "mixed" : "fixed") : null;

        let ml_open: number | null = null;
        if (ml_mode === "fixed" && volume_ml_per_unit && volume_ml_per_unit > 0) {
          const calc = qty_ml - qty * volume_ml_per_unit;
          ml_open = Math.max(0, Math.trunc(calc));
        }

        return {
          id: r.id,
          item_id: r.item_id,
          code: r?.items?.code ?? "",
          description: r?.items?.description ?? "",
          qty,
          qty_gr,
          qty_ml,
          volume_ml_per_unit,
          ml_open,
          ml_mode,
          prezzo_vendita_eur: r?.items?.prezzo_vendita_eur ?? null,
          um,
          peso_kg: peso_kg_norm,
        };
      })
      .filter(
        (x) =>
          (Number.isFinite(x.qty) && x.qty > 0) ||
          (Number.isFinite(x.qty_ml) && x.qty_ml > 0) ||
          (Number.isFinite(x.qty_gr) && x.qty_gr > 0)
      )
      .sort((a, b) => (a.code || "").localeCompare(b.code || ""));

    return NextResponse.json({ ok: true, rows: out });
  } catch (e: any) {
    console.error("[inventories/rows] UNHANDLED ERROR:", e);
    return NextResponse.json({ ok: false, error: e?.message || "TypeError: fetch failed" }, { status: 500 });
  }
}


















