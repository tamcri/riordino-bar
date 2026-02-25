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

// ✅ interpreta "" / "null" come NULL (Rapido: categoria = Nessuna/Tutte)
function normNullParam(v: string | null): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
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
  return (data as any)?.id ?? null;
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

  // ✅ Rapido: category_id può essere null (qs: omesso, "", "null")
  const category_id_raw = normNullParam(url.searchParams.get("category_id"));
  const category_id: string | null = category_id_raw;

  // ✅ subcategory: "" / "null" / omesso => null
  const subcategory_id_raw = normNullParam(url.searchParams.get("subcategory_id"));
  const subcategory_id: string | null = subcategory_id_raw;

  const inventory_date = (url.searchParams.get("inventory_date") || "").trim();

  // ✅ Standard: UUID obbligatorio; Rapido: NULL ammesso
  if (category_id !== null && !isUuid(category_id)) {
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
    if (!isUuid(effectivePvId)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  }

  // 1) meta: PV + category + subcategory names
  const pvRes = await supabaseAdmin.from("pvs").select("id, code, name").eq("id", effectivePvId).maybeSingle();
  if (pvRes.error) return NextResponse.json({ ok: false, error: pvRes.error.message }, { status: 500 });

  const pvLabel = pvRes.data ? `${(pvRes.data as any).code} — ${(pvRes.data as any).name}` : effectivePvId;

  // ✅ Categoria: se Rapido => "Tutte" e NON faccio query categories
  let categoryName = "Tutte";
  if (category_id) {
    const catRes = await supabaseAdmin.from("categories").select("id, name").eq("id", category_id).maybeSingle();
    if (catRes.error) return NextResponse.json({ ok: false, error: catRes.error.message }, { status: 500 });
    categoryName = (catRes.data as any)?.name ?? "";
  }

  // ✅ Sottocategoria: se null => "—"
  let subcategoryName = "—";
  if (subcategory_id) {
    const subRes = await supabaseAdmin.from("subcategories").select("id, name").eq("id", subcategory_id).maybeSingle();
    if (subRes.error) return NextResponse.json({ ok: false, error: subRes.error.message }, { status: 500 });
    subcategoryName = (subRes.data as any)?.name ?? "";
  }

  // 2) operatore dalla testata (prendo l’ultimo header per id)
  let hq = supabaseAdmin
    .from("inventories_headers")
    .select("id, operatore")
    .eq("pv_id", effectivePvId)
    .eq("inventory_date", inventory_date);

  if (category_id) hq = hq.eq("category_id", category_id);
  else hq = hq.is("category_id", null);

  if (subcategory_id) hq = hq.eq("subcategory_id", subcategory_id);
  else hq = hq.is("subcategory_id", null);

  const { data: header, error: headerErr } = await hq.order("id", { ascending: false }).limit(1).maybeSingle();
  if (headerErr) return NextResponse.json({ ok: false, error: headerErr.message }, { status: 500 });

  const operatore = ((header as any)?.operatore || "").toString().trim() || "—";

  // 3) righe inventario (senza join items: così poi possiamo risolvere categorie/sottocategorie)
  let q = supabaseAdmin
    .from("inventories")
    .select("item_id, qty, qty_gr, qty_ml, created_by_username")
    .eq("pv_id", effectivePvId)
    .eq("inventory_date", inventory_date);

  if (category_id) q = q.eq("category_id", category_id);
  else q = q.is("category_id", null);

  if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
  else q = q.is("subcategory_id", null);

  // ✅ PV: esporta solo il SUO inventario (evita mix con admin/amministrativo)
  if (session.role === "punto_vendita") {
    q = q.eq("created_by_username", session.username);
  }

  const { data: invRows, error: invErr } = await q;
  if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });

  const inv = (invRows || []) as any[];

  const itemIds = Array.from(
    new Set(
      inv
        .map((r) => String(r?.item_id ?? "").trim())
        .filter((id) => isUuid(id))
    )
  );

  // 4) items map (code/desc + category_id/subcategory_id)
  const itemsMap = new Map<
    string,
    { code: string; description: string; category_id: string | null; subcategory_id: string | null }
  >();

  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("items")
      .select("id, code, description, category_id, subcategory_id")
      .in("id", itemIds);

    if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

    for (const it of (items || []) as any[]) {
      const id = String(it?.id ?? "").trim();
      if (!isUuid(id)) continue;

      itemsMap.set(id, {
        code: String(it?.code ?? ""),
        description: String(it?.description ?? ""),
        category_id: it?.category_id ? String(it.category_id) : null,
        subcategory_id: it?.subcategory_id ? String(it.subcategory_id) : null,
      });
    }
  }

  // 5) risolvo nomi categoria/sottocategoria per i fogli
  const catIds = Array.from(
    new Set(
      Array.from(itemsMap.values())
        .map((x) => x.category_id)
        .filter((x): x is string => !!x && isUuid(x))
    )
  );

  const subIds = Array.from(
    new Set(
      Array.from(itemsMap.values())
        .map((x) => x.subcategory_id)
        .filter((x): x is string => !!x && isUuid(x))
    )
  );

  const catNameById = new Map<string, string>();
  const subNameById = new Map<string, string>();

  if (catIds.length > 0) {
    const { data: cats, error: catsErr } = await supabaseAdmin.from("categories").select("id, name").in("id", catIds);
    if (catsErr) return NextResponse.json({ ok: false, error: catsErr.message }, { status: 500 });

    for (const c of (cats || []) as any[]) {
      const id = String(c?.id ?? "").trim();
      if (!isUuid(id)) continue;
      catNameById.set(id, String(c?.name ?? "").trim());
    }
  }

  if (subIds.length > 0) {
    const { data: subs, error: subsErr } = await supabaseAdmin.from("subcategories").select("id, name").in("id", subIds);
    if (subsErr) return NextResponse.json({ ok: false, error: subsErr.message }, { status: 500 });

    for (const s of (subs || []) as any[]) {
      const id = String(s?.id ?? "").trim();
      if (!isUuid(id)) continue;
      subNameById.set(id, String(s?.name ?? "").trim());
    }
  }

  // 6) costruisco lines includendo category_name/subcategory_name per i fogli
  const lines = inv
    .map((r: any) => {
      const itemId = String(r?.item_id ?? "").trim();
      const it = itemsMap.get(itemId);

      const pz = Number(r?.qty ?? 0);
      const gr = Number(r?.qty_gr ?? 0);
      const ml = Number(r?.qty_ml ?? 0);

      const cid = it?.category_id ?? null;
      const sid = it?.subcategory_id ?? null;

      const cname = cid ? (catNameById.get(cid) || "") : "";
      const sname = sid ? (subNameById.get(sid) || "") : "";

      return {
        code: it?.code ?? "",
        description: it?.description ?? "",
        qty: Number.isFinite(pz) ? pz : 0,
        qty_gr: Number.isFinite(gr) ? gr : 0,
        qty_ml: Number.isFinite(ml) ? ml : 0,

        // ✅ per buildInventoryXlsx: fogli raggruppati
        category_name: cname || null,
        subcategory_name: sname || null,
      };
    })
    .filter((x: any) => {
      const pz = Number(x.qty || 0);
      const gr = Number(x.qty_gr || 0);
      const ml = Number(x.qty_ml || 0);
      return (Number.isFinite(pz) && pz > 0) || (Number.isFinite(gr) && gr > 0) || (Number.isFinite(ml) && ml > 0);
    });

  // ✅ ORDINAMENTO RICHIESTO: alfabetico per descrizione (case-insensitive, it)
  lines.sort((a: any, b: any) => {
    const da = String(a.description ?? "").trim();
    const db = String(b.description ?? "").trim();
    const cmp = da.localeCompare(db, "it", { sensitivity: "base" });
    if (cmp !== 0) return cmp;
    // fallback stabile: per codice
    return String(a.code ?? "").localeCompare(String(b.code ?? ""), "it", { sensitivity: "base" });
  });

  const xlsx = await buildInventoryXlsx(
    { inventoryDate: inventory_date, operatore, pvLabel, categoryName, subcategoryName },
    lines
  );

  const pvCode = (pvRes.data as any)?.code ?? "PV";
  const catSlug = category_id ? "CAT" : "TUTTE";
  const filename = `inventario_${pvCode}_${catSlug}_${inventory_date}.xlsx`;

  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}





