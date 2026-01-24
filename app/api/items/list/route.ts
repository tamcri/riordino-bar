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

// Normalizza testo per ricerca (no virgole che rompono .or, no spazi multipli)
function normSearchText(q: string) {
  return q.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

// Normalizza possibili barcode: tieni solo cifre
function extractDigits(q: string) {
  return q.replace(/[^\d]/g, "");
}

function looksLikeBarcode(digits: string) {
  return digits.length >= 8;
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  // ✅ lettura consentita anche a punto_vendita (serve per Inventario PV)
  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  // ✅ nuovo schema
  const category_id = url.searchParams.get("category_id"); // uuid
  const subcategory_id = url.searchParams.get("subcategory_id"); // uuid

  // ✅ vecchio schema (retro-compat)
  const legacyCategory = (url.searchParams.get("category") || "").trim().toUpperCase(); // TAB | GV

  const qRaw = (url.searchParams.get("q") || "").trim();
  const active = (url.searchParams.get("active") || "1").toLowerCase(); // 1 | 0 | all

  // ✅ CAP 1000
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);

  // validazioni leggere
  if (category_id && !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }
  if (legacyCategory && !["TAB", "GV"].includes(legacyCategory)) {
    return NextResponse.json({ ok: false, error: "Categoria non valida" }, { status: 400 });
  }

  // ✅ Base select: includo anche barcode + tabacchi fields
  let query = supabaseAdmin
    .from("items")
    .select(
      "id, category, category_id, subcategory_id, code, description, barcode, peso_kg, conf_da, prezzo_vendita_eur, is_active, created_at, updated_at"
    )
    .order("code", { ascending: true })
    .limit(limit);

  // Filtri stato
  if (active === "1") query = query.eq("is_active", true);
  else if (active === "0") query = query.eq("is_active", false);

  // ✅ Priorità: nuovo schema
  if (category_id) {
    query = query.eq("category_id", category_id);
    if (subcategory_id) query = query.eq("subcategory_id", subcategory_id);
  } else {
    // ✅ fallback vecchio schema
    const cat = legacyCategory || "TAB";
    query = query.eq("category", cat);
  }

  // ✅ Ricerca: code/description sempre, barcode con logica intelligente
  if (qRaw) {
    const safeText = normSearchText(qRaw);
    const digits = extractDigits(qRaw);

    if (looksLikeBarcode(digits)) {
      const orExpr = [
        `barcode.eq.${digits}`,
        `code.ilike.%${safeText}%`,
        `description.ilike.%${safeText}%`,
        `barcode.ilike.%${digits}%`,
      ].join(",");

      query = query.or(orExpr);
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

  return NextResponse.json({ ok: true, rows: data || [] });
}










