// File: app/api/reorder/history/[id]/order-tab/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import path from "path";
import fs from "fs/promises";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { fillOrderTabXlsx, extractRowsFromCleanReorderXlsx } from "@/lib/excel/fillOrderTab";

export const runtime = "nodejs";

function getSessionFromCookies() {
  const raw = cookies().get(COOKIE_NAME)?.value || "";
  return parseSessionValue(raw);
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
    .select("id, type, export_path, pv_label")
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
    console.error("[history/order-tab] download error:", dErr);
    return NextResponse.json({ ok: false, error: "Excel pulito non trovato nello storage." }, { status: 404 });
  }

  const cleanAb = await fileBlob.arrayBuffer();

  // 3) estraggo righe (Cod. Articolo + Qtà in peso (kg))
  const rows = await extractRowsFromCleanReorderXlsx(cleanAb);

  // 4) carico template Order Tab (DA METTERE NEL REPO)
  const templatePath = path.join(process.cwd(), "templates", "Excel_per_INVIO_ORDINE.xlsx");
  let templateBytes: Uint8Array;

  try {
    templateBytes = new Uint8Array(await fs.readFile(templatePath));
  } catch {
    return NextResponse.json(
      { ok: false, error: `Template non trovato: ${templatePath}` },
      { status: 404 }
    );
  }

  // 5) compilo
  const filled = await fillOrderTabXlsx(templateBytes, rows);

  const filename = `ORDER_TAB_${(reorder.pv_label || "PV")}_${reorder.id}.xlsx`
    .replace(/\s+/g, "_")
    .replace(/[^\w\-\.]/g, "");

  return new NextResponse(Buffer.from(filled), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}









