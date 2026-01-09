// File: app/api/reorder/history/[id]/log-car/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { extractRowsFromCleanReorderXlsx } from "@/lib/excel/fillOrderTab";

export const runtime = "nodejs";

function getSessionFromCookies() {
  const raw = cookies().get(COOKIE_NAME)?.value || "";
  return parseSessionValue(raw);
}

// stessa logica del LOG (fillOrderTab.ts)
function extractAAMS(codArticolo: string): string {
  const s = (codArticolo || "").trim().toUpperCase();
  const m = s.match(/\d+/g);
  if (!m?.length) return "";
  return m.join("");
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const session = getSessionFromCookies();
  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const reorderId = ctx.params.id;
  if (!reorderId) {
    return NextResponse.json({ ok: false, error: "Parametro id mancante" }, { status: 400 });
  }

  // 1) prendo lo storico (serve export_path)
  const { data: reorder, error: rErr } = await supabaseAdmin
    .from("reorders")
    .select("id, export_path, pv_label")
    .eq("id", reorderId)
    .single();

  if (rErr || !reorder) {
    return NextResponse.json({ ok: false, error: "Storico non trovato" }, { status: 404 });
  }

  if (!reorder.export_path) {
    return NextResponse.json({ ok: false, error: "export_path mancante nello storico." }, { status: 500 });
  }

  // 2) scarico Excel pulito dallo storage
  const { data: fileBlob, error: dErr } = await supabaseAdmin.storage
    .from("reorders")
    .download(reorder.export_path);

  if (dErr || !fileBlob) {
    console.error("[history/log-car] download error:", dErr);
    return NextResponse.json({ ok: false, error: "Excel pulito non trovato nello storage." }, { status: 404 });
  }

  const cleanAb = await fileBlob.arrayBuffer();

  // 3) estraggo righe (codArticolo + qtaKg)
  const srcRows = await extractRowsFromCleanReorderXlsx(cleanAb);

  // 4) preparo righe LOG CAR:
  // - Codice AAMS come LOG
  // - Quantità (Kgc) = qtaKg
  // - filtro quantità = 0
  const rows = (Array.isArray(srcRows) ? srcRows : [])
    .map((r) => ({
      aams: extractAAMS(r.codArticolo),
      qty: Number.isFinite(r.qtaKg) ? r.qtaKg : 0,
    }))
    .filter((r) => r.aams) // se manca codice AAMS, scarta
    .filter((r) => Math.abs(r.qty) > 1e-12); // scarta 0

  // 5) genero xlsx (LOG CAR)
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");

  ws.addRow(["Riga", "Codice AAMS", "Descrizione", "Quantità (Kgc)"]);
  ws.getRow(1).font = { bold: true };

  let idx = 1;
  for (const r of rows) {
    ws.addRow([idx, r.aams, "", r.qty]);
    idx += 1;
  }

  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 30;
  ws.getColumn(4).width = 16;

  const out = await wb.xlsx.writeBuffer();

  const filename = `LOG_CAR_${(reorder.pv_label || "PV")}_${reorder.id}.xlsx`
    .replace(/\s+/g, "_")
    .replace(/[^\w\-\.]/g, "");

  return new NextResponse(Buffer.from(out as ArrayBuffer), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}



