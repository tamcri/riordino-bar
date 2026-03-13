// app/api/inventories/rows/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v).trim()
  );
}

function isIsoDate(v: string | null | undefined) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
}

// "" / "null" => null
function normNullParam(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
}

// primo token, uppercase, no spaces
function normCode(v: any) {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  return raw.toUpperCase().replace(/\s+/g, " ").trim();
}

function clampInt(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.trunc(x));
}

// ✅ GR: niente limite “9999” (resto nel range int32 per sicurezza)
const MAX_GR = 1_000_000_000; // 1 miliardo di grammi = 1.000.000 kg
function clampGr(n: any) {
  return Math.min(MAX_GR, clampInt(n));
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);

    const pv_id = String(url.searchParams.get("pv_id") ?? "").trim();
    const inventory_date = String(url.searchParams.get("inventory_date") ?? "").trim();

    // category_id per /rows:
    // - "null" / "" => Rapido (NULL)
    // - UUID => Standard
    const categoryParamPresent = url.searchParams.has("category_id");
    const categoryRaw = String(url.searchParams.get("category_id") ?? "").trim();
    const categoryLower = categoryRaw.toLowerCase();

    const category_id = !categoryParamPresent
      ? null
      : categoryRaw === "" || categoryLower === "null"
      ? null
      : categoryRaw;

    const subcategory_id = normNullParam(url.searchParams.get("subcategory_id"));
    const rapid_session_id = normNullParam(url.searchParams.get("rapid_session_id"));

    if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    if (!isIsoDate(inventory_date)) {
      return NextResponse.json({ ok: false, error: "inventory_date non valida (YYYY-MM-DD)" }, { status: 400 });
    }
    if (category_id !== null && !isUuid(category_id)) {
      return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
    }
    if (subcategory_id !== null && !isUuid(subcategory_id)) {
      return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
    }
    if (rapid_session_id !== null && !isUuid(rapid_session_id)) {
      return NextResponse.json({ ok: false, error: "rapid_session_id non valido" }, { status: 400 });
    }

    const isRapidRequest = category_id === null;

    // ✅ Query base
    let q = supabaseAdmin
      .from("inventories")
      .select(
        `
        id,
        pv_id,
        category_id,
        subcategory_id,
        rapid_session_id,
        inventory_date,
        item_id,
        qty,
        qty_gr,
        qty_ml,
        items:items!left(
          code,
          description,
          volume_ml_per_unit,
          prezzo_vendita_eur
        )
      `,
        { count: "exact" }
      )
      .eq("pv_id", pv_id)
      .eq("inventory_date", inventory_date);

    if (isRapidRequest) {
      // ✅ Rapido: filtro SOLO su category_id NULL e sessione
      // ❌ NON filtrare subcategory_id: i dati storici possono averla sporca e altrimenti perdi righe.
      q = q.is("category_id", null);

      if (rapid_session_id) {
  // ✅ Legacy fix: alcuni inventari vecchi hanno righe con rapid_session_id NULL
  // In riapertura vogliamo vedere TUTTE le righe dell’inventario (sessione + null)
  q = q.or(`rapid_session_id.eq.${rapid_session_id},rapid_session_id.is.null`);
} else {
  q = q.is("rapid_session_id", null);
}
    } else {
      // Standard
      q = q.eq("category_id", category_id);

      if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
      else q = q.is("subcategory_id", null);

      // Standard: rapid_session_id deve essere NULL
      q = q.is("rapid_session_id", null);
    }

    const { data, error, count } = await q;

    if (error) {
      console.error("[inventories/rows] error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = Array.isArray(data) ? (data as any[]) : [];

    const out = rows.map((r) => {
      const it = (r?.items ?? null) as any | null;

      const codeFromItem = normCode(it?.code ?? "");
      const fallbackCode = r?.item_id ? `NO_CODE_${String(r.item_id).slice(0, 8)}` : "NO_CODE";
      const code = codeFromItem || fallbackCode;

      const description = String(it?.description ?? "").trim() || "(descrizione mancante)";

      return {
        id: String(r?.id ?? ""),
        item_id: String(r?.item_id ?? ""),
        code,
        description,
        qty: clampInt(r?.qty ?? 0),
        qty_gr: clampGr(r?.qty_gr ?? 0),
        qty_ml: clampInt(r?.qty_ml ?? 0),
        volume_ml_per_unit: it?.volume_ml_per_unit ?? null,
        prezzo_vendita_eur: it?.prezzo_vendita_eur ?? null,
        _missing_code: !codeFromItem,
        _missing_item: !it,
        // ✅ utile: ti fa vedere se quelle 5 righe “misteriose” hanno subcategory valorizzata
        _subcategory_id: r?.subcategory_id ?? null,
      };
    });

    // header (operatore/label) best-effort
    let operatore_header: string | null = null;
    let label_header: string | null = null;

    try {
      let hq = supabaseAdmin
        .from("inventories_headers")
        .select("operatore,label")
        .eq("pv_id", pv_id)
        .eq("inventory_date", inventory_date);

      if (isRapidRequest) {
  hq = hq.is("category_id", null);

  if (rapid_session_id) {
    hq = hq.or(`rapid_session_id.eq.${rapid_session_id},rapid_session_id.is.null`);
  } else {
    hq = hq.is("rapid_session_id", null);
  }
} else {
        hq = hq.eq("category_id", category_id);
        if (subcategory_id) hq = hq.eq("subcategory_id", subcategory_id);
        else hq = hq.is("subcategory_id", null);
        hq = hq.is("rapid_session_id", null);
      }

      const { data: hdata } = await hq.maybeSingle();
      operatore_header = (hdata as any)?.operatore ?? null;
      label_header = (hdata as any)?.label ?? null;
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      rows: out,
      operatore: operatore_header,
      label: label_header,
      // ✅ debug count: se qui torna 64 abbiamo chiuso la storia
      db_count: count ?? null,
    });
  } catch (e: any) {
    console.error("[inventories/rows] UNHANDLED ERROR:", e);
    return NextResponse.json({ ok: false, error: e?.message || "TypeError: fetch failed" }, { status: 500 });
  }
}


















