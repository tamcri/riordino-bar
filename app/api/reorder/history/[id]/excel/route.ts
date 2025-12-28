import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

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

  // ✅ QUESTA è la chiave: deve chiamarsi ESATTAMENTE come la cartella [reorderId]
  const reorderId = ctx.params.id;

  if (!reorderId) {
    return NextResponse.json({ ok: false, error: "Parametro reorderId mancante" }, { status: 400 });
  }

  // 1) prendo lo storico
  const { data: reorder, error: rErr } = await supabaseAdmin
    .from("reorders")
    .select("id, type, export_path, pv_label")
    .eq("id", reorderId)
    .single();

  if (rErr || !reorder) {
    return NextResponse.json({ ok: false, error: "Storico non trovato" }, { status: 404 });
  }

  // 2) scarico file dallo storage
  const { data: fileBlob, error: dErr } = await supabaseAdmin.storage
    .from("reorders")
    .download(reorder.export_path);

  if (dErr || !fileBlob) {
    console.error("[history/excel] download error:", dErr);
    return NextResponse.json({ ok: false, error: "File Excel non trovato nello storage" }, { status: 404 });
  }

  const ab = await fileBlob.arrayBuffer();
  const buf = Buffer.from(ab);

  const filename = `${reorder.type}_${(reorder.pv_label || "PV")}_${reorder.id}.xlsx`
    .replace(/\s+/g, "_")
    .replace(/[^\w\-\.]/g, "");

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}


