import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPvIdForSession } from "@/lib/pvLookup";

export const runtime = "nodejs";

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v).trim());
}

function safeName(name: string) {
  return String(name || "foto")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80);
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const fd = await req.formData();
    const header_id = String(fd.get("header_id") || "").trim();
    const file = fd.get("file") as File | null;

    if (!isUuid(header_id)) return NextResponse.json({ ok: false, error: "header_id non valido" }, { status: 400 });
    if (!file) return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });

    const r = await getPvIdForSession(session);
    const pv_id = r.pv_id;
    if (!pv_id) return NextResponse.json({ ok: false, error: "Utente PV senza pv_id" }, { status: 400 });

    // 🔐 controllo header appartiene al PV
    const { data: h, error: hErr } = await supabaseAdmin
      .from("waste_headers")
      .select("id, pv_id")
      .eq("id", header_id)
      .maybeSingle();

    if (hErr) return NextResponse.json({ ok: false, error: hErr.message }, { status: 500 });
    if (!h) return NextResponse.json({ ok: false, error: "Scarico non trovato" }, { status: 404 });
    if (String((h as any).pv_id) !== String(pv_id)) return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });

    // Limite 6 foto
    const { count, error: cErr } = await supabaseAdmin
      .from("waste_attachments")
      .select("id", { count: "exact", head: true })
      .eq("header_id", header_id);

    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
    if ((count || 0) >= 6) return NextResponse.json({ ok: false, error: "Limite 6 foto raggiunto" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const contentType = file.type || "application/octet-stream";

    const path = `${header_id}/${Date.now()}_${safeName(file.name)}`;

    const { error: upErr } = await supabaseAdmin.storage.from("waste").upload(path, bytes, {
      contentType,
      upsert: false,
    });

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

    const publicUrl = supabaseAdmin.storage.from("waste").getPublicUrl(path).data.publicUrl;

    const { error: insErr } = await supabaseAdmin.from("waste_attachments").insert({
      header_id,
      path,
      public_url: publicUrl,
    });

    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, path, public_url: publicUrl });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Errore" }, { status: 500 });
  }
}
