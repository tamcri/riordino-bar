// app/api/warehouse-items/list/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

function toNumberSafe(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function calcPriceVat(price: number | null, vat: number | null) {
  const p = toNumberSafe(price);
  const v = toNumberSafe(vat);

  if (p == null) return null;

  const vatPerc = v ?? 0;

  return p * (1 + vatPerc / 100);
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
    const active = norm(searchParams.get("active"));

    let query = supabaseAdmin
      .from("warehouse_items")
      .select(`
        id,
        code,
        description,
        barcode,
        um,
        prezzo_vendita_eur,
        purchase_price,
        vat_rate,
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

    const rows = (data || []).map((r: any) => {
      const purchase_price = toNumberSafe(r.purchase_price);
      const vat_rate = toNumberSafe(r.vat_rate);

      return {
        ...r,
        purchase_price,
        vat_rate,
        purchase_price_vat: calcPriceVat(purchase_price, vat_rate),
      };
    });

    return NextResponse.json({
      ok: true,
      rows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}