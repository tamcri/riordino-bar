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
      return NextResponse.json({ ok: false, error: "Solo admin può aggiungere barcode" }, { status: 401 });
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

    // anti-duplicato globale: stesso barcode non può appartenere ad articoli diversi
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("item_barcodes")
      .select("item_id")
      .eq("barcode", barcode)
      .maybeSingle();

    if (exErr && !String(exErr.message || "").toLowerCase().includes("relation")) {
      return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });
    }

    if (existing?.item_id) {
      const { data: owner } = await supabaseAdmin
        .from("items")
        .select("code, description")
        .eq("id", existing.item_id)
        .maybeSingle();

      const label = owner
        ? `${owner.code}${owner.description ? " - " + owner.description : ""}`
        : "un altro articolo";

      return NextResponse.json({ ok: false, error: `Barcode già assegnato all'articolo ${label}` }, { status: 400 });
    }

    const { error: insErr } = await supabaseAdmin.from("item_barcodes").insert({
      item_id,
      barcode,
      updated_at: new Date().toISOString(),
    });

    if (insErr) {
      const msg = String(insErr.message || "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        return NextResponse.json({ ok: false, error: "Barcode già presente (duplicato)." }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    // retro-compat: se items.barcode è vuoto, lo valorizzo col primo
    const { data: item } = await supabaseAdmin.from("items").select("barcode").eq("id", item_id).maybeSingle();
    const legacy = String(item?.barcode || "").trim();

    if (!legacy) {
      const { error: updErr } = await supabaseAdmin
        .from("items")
        .update({ barcode, updated_at: new Date().toISOString() })
        .eq("id", item_id);

      if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[items/barcodes/add] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Errore aggiunta barcode" }, { status: 500 });
  }
}
