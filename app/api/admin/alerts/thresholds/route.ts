// app/api/admin/alerts/thresholds/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * ⛔ Esclusioni: Tabacchi + Gratta e Vinci
 * Se i tuoi slug sono diversi, cambiali qui.
 */
const EXCLUDED_CATEGORY_SLUGS = ["tabacchi", "gratta-e-vinci", "grattaevinci", "gratta_vinci"];

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

async function getExcludedCategoryIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id, slug")
    .in("slug", EXCLUDED_CATEGORY_SLUGS);

  if (error) throw new Error(error.message);
  return (data || []).map((x: any) => String(x.id));
}

function jsonOk(payload: any, init?: number) {
  return NextResponse.json(payload, { status: init ?? 200 });
}

function jsonErr(msg: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: msg, ...(extra || {}) }, { status });
}

/**
 * GET
 * - /api/admin/alerts/thresholds            -> lista soglie (con join items)
 * - /api/admin/alerts/thresholds?q=...      -> ricerca items per aggiungere soglia
 *
 * POST
 * - upsert soglia (global o per pv)
 *
 * DELETE
 * - elimina soglia per id
 */
export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") return jsonErr("Non autorizzato", 401);

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const pv_id = (url.searchParams.get("pv_id") ?? "").trim() || null;

  if (pv_id && !isUuid(pv_id)) return jsonErr("pv_id non valido", 400);

  // ---- MODE: search items
  if (q) {
    let excludedIds: string[] = [];
    try {
      excludedIds = await getExcludedCategoryIds();
    } catch (e: any) {
      return jsonErr("Errore lettura categorie escluse", 500, { details: e?.message });
    }

    const qq = q.replace(/[%_]/g, ""); // evita wildcard strani

    const { data, error } = await supabaseAdmin
      .from("items")
      .select("id, code, description, category_id, categories:categories(id, slug, name)")
      .or(`code.ilike.%${qq}%,description.ilike.%${qq}%`)
      .not("category_id", "in", `(${excludedIds.join(",") || "00000000-0000-0000-0000-000000000000"})`)
      .order("code", { ascending: true })
      .limit(25);

    if (error) return jsonErr(error.message, 500);

    return jsonOk({ ok: true, mode: "items-search", q, items: data || [] });
  }

  // ---- MODE: list thresholds
  let excludedIds: string[] = [];
  try {
    excludedIds = await getExcludedCategoryIds();
  } catch (e: any) {
    return jsonErr("Errore lettura categorie escluse", 500, { details: e?.message });
  }

  let query = supabaseAdmin
    .from("alert_thresholds")
    .select(
      `
      id,
      pv_id,
      item_id,
      min_qty,
      note,
      created_at,
      updated_at,
      items:items(
        id,
        code,
        description,
        category_id,
        volume_ml_per_unit,
        categories:categories(id, slug, name)
      )
    `
    )
    .order("updated_at", { ascending: false });

  if (pv_id) query = query.eq("pv_id", pv_id);
  else query = query.is("pv_id", null);

  // escludo soglie legate ad items in categorie escluse
  query = query.not("items.category_id", "in", `(${excludedIds.join(",") || "00000000-0000-0000-0000-000000000000"})`);

  const { data, error } = await query;
  if (error) return jsonErr(error.message, 500);

  return jsonOk({
    ok: true,
    mode: "thresholds",
    pv_id: pv_id ?? null,
    excluded_category_slugs: EXCLUDED_CATEGORY_SLUGS,
    rows: data || [],
  });
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") return jsonErr("Non autorizzato", 401);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonErr("Body JSON non valido", 400);
  }

  const pv_id = (body?.pv_id ?? null) as string | null;
  const item_id = String(body?.item_id ?? "").trim();
  const min_qty = Number(body?.min_qty);
  const note = (body?.note ?? "").toString();

  if (pv_id && !isUuid(pv_id)) return jsonErr("pv_id non valido", 400);
  if (!isUuid(item_id)) return jsonErr("item_id non valido", 400);
  if (!Number.isFinite(min_qty) || min_qty < 0) return jsonErr("min_qty non valido (>= 0)", 400);

  // blocco esplicito per categorie escluse (extra safety)
  try {
    const excludedIds = await getExcludedCategoryIds();
    const { data: it, error: itErr } = await supabaseAdmin
      .from("items")
      .select("id, category_id")
      .eq("id", item_id)
      .maybeSingle();

    if (itErr) return jsonErr(itErr.message, 500);
    if (!it) return jsonErr("Item non trovato", 404);
    if (excludedIds.includes(String((it as any).category_id))) {
      return jsonErr("Item in categoria esclusa (Tabacchi / Gratta e Vinci)", 400);
    }
  } catch (e: any) {
    return jsonErr("Errore verifica categoria item", 500, { details: e?.message });
  }

  const now = new Date().toISOString();

  // Upsert con vincolo logico:
  // - per pv_id NULL: una soglia per item
  // - per pv_id valorizzato: una soglia per (pv_id, item)
  // => i vincoli/indici li mettiamo via SQL (sotto).
  const payload = {
    pv_id: pv_id ?? null,
    item_id,
    min_qty: Math.trunc(min_qty),
    note: note?.trim() || null,
    updated_at: now,
  };

  // Tentiamo prima UPDATE se esiste già, altrimenti INSERT.
  // (Così non dipendiamo al 100% da onConflict, che spesso rompe su vincoli parziali.)
  let existingQ = supabaseAdmin.from("alert_thresholds").select("id").eq("item_id", item_id);
  if (pv_id) existingQ = existingQ.eq("pv_id", pv_id);
  else existingQ = existingQ.is("pv_id", null);

  const { data: existing, error: exErr } = await existingQ.limit(1);
  if (exErr) return jsonErr(exErr.message, 500);

  if (existing && existing[0]?.id) {
    const { data: upd, error: updErr } = await supabaseAdmin
      .from("alert_thresholds")
      .update(payload)
      .eq("id", String(existing[0].id))
      .select("id")
      .maybeSingle();

    if (updErr) return jsonErr(updErr.message, 500);
    return jsonOk({ ok: true, mode: "update", id: upd?.id });
  }

  const { data: ins, error: insErr } = await supabaseAdmin
    .from("alert_thresholds")
    .insert({ ...payload, created_at: now })
    .select("id")
    .maybeSingle();

  if (insErr) return jsonErr(insErr.message, 500);
  return jsonOk({ ok: true, mode: "insert", id: ins?.id });
}

export async function DELETE(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") return jsonErr("Non autorizzato", 401);

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!isUuid(id)) return jsonErr("id non valido", 400);

  const { error } = await supabaseAdmin.from("alert_thresholds").delete().eq("id", id);
  if (error) return jsonErr(error.message, 500);

  return jsonOk({ ok: true });
}
