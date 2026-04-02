// app/api/warehouse-items/list/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può accedere" },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);

    const q = norm(searchParams.get("q"));
    const active = norm(searchParams.get("active")); // "1" | "0" | "all"

    let query = supabaseAdmin
      .from("warehouse_items")
      .select(`
        id,
        code,
        description,
        barcode,
        um,
        prezzo_vendita_eur,
        peso_kg,
        volume_ml_per_unit,
        is_active,
        created_at,
        updated_at
      `)
      .order("code", { ascending: true });

    if (active === "1") {
      query = query.eq("is_active", true);
    } else if (active === "0") {
      query = query.eq("is_active", false);
    }

    if (q && q.length >= 2) {
      query = query.or(
        `code.ilike.%${q}%,description.ilike.%${q}%,barcode.ilike.%${q}%`
      );
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      rows: Array.isArray(data) ? data : [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}