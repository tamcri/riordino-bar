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

async function loadPesoKgByCodes(codes: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const uniq = Array.from(new Set(codes.map((c) => normCode(c)).filter(Boolean)));
  if (uniq.length === 0) return m;

  const chunkSize = 500;

  // 1) NEW SCHEMA: category_id della categoria "Tabacchi"
  const tabacchiCategoryId = await findTabacchiCategoryId();
  if (tabacchiCategoryId) {
    for (let i = 0; i < uniq.length; i += chunkSize) {
      const chunk = uniq.slice(i, i + chunkSize);

      const { data, error } = await supabaseAdmin
        .from("items")
        .select("code, peso_kg")
        .eq("category_id", tabacchiCategoryId)
        .in("code", chunk);

      if (error) throw error;

      (data || []).forEach((r: any) => {
        const code = normCode(r.code);
        const pk = Number(r.peso_kg);
        if (code && Number.isFinite(pk) && pk > 0) m.set(code, pk);
      });
    }

    // Se ho trovato almeno qualcosa, ok: non serve legacy
    if (m.size > 0) return m;
  }

  // 2) LEGACY: category="TAB"
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);

    const { data, error } = await supabaseAdmin
      .from("items")
      .select("code, peso_kg")
      .eq("category", "TAB")
      .in("code", chunk);

    if (error) throw error;

    (data || []).forEach((r: any) => {
      const code = normCode(r.code);
      const pk = Number(r.peso_kg);
      if (code && Number.isFinite(pk) && pk > 0) m.set(code, pk);
    });
  }

  return m;
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

    const weeks = sanitizeWeeks(formData.get("weeks"));
    const days = sanitizeDays(formData.get("days"));

    const input = await file.arrayBuffer();

    // 1) parse gestionale
    const parsed = await parseReorderExcel(input, weeks, days);

    // 2) peso da anagrafica Tabacchi (new schema) con fallback legacy TAB
    const codes = parsed.rows.map((r) => normCode(r.codArticolo));
    const pesoMap = await loadPesoKgByCodes(codes);

    // fallback vecchia logica SOLO se manca peso anagrafico
    const fallbackPesoUnitKg = 0.02;

    const enrichedRows: PreviewRow[] = parsed.rows.map((r) => {
      const code = normCode(r.codArticolo);
      const unitPeso = pesoMap.get(code) ?? fallbackPesoUnitKg;
      const pesoKg = Number(((r.qtaOrdine || 0) * unitPeso).toFixed(1));
      return { ...r, pesoKg };
    });

    // 3) costruisci Excel finale (pulito)
    const xlsx = await buildReorderXlsx(pvLabel, enrichedRows);

    // 4) upload + storico
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
      tot_rows: enrichedRows.length,
    });

    if (insertErr) {
      console.error("[TAB start] insert error:", insertErr);
      return NextResponse.json({ ok: false, error: "Errore salvataggio storico" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      reorderId,
      preview: enrichedRows.slice(0, 20),
      totalRows: enrichedRows.length,
      weeks,
      days,
      downloadUrl: `/api/reorder/history/${reorderId}/excel`,
    });
  } catch (err: any) {
    console.error("[TAB start] ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Errore interno" }, { status: 500 });
  }
}














