import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Body = {
  warehouse_item_id?: string;
  barcode?: string;
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f-]{36}$/i.test(String(v).trim());
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può accedere" },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json().catch(() => null)) as Body | null;

    if (!body) {
      return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });
    }

    const warehouse_item_id = String(body.warehouse_item_id ?? "").trim();
    const barcode = String(body.barcode ?? "").trim();

    if (!isUuid(warehouse_item_id)) {
      return NextResponse.json(
        { ok: false, error: "warehouse_item_id non valido" },
        { status: 400 }
      );
    }

    if (!barcode) {
      return NextResponse.json(
        { ok: false, error: "Barcode obbligatorio" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("warehouse_items")
      .update({
        barcode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", warehouse_item_id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      warehouse_item_id,
      barcode,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}