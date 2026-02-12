import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function isBarcodeLike(v: string) {
  return /^\d{6,14}$/.test(v.trim());
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Solo admin può rimuovere barcode" }, { status: 401 });
    }

    const body = await req.json();
    const item_id = String(body?.item_id ?? "").trim();
    const barcode = String(body?.barcode ?? "").trim();

    if (!isUuid(item_id)) {
      return NextResponse.json({ ok: false, error: "item_id non valido" }, { status: 400 });
    }
    if (!isBarcodeLike(barcode)) {
      return NextResponse.json({ ok: false, error: "Barcode non valido" }, { status: 400 });
    }

    // cancello mapping
    const { error: delErr } = await supabaseAdmin
      .from("item_barcodes")
      .delete()
      .eq("item_id", item_id)
      .eq("barcode", barcode);

    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });

    // se il barcode rimosso era quello “legacy”, metto un altro (se esiste) oppure svuoto
    const { data: item } = await supabaseAdmin.from("items").select("barcode").eq("id", item_id).maybeSingle();
    const legacy = String(item?.barcode || "").trim();

    if (legacy === barcode) {
      const { data: remaining } = await supabaseAdmin
        .from("item_barcodes")
        .select("barcode")
        .eq("item_id", item_id)
        .order("barcode", { ascending: true })
        .limit(1);

      const nextLegacy = String(remaining?.[0]?.barcode || "").trim();

      const { error: updErr } = await supabaseAdmin
        .from("items")
        .update({ barcode: nextLegacy || null, updated_at: new Date().toISOString() })
        .eq("id", item_id);

      if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[items/barcodes/remove] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Errore rimozione barcode" }, { status: 500 });
  }
}
