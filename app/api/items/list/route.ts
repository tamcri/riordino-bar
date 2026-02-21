// app/api/items/list/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function normSearchText(q: string) {
  return q.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function extractDigits(q: string) {
  return q.replace(/[^\d]/g, "");
}

function looksLikeBarcode(digits: string) {
  return digits.length >= 8;
}

// ✅ interpreta "" / "null" come NULL
function normNullParam(v: string | null): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
}

async function findItemIdsByBarcodeLike(barcodeDigits: string): Promise<string[]> {
  const b = String(barcodeDigits || "").trim();
  if (!b) return [];

  try {
    const { data, error } = await supabaseAdmin
      .from("item_barcodes")
      .select("item_id")
      .or(`barcode.eq.${b},barcode.ilike.%${b}%`)
      .limit(1000);

    if (error) {
      console.warn("[items/list] item_barcodes lookup error (fallback):", error.message);
      return [];
    }

    const ids = Array.isArray(data)
      ? data.map((r: any) => String(r.item_id || "").trim()).filter(Boolean)
      : [];
    return Array.from(new Set(ids));
  } catch (e: any) {
    console.warn("[items/list] item_barcodes lookup exception (fallback):", e?.message || e);
    return [];
  }
}

async function loadBarcodesForItems(itemIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = Array.from(new Set((itemIds || []).map((x) => String(x || "").trim()).filter(Boolean)));
  if (ids.length === 0) return map;

  try {
    const { data, error } = await supabaseAdmin
      .from("item_barcodes")
      .select("item_id, barcode")
      .in("item_id", ids)
      .limit(20000);

    if (error) {
      console.warn("[items/list] item_barcodes load error (fallback):", error.message);
      return map;
    }

    for (const r of Array.isArray(data) ? data : []) {
      const itemId = String((r as any).item_id || "").trim();
      const bc = String((r as any).barcode || "").trim();
      if (!itemId || !bc) continue;

      const prev = map.get(itemId) || [];
      prev.push(bc);
      map.set(itemId, prev);
    }

    for (const [k, arr] of map.entries()) {
      map.set(k, Array.from(new Set(arr)));
    }

    return map;
  } catch (e: any) {
    console.warn("[items/list] item_barcodes load exception (fallback):", e?.message || e);
    return map;
  }
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  // ✅ Rapido: rapid=1 => non forzare TAB di default
  const rapid = String(url.searchParams.get("rapid") ?? "").trim();
  const isRapid = rapid === "1" || rapid.toLowerCase() === "true";

  // ✅ category_id/subcategory_id possono essere null/"null"/""
  const category_id = normNullParam(url.searchParams.get("category_id"));
  const subcategory_id = normNullParam(url.searchParams.get("subcategory_id"));

  const legacyCategory = (url.searchParams.get("category") || "").trim().toUpperCase(); // TAB | GV

  const qRaw = (url.searchParams.get("q") || "").trim();
  const active = (url.searchParams.get("active") || "1").toLowerCase(); // 1 | 0 | all

  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);

  if (category_id && !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }
  if (legacyCategory && !["TAB", "GV"].includes(legacyCategory)) {
    return NextResponse.json({ ok: false, error: "Categoria non valida" }, { status: 400 });
  }

  let query = supabaseAdmin
    .from("items")
    .select(
      "id, category, category_id, subcategory_id, code, description, barcode, um, peso_kg, conf_da, prezzo_vendita_eur, volume_ml_per_unit, is_active, created_at, updated_at"
    )
    .order("code", { ascending: true })
    .limit(limit);

  if (active === "1") query = query.eq("is_active", true);
  else if (active === "0") query = query.eq("is_active", false);

  // ✅ FILTRO CATEGORIA:
  // 1) se category_id c’è → filtro per UUID (standard “nuovo”)
  // 2) altrimenti se legacyCategory c’è → filtro TAB/GV (flusso vecchio)
  // 3) altrimenti:
  //    - se Rapido (rapid=1) → NESSUN filtro (Tutte)
  //    - se NON Rapido → default TAB (come prima, zero regressioni)
  if (category_id) {
    query = query.eq("category_id", category_id);
    if (subcategory_id) query = query.eq("subcategory_id", subcategory_id);
  } else if (legacyCategory) {
    query = query.eq("category", legacyCategory);
  } else if (!isRapid) {
    query = query.eq("category", "TAB");
  }

  if (qRaw) {
    const safeText = normSearchText(qRaw);
    const digits = extractDigits(qRaw);

    if (looksLikeBarcode(digits)) {
      const ids = await findItemIdsByBarcodeLike(digits);
      const idInExpr = ids.length > 0 ? `id.in.(${ids.join(",")})` : "";

      const orParts = [
        idInExpr,
        `barcode.eq.${digits}`,
        `barcode.ilike.%${digits}%`,
        `code.ilike.%${safeText}%`,
        `description.ilike.%${safeText}%`,
      ].filter(Boolean);

      query = query.or(orParts.join(","));
    } else {
      const orExpr = [
        `code.ilike.%${safeText}%`,
        `description.ilike.%${safeText}%`,
        `barcode.ilike.%${safeText}%`,
      ].join(",");

      query = query.or(orExpr);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error("[items/list] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = Array.isArray(data) ? data : [];

  const ids = rows.map((r: any) => String(r?.id || "").trim()).filter(Boolean);
  const barcodeMap = await loadBarcodesForItems(ids);

  const enriched = rows.map((r: any) => {
    const id = String(r?.id || "").trim();
    const barcodes = barcodeMap.get(id) || [];
    const legacyBarcode = String(r?.barcode || "").trim();
    return {
      ...r,
      barcodes,
      barcode: legacyBarcode || barcodes[0] || null,
    };
  });

  return NextResponse.json({ ok: true, rows: enriched });
}














