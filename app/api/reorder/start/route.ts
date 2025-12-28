import { NextResponse } from "next/server";
import crypto from "crypto";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { processReorderExcel } from "@/lib/excel/reorder";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function sanitizeWeeks(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 4;
  const wi = Math.trunc(n);
  if (wi < 1) return 1;
  if (wi > 4) return 4;
  return wi;
}

function sanitizeDays(v: unknown): number | null {
  // days è opzionale
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const di = Math.trunc(n);
  if (di < 1) return 1;
  if (di > 21) return 21;
  return di;
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts) {
    if (p.startsWith(name + "=")) return p.substring(name.length + 1);
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const sessionCookie = getCookieValue(cookieHeader, COOKIE_NAME);

    const session = parseSessionValue(sessionCookie);
    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });
    }

    // ✅ pvId obbligatorio
    const pvId = String(formData.get("pvId") ?? "").trim();
    if (!pvId) {
      return NextResponse.json({ ok: false, error: "Punto vendita mancante" }, { status: 400 });
    }

    // ✅ Validazione PV
    const { data: pv, error: pvErr } = await supabaseAdmin
      .from("pvs")
      .select("id, code, name")
      .eq("id", pvId)
      .single();

    if (pvErr || !pv) {
      return NextResponse.json({ ok: false, error: "Punto vendita non valido" }, { status: 400 });
    }

    const pvLabel = `${pv.code} - ${pv.name}`;

    // ✅ periodo: weeks sempre valido, days opzionale (priorità al motore)
    const weeks = sanitizeWeeks(formData.get("weeks"));
    const days = sanitizeDays(formData.get("days"));

    const input = await file.arrayBuffer();

    // ✅ motore: usa days se presente, altrimenti weeks
    const { xlsx, rows } = await processReorderExcel(input, weeks, days);

    const reorderId = crypto.randomUUID();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    const exportPath = `TAB/${pv.code}/${year}/${month}/${reorderId}.xlsx`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("reorders")
      .upload(exportPath, xlsx, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });

    if (uploadErr) {
      console.error("[TAB start] upload error:", uploadErr);
      return NextResponse.json({ ok: false, error: "Errore upload Excel" }, { status: 500 });
    }

    // ✅ NB: questo insert fallisce se in DB non hai la colonna days
    const { error: insertErr } = await supabaseAdmin.from("reorders").insert({
      id: reorderId,
      created_by_username: session.username,
      created_by_role: session.role,
      pv_id: pv.id,
      pv_label: pvLabel,
      type: "TAB",
      weeks,
      days, // days può essere null
      export_path: exportPath,
      tot_rows: rows.length,
    });

    if (insertErr) {
      console.error("[TAB start] insert error:", insertErr);
      return NextResponse.json({ ok: false, error: "Errore salvataggio storico" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      reorderId,
      preview: rows.slice(0, 20),
      totalRows: rows.length,
      weeks,
      days,
      downloadUrl: `/api/reorder/history/${reorderId}/excel`,
    });
  } catch (err: any) {
    console.error("[TAB start] ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Errore interno" }, { status: 500 });
  }
}










