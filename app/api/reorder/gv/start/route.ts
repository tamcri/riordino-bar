import { NextResponse } from "next/server";
import crypto from "crypto";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { processReorderGVExcel } from "@/lib/excel/reorder_gv";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ✅ days libero con limiti 1..21
function sanitizeDays(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 7; // default 7 giorni
  const di = Math.trunc(n);
  if (di < 1) return 1;
  if (di > 21) return 21;
  return di;
}

// ✅ per compatibilità DB: weeks sempre INTEGER
function weeksFromDays(days: number): number {
  const w = Math.ceil(days / 7);
  // se vuoi tenere un range “sensato”:
  if (w < 1) return 1;
  if (w > 4) return 4;
  return w;
}

export async function POST(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const sessionCookie = cookieHeader
      .split("; ")
      .find((c) => c.startsWith(COOKIE_NAME + "="))
      ?.split("=")[1];

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

    // ✅ NEW: days (1..21)
    const days = sanitizeDays(formData.get("days"));
    const weeks = weeksFromDays(days); // ✅ sempre intero per DB

    const input = await file.arrayBuffer();

    // ✅ processReorderGVExcel riceve days
    const { xlsx, rows } = await processReorderGVExcel(input, days);

    const reorderId = crypto.randomUUID();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    // ✅ path ordinato per PV
    const exportPath = `GV/${pv.code}/${year}/${month}/${reorderId}.xlsx`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("reorders")
      .upload(exportPath, xlsx, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });

    if (uploadErr) {
      console.error("[GV start] upload error:", uploadErr);
      return NextResponse.json({ ok: false, error: "Errore upload Excel" }, { status: 500 });
    }

    const { error: insertErr } = await supabaseAdmin.from("reorders").insert({
      id: reorderId,
      created_by_username: session.username,
      created_by_role: session.role,
      pv_id: pv.id,
      pv_label: pvLabel,
      type: "GV",
      weeks, // ✅ INTEGER compatibile
      export_path: exportPath,
      tot_rows: rows.length,
    });

    if (insertErr) {
      console.error("[GV start] insert error:", insertErr);
      return NextResponse.json(
        { ok: false, error: `Errore salvataggio storico: ${insertErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      reorderId,
      preview: rows.slice(0, 20),
      totalRows: rows.length,
      days,   // ✅ lo usi in UI
      weeks,  // ✅ per storico/DB (intero)
      downloadUrl: `/api/reorder/history/${reorderId}/excel`,
    });
  } catch (err: any) {
    console.error("[GV start] ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Errore interno" }, { status: 500 });
  }
}








