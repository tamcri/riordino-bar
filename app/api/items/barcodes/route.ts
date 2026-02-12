// app/api/items/barcodes/route.ts
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
  return /^\d{6,14}$/.test(String(v ?? "").trim());
}

function getSession() {
  const raw = cookies().get(COOKIE_NAME)?.value ?? null;
  return parseSessionValue(raw);
}

export async function GET(req: Request) {
  const session = getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const item_id = String(url.searchParams.get("item_id") ?? "").trim();

  if (!isUuid(item_id)) {
    return NextResponse.json({ ok: false, error: "item_id non valido" }, { status: 400 });
  }

  // Leggo i barcode dalla tabella nuova
  const { data, error } = await supabaseAdmin
    .from("item_barcodes")
    .select("barcode")
    .eq("item_id", item_id)
    .order("barcode", { ascending: true })
    .limit(1000);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const barcodes = Array.isArray(data)
    ? data.map((r: any) => String(r.barcode || "").trim()).filter(Boolean)
    : [];

  return NextResponse.json({ ok: true, barcodes });
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  const item_id = String(body?.item_id ?? "").trim();
  const barcode = String(body?.barcode ?? "").trim();

  if (!isUuid(item_id)) {
    return NextResponse.json({ ok: false, error: "item_id non valido" }, { status: 400 });
  }
  if (!isBarcodeLike(barcode)) {
    return NextResponse.json({ ok: false, error: "Barcode non valido" }, { status: 400 });
  }

  // Anti-duplicato globale: barcode non deve appartenere a un altro item
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("item_barcodes")
    .select("item_id")
    .eq("barcode", barcode)
    .maybeSingle();

  if (exErr && !String(exErr.message || "").toLowerCase().includes("relation")) {
    return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });
  }

  if (existing?.item_id) {
    if (String(existing.item_id) !== item_id) {
      const { data: owner } = await supabaseAdmin
        .from("items")
        .select("code, description")
        .eq("id", existing.item_id)
        .maybeSingle();

      const ownerLabel = owner
        ? `${owner.code}${owner.description ? " - " + owner.description : ""}`
        : "un altro articolo";

      return NextResponse.json(
        { ok: false, error: `Barcode già assegnato all'articolo ${ownerLabel}` },
        { status: 400 }
      );
    }

    // già presente sullo stesso item -> ok idempotente
    return NextResponse.json({ ok: true });
  }

  const { error: insErr } = await supabaseAdmin.from("item_barcodes").insert({
    item_id,
    barcode,
    updated_at: new Date().toISOString(),
  });

  if (insErr) {
    const msg = String(insErr.message || "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  const item_id = String(body?.item_id ?? "").trim();
  const barcode = String(body?.barcode ?? "").trim();

  if (!isUuid(item_id)) {
    return NextResponse.json({ ok: false, error: "item_id non valido" }, { status: 400 });
  }
  if (!isBarcodeLike(barcode)) {
    return NextResponse.json({ ok: false, error: "Barcode non valido" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("item_barcodes")
    .delete()
    .eq("item_id", item_id)
    .eq("barcode", barcode);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
