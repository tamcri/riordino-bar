import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolvePvAccess, requirePvAccess } from "@/lib/pvAccess";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f-]{36}$/i.test(v.trim());
}

function toNum(v: any) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function PATCH(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  try {
    const access = await resolvePvAccess(session);
    if (access.profile !== "standard") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json();

    const report_header_id = String(body?.report_header_id ?? "").trim();
    const item_code = String(body?.item_code ?? "").trim();
    const mode = String(body?.mode ?? "").trim(); // previous | current
    const value = toNum(body?.value);

    if (!isUuid(report_header_id)) {
      return NextResponse.json({ ok: false, error: "report_header_id non valido" }, { status: 400 });
    }

    if (!item_code) {
      return NextResponse.json({ ok: false, error: "item_code mancante" }, { status: 400 });
    }

    if (!["previous", "current"].includes(mode)) {
      return NextResponse.json({ ok: false, error: "mode non valido" }, { status: 400 });
    }

    // Risali dal report progressivi all'inventario di riferimento e al PV.
    // Non fidarti del solo report_header_id ricevuto dal client.
    const { data: reportHeader, error: reportHeaderError } = await supabaseAdmin
      .from("progressivi_report_headers")
      .select("id, current_header_id")
      .eq("id", report_header_id)
      .maybeSingle();
    if (reportHeaderError) throw reportHeaderError;
    if (!reportHeader?.current_header_id) {
      return NextResponse.json({ ok: false, error: "Report non trovato" }, { status: 404 });
    }
    const { data: invHeader, error: invHeaderError } = await supabaseAdmin
      .from("inventories_headers")
      .select("id, pv_id")
      .eq("id", reportHeader.current_header_id)
      .maybeSingle();
    if (invHeaderError) throw invHeaderError;
    if (!invHeader?.pv_id) {
      return NextResponse.json({ ok: false, error: "Inventario del report non trovato" }, { status: 404 });
    }
    await requirePvAccess(access, String(invHeader.pv_id), "write");

    // 1️⃣ carico la riga
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("progressivi_report_rows")
      .select("*")
      .eq("report_header_id", report_header_id)
      .eq("item_code", item_code)
      .maybeSingle();

    if (rowErr) throw rowErr;
    if (!row) {
      return NextResponse.json({ ok: false, error: "Riga non trovata" }, { status: 404 });
    }

    const prezzo = toNum(row.prezzo_vendita_eur);

    let prevCarico = toNum(row.previous_carico_non_registrato);
    let currCarico = toNum(row.current_carico_non_registrato);

    if (mode === "previous") prevCarico = value;
    if (mode === "current") currCarico = value;

    const prevInventario = toNum(row.previous_inventario);
    const currInventario = toNum(row.current_inventario);

    const prevGest = toNum(row.previous_gestionale);
    const currGest = toNum(row.current_gestionale);

    // 🔥 ricalcolo
    const prevGiacenza = (prevInventario - prevGest) - prevCarico;
    const currGiacenza = (currInventario - currGest) - currCarico;

    const differenza = currGiacenza - prevGiacenza;
    const valoreDifferenza = round2(differenza * prezzo);

    // 2️⃣ update
    const { error: updateErr } = await supabaseAdmin
      .from("progressivi_report_rows")
      .update({
        previous_carico_non_registrato: prevCarico,
        current_carico_non_registrato: currCarico,
        previous_giacenza: prevGiacenza,
        current_giacenza: currGiacenza,
        differenza,
        valore_differenza: valoreDifferenza,
      })
      .eq("report_header_id", report_header_id)
      .eq("item_code", item_code);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[update-carico] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore update carico" },
      { status: e?.message === "FORBIDDEN" ? 403 : e?.message === "UNAUTHORIZED" ? 401 : 500 }
    );
  }
}