// app/api/items/list_all/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const c = cookies();
    const sessionRaw = c.get(COOKIE_NAME)?.value || "";
    const session = parseSessionValue(sessionRaw);

    if (!session) {
      return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);

    const limitRaw = (searchParams.get("limit") || "5000").trim();
    const limit = Math.max(1, Math.min(10000, Number(limitRaw) || 5000));

    // ✅ DEBUG: filtro testuale
    const q = (searchParams.get("q") || "").trim();
    // ✅ DEBUG: includi anche non attivi
    const includeInactive = (searchParams.get("include_inactive") || "").trim() === "1";

    // ✅ Normalizzo q (evito % dentro il pattern)
    const qq = q ? q.replace(/%/g, "").trim() : "";

    // ✅ paginazione robusta: Supabase/PostgREST spesso “taglia” a 1000 righe
    const pageSize = 1000;
    let from = 0;

    const out: any[] = [];
    let totalCount: number | null = null;

    while (out.length < limit) {
      const to = Math.min(from + pageSize - 1, limit - 1);

      let query = supabaseAdmin
        .from("items")
        .select(
          `
          id,
          code,
          description,
          barcode,
          prezzo_vendita_eur,
          is_active,
          um,
          peso_kg,
          volume_ml_per_unit,
          category_id,
          subcategory_id
        `,
          { count: "exact" }
        )
        .order("code", { ascending: true })
        .range(from, to);

      if (!includeInactive) {
        query = query.eq("is_active", true);
      }

      if (qq) {
        // code / description / barcode
        query = query.or(`code.ilike.%${qq}%,description.ilike.%${qq}%,barcode.ilike.%${qq}%`);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      if (totalCount == null && typeof count === "number") {
        totalCount = count;
      }

      const chunk = data || [];
      out.push(...chunk);

      // Se torna meno di pageSize => finiti i dati
      if (chunk.length < pageSize) break;

      from += pageSize;
    }

    return NextResponse.json({
      ok: true,
      count: totalCount,
      rows: out.slice(0, limit),
      debug: {
        limit,
        q: q || null,
        include_inactive: includeInactive,
        pageSize,
        returned: Math.min(out.length, limit),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Errore" }, { status: 500 });
  }
}
