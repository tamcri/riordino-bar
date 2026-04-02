import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f-]{36}$/i.test(v.trim());
}

function toInt(v: any): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

export async function PATCH(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può modificare il deposito" },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => null);

    const id = String(body?.id ?? "").trim();
    const stock_qty = body?.stock_qty;
    const is_active = body?.is_active;

    if (!id || !isUuid(id)) {
      return NextResponse.json({ ok: false, error: "ID non valido" }, { status: 400 });
    }

    const patch: any = {
      updated_at: new Date().toISOString(),
    };

    const nextQty = toInt(stock_qty);
    if (nextQty !== undefined) {
      patch.stock_qty = nextQty ?? 0;
    }

    if (typeof is_active === "boolean") {
      patch.is_active = is_active;
    }

    const { error } = await supabaseAdmin
      .from("warehouse_deposit_items")
      .update(patch)
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}