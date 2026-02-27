import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

type InventoryRow = {
  pv_id: string;
  category_id: string | null; // ✅ Rapido => NULL
  subcategory_id: string | null;
  rapid_session_id: string | null; // ✅ Rapido: distingue le sessioni
  inventory_date: string; // YYYY-MM-DD
  item_id: string;
  qty: number | null;
  qty_ml?: number | null;
  qty_gr?: number | null;
  created_by_username: string | null;
  created_at: string | null;
};

type InventoryHeaderRow = {
  id: string; // ✅ SERVE PER DELETE SICURA
  pv_id: string;
  category_id: string | null; // ✅ Rapido => NULL
  subcategory_id: string | null;
  rapid_session_id: string | null;
  inventory_date: string; // YYYY-MM-DD
  operatore: string | null;
  label: string | null;
  created_by_username?: string | null;
  updated_at: string | null;
};

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function makeKey(
  pv_id: string,
  category_id: string | null,
  subcategory_id: string | null,
  inventory_date: string,
  rapid_session_id?: string | null
) {
  const cat = category_id ?? "__NULL__";
  const sub = subcategory_id ?? "__NULL__";

  // ✅ Rapido: la chiave DEVE includere la sessione
  if (category_id === null) {
    const rs = (rapid_session_id || "").trim() || "__NOSESSION__";
    return `${pv_id}|${cat}|${sub}|${inventory_date}|${rs}`;
  }

  return `${pv_id}|${cat}|${sub}|${inventory_date}`;
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);

    // ✅ distinzione fondamentale:
    // - se category_id NON è presente -> nessun filtro
    // - se category_id è presente ma vuoto -> Rapido (NULL)
    // - se category_id è UUID -> filtro UUID
    const hasCategoryParam = url.searchParams.has("category_id");
    const category_qs_raw = url.searchParams.get("category_id");
    const categoryTrimmed = (category_qs_raw ?? "").trim();
    const categoryLower = categoryTrimmed.toLowerCase();

    // ✅ supporto robusto:
    // - assente => nessun filtro
    // - "" oppure "null" => Rapido / NULL
    // - UUID => filtro UUID
    const category_id_filter: string | null | undefined = !hasCategoryParam
      ? undefined
      : categoryTrimmed === "" || categoryLower === "null"
      ? null
      : categoryTrimmed;

    const pv_id_qs = (url.searchParams.get("pv_id") || "").trim();
    const subcategory_id = (url.searchParams.get("subcategory_id") || "").trim();

    const dateFrom = (url.searchParams.get("date_from") || url.searchParams.get("from") || "").trim();
    const dateTo = (url.searchParams.get("date_to") || url.searchParams.get("to") || "").trim();

    const limitRows = Math.min(Number(url.searchParams.get("limit") || 20000), 50000);

    // validazioni
    if (category_id_filter !== undefined && category_id_filter !== null && !isUuid(category_id_filter)) {
      return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
    }
    if (pv_id_qs && !isUuid(pv_id_qs)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }
    if (subcategory_id && !isUuid(subcategory_id)) {
      return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
    }

    // se chiedi subcategory devi avere category UUID (non Rapido e non "tutte")
    if (subcategory_id && (!hasCategoryParam || category_id_filter === null || category_id_filter === undefined)) {
      return NextResponse.json({ ok: false, error: "subcategory_id richiede anche category_id (UUID)" }, { status: 400 });
    }

    if (dateFrom && !isIsoDate(dateFrom)) {
      return NextResponse.json({ ok: false, error: "date_from/from non valido (usa YYYY-MM-DD)" }, { status: 400 });
    }
    if (dateTo && !isIsoDate(dateTo)) {
      return NextResponse.json({ ok: false, error: "date_to/to non valido (usa YYYY-MM-DD)" }, { status: 400 });
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json({ ok: false, error: "Intervallo date non valido: 'Dal' è dopo 'Al'." }, { status: 400 });
    }

    // enforcement PV
    let effectivePvId = pv_id_qs;
    if (session.role === "punto_vendita") {
      effectivePvId = await requirePvIdForPuntoVendita(session.username);
    }

    // 1) righe inventories
    let q = supabaseAdmin
      .from("inventories")
      .select("pv_id, category_id, subcategory_id, rapid_session_id, inventory_date, item_id, qty, qty_ml, qty_gr, created_by_username, created_at")
      .order("inventory_date", { ascending: false })
      .limit(limitRows);

    if (effectivePvId) q = q.eq("pv_id", effectivePvId);

    // ✅ filtro categoria SOLO se il parametro è presente
    if (category_id_filter === null) q = q.is("category_id", null);
    else if (typeof category_id_filter === "string") q = q.eq("category_id", category_id_filter);
    // else undefined => nessun filtro

    if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);

    if (dateFrom) q = q.gte("inventory_date", dateFrom);
    if (dateTo) q = q.lte("inventory_date", dateTo);

    const { data, error } = await q;

    if (error) {
      console.error("[inventories/list] error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const invRows = (Array.isArray(data) ? data : []) as InventoryRow[];

    // ✅ prezzi + volumi + peso_kg + um (per calcolo valore €)
    const itemIds = Array.from(new Set(invRows.map((r) => r.item_id).filter(Boolean)));
    const itemsMap = new Map<string, { prezzo: number; volume: number; peso_kg: number; um: string }>();

    if (itemIds.length) {
      const chunks = chunkArray(itemIds, 80);

      for (const part of chunks) {
        const { data: itemsData, error: itemsErr } = await supabaseAdmin
          .from("items")
          .select("id, prezzo_vendita_eur, volume_ml_per_unit, peso_kg, um")
          .in("id", part);

        if (itemsErr) {
          console.error("[inventories/list] items error:", itemsErr);
          return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
        }

        (itemsData || []).forEach((it: any) => {
          itemsMap.set(it.id, {
            prezzo: Number(it.prezzo_vendita_eur) || 0,
            volume: Number(it.volume_ml_per_unit) || 0,
            peso_kg: Number(it.peso_kg) || 0,
            um: String(it.um || "").toLowerCase(),
          });
        });
      }
    }

    type Group = {
      key: string;
      pv_id: string;
      category_id: string | null;
      subcategory_id: string | null;
      rapid_session_id: string | null; // ✅ Rapido
      inventory_date: string;
      created_by_username: string | null;
      created_at: string | null;
      lines_count: number;
      qty_sum: number;
      qty_ml_sum: number;
      qty_gr_sum: number;
      value_sum: number;
    };

    const groups = new Map<string, Group>();

    for (const r of invRows) {
      const qty = Number(r.qty ?? 0) || 0;
      const qty_ml = Number((r as any).qty_ml ?? 0) || 0;
      const qty_gr = Number((r as any).qty_gr ?? 0) || 0;

      if (qty <= 0 && qty_ml <= 0 && qty_gr <= 0) continue;

      const meta = itemsMap.get(r.item_id);
      const prezzo = meta?.prezzo ?? 0;
      const volume = meta?.volume ?? 0;
      const peso_kg = meta?.peso_kg ?? 0;
      const um = meta?.um ?? "";

      let rowValue = 0;

      if (prezzo > 0) {
        if (qty_ml > 0 && volume > 0) rowValue = (qty_ml / volume) * prezzo;
        else if (qty_gr > 0 && um === "kg") rowValue = (qty_gr / 1000) * prezzo;
        else if (qty_gr > 0 && peso_kg > 0) {
          const grPerUnit = peso_kg * 1000;
          if (grPerUnit > 0) rowValue = (qty_gr / grPerUnit) * prezzo;
        } else if (qty > 0) rowValue = qty * prezzo;
      }

      const key = makeKey(
        r.pv_id,
        r.category_id ?? null,
        r.subcategory_id ?? null,
        r.inventory_date,
        (r as any).rapid_session_id ?? null
      );

      const g = groups.get(key);
      if (!g) {
        groups.set(key, {
          key,
          pv_id: r.pv_id,
          category_id: r.category_id ?? null,
          subcategory_id: r.subcategory_id ?? null,
          rapid_session_id: (r as any).rapid_session_id ?? null,
          inventory_date: r.inventory_date,
          created_by_username: r.created_by_username ?? null,
          created_at: r.created_at ?? null,
          lines_count: 1,
          qty_sum: qty,
          qty_ml_sum: qty_ml,
          qty_gr_sum: qty_gr,
          value_sum: rowValue,
        });
      } else {
        g.lines_count += 1;
        g.qty_sum += qty;
        g.qty_ml_sum += qty_ml;
        g.qty_gr_sum += qty_gr;
        g.value_sum += rowValue;

        if (r.created_at && (!g.created_at || r.created_at > g.created_at)) {
          g.created_at = r.created_at;
          g.created_by_username = r.created_by_username ?? g.created_by_username;
        }
      }
    }

    const list = Array.from(groups.values());
    if (list.length === 0) return NextResponse.json({ ok: true, rows: [] });

    // headers operatore + label + rapid_session_id + (✅ id header)
    let hq = supabaseAdmin
      .from("inventories_headers")
      .select("id, pv_id, category_id, subcategory_id, inventory_date, operatore, label, rapid_session_id, created_by_username, updated_at");

    if (effectivePvId) hq = hq.eq("pv_id", effectivePvId);

    // ✅ filtro categoria SOLO se parametro presente
    if (category_id_filter === null) hq = hq.is("category_id", null);
    else if (typeof category_id_filter === "string") hq = hq.eq("category_id", category_id_filter);

    if (subcategory_id) hq = hq.eq("subcategory_id", subcategory_id);
    if (dateFrom) hq = hq.gte("inventory_date", dateFrom);
    if (dateTo) hq = hq.lte("inventory_date", dateTo);

    const { data: headersData, error: headersErr } = await hq;
    if (headersErr) {
      console.error("[inventories/list] headers error:", headersErr);
      return NextResponse.json({ ok: false, error: headersErr.message }, { status: 500 });
    }

    const headers = (Array.isArray(headersData) ? headersData : []) as InventoryHeaderRow[];

    const headerMap = new Map<
      string,
      {
        header_id: string | null;
        operatore: string | null;
        label: string | null;
        rapid_session_id: string | null;
        updated_at: string | null;
      }
    >();

    for (const h of headers) {
  const k = makeKey(
    h.pv_id,
    h.category_id ?? null,
    h.subcategory_id ?? null,
    h.inventory_date,
    (h as any).rapid_session_id ?? null
  );

  headerMap.set(k, {
  header_id: (h as any).id ?? null, // ✅ AGGIUNGI QUESTA RIGA
  operatore: (h.operatore ?? "").trim() || null,
  label: String(h.label ?? "").trim() || null,
  rapid_session_id: String((h as any).rapid_session_id ?? "").trim() || null,
  updated_at: (h as any).updated_at ?? null,
});
}

    // nomi PV/CAT/SUB
    const pvIds = Array.from(new Set(list.map((x) => x.pv_id)));
    const catIds = Array.from(new Set(list.map((x) => x.category_id).filter((x): x is string => !!x)));
    const subIds = Array.from(new Set(list.map((x) => x.subcategory_id).filter((x): x is string => !!x)));

    const [pvsRes, catsRes, subsRes] = await Promise.all([
      pvIds.length ? supabaseAdmin.from("pvs").select("id, code, name").in("id", pvIds) : Promise.resolve({ data: [], error: null } as any),
      catIds.length ? supabaseAdmin.from("categories").select("id, name").in("id", catIds) : Promise.resolve({ data: [], error: null } as any),
      subIds.length ? supabaseAdmin.from("subcategories").select("id, name, category_id").in("id", subIds) : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (pvsRes.error) return NextResponse.json({ ok: false, error: pvsRes.error.message }, { status: 500 });
    if (catsRes.error) return NextResponse.json({ ok: false, error: catsRes.error.message }, { status: 500 });
    if (subsRes.error) return NextResponse.json({ ok: false, error: subsRes.error.message }, { status: 500 });

    const pvMap = new Map<string, { code: string; name: string }>();
    (pvsRes.data || []).forEach((p: any) => pvMap.set(p.id, { code: p.code, name: p.name }));

    const catMap = new Map<string, { name: string }>();
    (catsRes.data || []).forEach((c: any) => catMap.set(c.id, { name: c.name }));

    const subMap = new Map<string, { name: string }>();
    (subsRes.data || []).forEach((s: any) => subMap.set(s.id, { name: s.name }));

    // sort
    list.sort((a, b) => {
      if (a.inventory_date !== b.inventory_date) return a.inventory_date < b.inventory_date ? 1 : -1;
      const ap = pvMap.get(a.pv_id)?.code ?? "";
      const bp = pvMap.get(b.pv_id)?.code ?? "";
      return ap.localeCompare(bp);
    });

    const out = list.map((g) => {
      const isRapid = g.category_id === null;
      const hm = headerMap.get(g.key) || null;

      return {
        // ✅ nuovo: id header per delete sicura
       header_id: hm?.header_id ?? null,
       id: hm?.header_id ?? null, // ✅ AGGIUNGI QUESTA RIGA

        key: g.key,
        pv_id: g.pv_id,
        pv_code: pvMap.get(g.pv_id)?.code ?? "",
        pv_name: pvMap.get(g.pv_id)?.name ?? "",
        category_id: g.category_id,
        category_name: isRapid ? "Nessuna (Tutte)" : catMap.get(g.category_id!)?.name ?? "",
        subcategory_id: g.subcategory_id,
        subcategory_name: g.subcategory_id ? subMap.get(g.subcategory_id)?.name ?? "" : "",
        inventory_date: g.inventory_date,
        created_by_username: g.created_by_username,
        updated_at: hm?.updated_at ?? null,
        lines_count: g.lines_count,
        qty_sum: g.qty_sum,
        qty_ml_sum: g.qty_ml_sum,
        qty_gr_sum: g.qty_gr_sum,
        value_sum: g.value_sum,
        operatore: hm?.operatore ?? null,
        label: hm?.label ?? null,
        rapid_session_id: hm?.rapid_session_id ?? g.rapid_session_id ?? null,
      };
    });

    return NextResponse.json({ ok: true, rows: out });
  } catch (e: any) {
    console.error("[inventories/list] UNCAUGHT", e);
    return NextResponse.json({ ok: false, error: e?.message || "Errore server" }, { status: 500 });
  }
}













