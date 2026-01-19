// app/api/reorder/history/[id]/delete/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const id = String(ctx?.params?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID mancante" }, { status: 400 });
    }

    // 1) prendo export_path (serve per cancellare anche il file su Storage)
    const { data: row, error: readErr } = await supabaseAdmin
      .from("reorders")
      .select("id, export_path")
      .eq("id", id)
      .maybeSingle();

    if (readErr) {
      console.error("[reorder/delete] read error:", readErr);
      return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
    }

    if (!row?.id) {
      return NextResponse.json({ ok: false, error: "Ordine non trovato" }, { status: 404 });
    }

    const exportPath = String((row as any).export_path ?? "").trim();

    // 2) provo a rimuovere il file dal bucket (se c'è)
    // NB: se fallisce, NON blocco la delete DB (meglio cancellare l'ordine comunque)
    if (exportPath) {
      const { error: rmErr } = await supabaseAdmin.storage.from("reorders").remove([exportPath]);
      if (rmErr) {
        console.warn("[reorder/delete] storage remove warning:", rmErr);
      }
    }

    // 3) cancello la riga (eventuali righe collegate: meglio gestirle con FK ON DELETE CASCADE a DB)
    const { error: delErr } = await supabaseAdmin.from("reorders").delete().eq("id", id);
    if (delErr) {
      console.error("[reorder/delete] delete error:", delErr);
      return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[reorder/delete] ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Errore interno" }, { status: 500 });
  }
}
