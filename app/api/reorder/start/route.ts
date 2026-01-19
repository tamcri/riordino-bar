// app/api/reorder/start/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseReorderExcel, buildReorderXlsx, PreviewRow } from "@/lib/excel/reorder";

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

function normCode(v: any): string {
  return String(v ?? "").trim();
}

function n0(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

function roundUpToMultiple(qty: number, multiple: number): number {
  const q = Math.trunc(n0(qty));
  const m = Math.trunc(n0(multiple));
  if (q <= 0) return 0;
  const mm = m > 0 ? m : 10;
  return Math.ceil(q / mm) * mm;
}

async function findTabacchiCategoryId(): Promise<string | null> {
  // Provo prima con slug "tabacchi"
  {
    const { data, error } = await supabaseAdmin
      .from("categories")
      .select("id, slug, name")
      .ilike("slug", "tabacchi")
      .maybeSingle();

    if (!error && data?.id) return String(data.id);
  }

  // Fallback: name "Tabacchi" (case insensitive)
  {
    const { data, error } = await supabaseAdmin
      .from("categories")
      .select("id, slug, name")
      .ilike("name", "tabacchi")
      .maybeSingle();

    if (!error && data?.id) return String(data.id);
  }

  return null;
}

async function loadItemMetaByCodes(
  codes: string[]
): Promise<{ pesoMap: Map<string, number>; confMap: Map<string, number> }> {
  const pesoMap = new Map<string, number>();
  const confMap = new Map<string, number>();

  const uniq = Array.from(new Set(codes.map((c) => normCode(c)).filter(Boolean)));
  if (uniq.length === 0) return { pesoMap, confMap };

  const chunkSize = 500;

  const tabacchiCategoryId = await findTabacchiCategoryId();

  // helper: applica righe a mappe
  const apply = (rows: any[]) => {
    (rows || []).forEach((r: any) => {
      const code = normCode(r.code);

      const pk = Number(r.peso_kg);
      if (code && Number.isFinite(pk) && pk > 0) pesoMap.set(code, pk);

      const cd = Number(r.conf_da);
      if (code && Number.isFinite(cd) && cd > 0) confMap.set(code, Math.trunc(cd));
    });
  };

  // 1) NEW schema (category_id Tabacchi)
  if (tabacchiCategoryId) {
    for (let i = 0; i < uniq.length; i += chunkSize) {
      const chunk = uniq.slice(i, i + chunkSize);

      const { data, error } = await supabaseAdmin
        .from("items")
        .select("code, peso_kg, conf_da")
        .eq("category_id", tabacchiCategoryId)
        .in("code", chunk);

      if (error) throw error;
      apply(data || []);
    }

    if (pesoMap.size > 0 || confMap.size > 0) return { pesoMap, confMap };
  }

  // 2) LEGACY: category="TAB"
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);

    const { data, error } = await supabaseAdmin
      .from("items")
      .select("code, peso_kg, conf_da")
      .eq("category", "TAB")
      .in("code", chunk);

    if (error) throw error;
    apply(data || []);
  }

  return { pesoMap, confMap };
}

