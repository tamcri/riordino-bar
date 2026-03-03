import { NextResponse } from "next/server";
import crypto from "crypto";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { processReorderGVExcel } from "@/lib/excel/reorder_gv";

export const runtime = "nodejs";

function formatITDate(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function POST(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const sessionCookie = cookieHeader
      .split("; ")
      .find((c) => c.startsWith(COOKIE_NAME + "="))
      ?.split("=")[1];

    const session = parseSessionValue(sessionCookie);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });
    }

    const pvId = String(formData.get("pvId") ?? "").trim();
    if (!pvId) {
      return NextResponse.json({ ok: false, error: "Punto vendita mancante" }, { status: 400 });
    }

    const { data: pv, error: pvErr } = await supabaseAdmin
      .from("pvs")
      .select("id, code, name")
      .eq("id", pvId)
      .single();

    if (pvErr || !pv) {
      return NextResponse.json({ ok: false, error: "Punto vendita non valido" }, { status: 400 });
    }

    // ✅ prezzi da DB
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("items")
      .select("code, prezzo_vendita_eur")
      .eq("is_active", true);

    if (itemsErr) {
      console.error("[GV start] items error:", itemsErr);
      return NextResponse.json({ ok: false, error: "Errore lettura anagrafica prezzi" }, { status: 500 });
    }

    const priceMap: Record<string, number> = {};
    for (const it of items || []) {
      priceMap[String(it.code)] = Number(it.prezzo_vendita_eur) || 0;
    }

    const input = await file.arrayBuffer();

    // ✅ Titolo intestazione Excel
    const today = new Date();
    const title = `${pv.code} - ${pv.name} Ordine Gratta e Vinci del ${formatITDate(today)}`;

    const { xlsx, rows } = await processReorderGVExcel(input, priceMap, title);

    const reorderId = crypto.randomUUID();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");

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

    const pvLabel = `${pv.code} - ${pv.name}`;

    const { error: insertErr } = await supabaseAdmin.from("reorders").insert({
      id: reorderId,
      created_by_username: session.username,
      created_by_role: session.role,
      pv_id: pv.id,
      pv_label: pvLabel,
      type: "GV",
      weeks: 1,
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
      downloadUrl: `/api/reorder/history/${reorderId}/excel`,
    });
  } catch (err: any) {
    console.error("[GV start] ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Errore interno" }, { status: 500 });
  }
}








