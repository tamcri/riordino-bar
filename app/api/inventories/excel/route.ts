// app/api/inventories/excel/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildInventoryXlsx } from "@/lib/excel/inventory";

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

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  const pv_id_qs = (url.searchParams.get("pv_id") || "").trim();
  const category_id = (url.searchParams.get("category_id") || "").trim();
  const subcategory_id = (url.searchParams.get("subcategory_id") || "").trim();
  const inventory_date = (url.searchParams.get("inventory_date") || "").trim();

  if (!isUuid(category_id)) return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  if (subcategory_id && !isUuid(subcategory_id)) return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  if (!isIsoDate(inventory_date)) return NextResponse.json({ ok: false, error: "inventory_date non valida (YYYY-MM-DD)" }, { status: 400 });

  // PV enforcement
  let effectivePvId = pv_id_qs;
  if (session.role === "punto_vendita") {
    try {
      effectivePvId = await requirePvIdForPuntoVendita(session.username);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || "Non autorizzato" }, { status: 401 });
    }
  } else {
    if (!isUuid(effectivePvId)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  }

  // 1) meta: PV + category + subcategory names
  const [pvRes, catRes, subRes] = await Promise.all([
    supabaseAdmin.from("pvs").select("id, code, name").eq("id", effectivePvId).maybeSingle(),
    supabaseAdmin.from("categories").select("id, name").eq("id", category_id).maybeSingle(),
    subcategory_id
      ? supabaseAdmin.from("subcategories").select("id, name").eq("id", subcategory_id).maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
  ]);

  if (pvRes.error) return NextResponse.json({ ok: false, error: pvRes.error.message }, { status: 500 });
  if (catRes.error) return NextResponse.json({ ok: false, error: catRes.error.message }, { status: 500 });
  if (subRes?.error) return NextResponse.json({ ok: false, error: subRes.error.message }, { status: 500 });

  const pvLabel = pvRes.data ? `${pvRes.data.code} — ${pvRes.data.name}` : effectivePvId;
  const categoryName = catRes.data?.name ?? "";
  const subcategoryName = subcategory_id ? (subRes.data?.name ?? "") : "—";

  // 2) operatore dalla testata (prendo l’ultimo header per id)
  let hq = supabaseAdmin
    .from("inventories_headers")
    .select("id, operatore")
    .eq("pv_id", effectivePvId)
    .eq("category_id", category_id)
    .eq("inventory_date", inventory_date);

  if (subcategory_id) hq = hq.eq("subcategory_id", subcategory_id);
  else hq = hq.is("subcategory_id", null);

  const { data: header, error: headerErr } = await hq.order("id", { ascending: false }).limit(1).maybeSingle();
  if (headerErr) return NextResponse.json({ ok: false, error: headerErr.message }, { status: 500 });

  const operatore = (header?.operatore || "").toString().trim() || "—";

  // 3) righe inventario + join items
  let q = supabaseAdmin
    .from("inventories")
    .select("item_id, qty, created_by_username, items:items(code, description)")
    .eq("pv_id", effectivePvId)
    .eq("category_id", category_id)
    .eq("inventory_date", inventory_date);

  // ✅ PV: esporta solo il SUO inventario (evita mix con admin/amministrativo)
  if (session.role === "punto_vendita") {
    q = q.eq("created_by_username", session.username);
  }

  if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
  else q = q.is("subcategory_id", null);

  const { data: invRows, error: invErr } = await q;
  if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });

  // ✅ SOLO QTY > 0
  const lines = ((invRows || []) as any[])
    .map((r: any) => ({
      code: r?.items?.code ?? "",
      description: r?.items?.description ?? "",
      qty: Number(r?.qty ?? 0),
    }))
    .filter((x) => Number.isFinite(x.qty) && x.qty > 0);

  lines.sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));

  const xlsx = await buildInventoryXlsx(
    { inventoryDate: inventory_date, operatore, pvLabel, categoryName, subcategoryName },
    lines
  );

  const filename = `inventario_${pvRes.data?.code ?? "PV"}_${inventory_date}.xlsx`;

  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}