type TotByItem = {
  codArticolo: string;
  descrizione?: string;
  conf_da?: number | null;
  qtaOrdine: number;
  pesoKg: number;
  valoreDaOrdinare: number;
};

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

    const pvLabel = `${pv.code} - ${pv.name}`;

    const weeks = sanitizeWeeks(formData.get("weeks"));
    const days = sanitizeDays(formData.get("days"));

    const input = await file.arrayBuffer();

    // 1) parse gestionale (qui confDa=10 è solo placeholder)
    const parsed = await parseReorderExcel(input, weeks, days);

    // 2) meta da anagrafica (peso + conf_da)
    const codes = parsed.rows.map((r) => normCode((r as any).codArticolo));
    const { pesoMap, confMap } = await loadItemMetaByCodes(codes);

    const fallbackPesoUnitKg = 0.02;
    const fallbackConfDa = 10;

    // 3) arricchisci righe (applica conf_da reale + ricalcolo qtaOrdine + pesoKg + valoreDaOrdinare)
    const enrichedRows: PreviewRow[] = parsed.rows.map((r: any) => {
      const code = normCode(r?.codArticolo);

      const pesoAnagrafica = pesoMap.get(code);
      const pesoUnitKg =
        typeof pesoAnagrafica === "number" && Number.isFinite(pesoAnagrafica) && pesoAnagrafica > 0
          ? pesoAnagrafica
          : fallbackPesoUnitKg;

      const confAnagrafica = confMap.get(code);
      const confDa =
        typeof confAnagrafica === "number" && Number.isFinite(confAnagrafica) && confAnagrafica > 0
          ? Math.trunc(confAnagrafica)
          : fallbackConfDa;

      // qtaTeorica viene dal parse (mancante prima dei pack)
      const qtaTeorica = Math.trunc(n0(r?.qtaTeorica));
      const qtaOrdine = roundUpToMultiple(qtaTeorica, confDa);

      // ricalcolo valoreDaOrdinare con qtaOrdine aggiornata (prezzo unit = valoreVenduto/qtaVenduta)
      const qtaVenduta = n0(r?.qtaVenduta);
      const valoreVenduto = n0(r?.valoreVenduto);
      const unitValue = qtaVenduta > 0 ? valoreVenduto / qtaVenduta : 0;
      const valoreDaOrdinare = qtaOrdine > 0 && unitValue > 0 ? round2(unitValue * qtaOrdine) : 0;

      // pesoKg = qtaOrdine arrotondata * pesoUnit
      const pesoKg = round1(qtaOrdine * pesoUnitKg);

      // IMPORTANTE:
      // - buildReorderXlsx usa `confDa` (non `conf_da`)
      // - ma per storico/totali teniamo anche `conf_da` per compatibilità
      return {
        ...r,
        confDa,
        conf_da: confDa,
        qtaOrdine,
        valoreDaOrdinare,
        pesoKg,
      };
    });

    // ✅ TOTALI COMPLETI (ordine intero)
    const tot_rows = enrichedRows.length;
    const tot_order_qty = Math.trunc(enrichedRows.reduce((acc, r: any) => acc + n0(r?.qtaOrdine), 0));
    const tot_weight_kg = round1(enrichedRows.reduce((acc, r: any) => acc + n0(r?.pesoKg), 0));
    const tot_value_eur = round2(enrichedRows.reduce((acc, r: any) => acc + n0(r?.valoreDaOrdinare), 0));

    // ✅ TOTALI PER ARTICOLO (ordine intero)
    const byItem = new Map<string, TotByItem>();

    for (const rr of enrichedRows as any[]) {
      const cod = normCode(rr?.codArticolo);
      if (!cod) continue;

      const prev = byItem.get(cod);
      const next: TotByItem = prev || {
        codArticolo: cod,
        descrizione: String(rr?.descrizione ?? ""),
        conf_da: rr?.conf_da ?? null,
        qtaOrdine: 0,
        pesoKg: 0,
        valoreDaOrdinare: 0,
      };

      next.qtaOrdine += Math.trunc(n0(rr?.qtaOrdine));
      next.pesoKg = round1(n0(next.pesoKg) + n0(rr?.pesoKg));
      next.valoreDaOrdinare = round2(n0(next.valoreDaOrdinare) + n0(rr?.valoreDaOrdinare));

      if ((next.conf_da == null || next.conf_da === 0) && rr?.conf_da) next.conf_da = rr.conf_da;

      byItem.set(cod, next);
    }

    const totals_by_item = Array.from(byItem.values()).sort(
      (a, b) => n0(b.valoreDaOrdinare) - n0(a.valoreDaOrdinare)
    );
    const totals_by_item_count = totals_by_item.length;

    // ✅ PREVIEW salvata (prime 200 righe)
    const PREVIEW_MAX = 200;
    const preview = enrichedRows.slice(0, PREVIEW_MAX);
    const preview_count = preview.length;

    // 4) Excel finale (ordine completo)
    const xlsx = await buildReorderXlsx(pvLabel, enrichedRows as any);

    // 5) upload + storico
    const reorderId = crypto.randomUUID();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    const exportPath = `TAB/${pv.code}/${year}/${month}/${reorderId}.xlsx`;

    const { error: uploadErr } = await supabaseAdmin.storage.from("reorders").upload(exportPath, xlsx, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

    if (uploadErr) {
      console.error("[TAB start] upload error:", uploadErr);
      return NextResponse.json({ ok: false, error: "Errore upload Excel" }, { status: 500 });
    }

    const { error: insertErr } = await supabaseAdmin.from("reorders").insert({
      id: reorderId,
      created_by_username: session.username,
      created_by_role: session.role,
      pv_id: pv.id,
      pv_label: pvLabel,
      type: "TAB",
      weeks,
      days,
      export_path: exportPath,

      // ✅ totali veri
      tot_rows,
      tot_order_qty,
      tot_weight_kg,
      tot_value_eur,

      // ✅ preview salvata
      preview,
      preview_count,

      // ✅ totali per articolo (completi)
      totals_by_item,
      totals_by_item_count,
    });

    if (insertErr) {
      console.error("[TAB start] insert error:", insertErr);
      return NextResponse.json({ ok: false, error: "Errore salvataggio storico" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      reorderId,
      preview: preview.slice(0, 20),
      totalRows: tot_rows,
      weeks,
      days,
      downloadUrl: `/api/reorder/history/${reorderId}/excel`,
    });
  } catch (err: any) {
    console.error("[TAB start] ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Errore interno" }, { status: 500 });
  }
}

























