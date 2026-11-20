import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePvAccess, resolvePvAccess } from "@/lib/pvAccess";

export const runtime = "nodejs";

const ALLOWED_METRICS = new Set([
  "incasso_totale",
  "gv_pagati",
  "vendita_tabacchi",
  "vendita_gv",
  "lis_plus",
  "mooney",
  "pos",
  "spese_extra",
  "tot_versato",
  "fondo_cassa_iniziale",
  "parziale_1",
  "parziale_2",
  "parziale_3",
  "saldo_giorno",
  "fondo_cassa",
] as const);

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function normalizeStatus(value: unknown): "ok" | "check" | null {
  const raw = String(value ?? "").trim().toLowerCase();

  if (raw === "ok") return "ok";
  if (raw === "check") return "check";

  return null;
}

function normalizeMetricKey(value: unknown): string | null {
  const raw = String(value ?? "").trim();

  if (!raw) return null;

  return ALLOWED_METRICS.has(raw as any) ? raw : null;
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json(
        { ok: false, error: "Non autorizzato" },
        { status: 401 }
      );
    }

    let access;
    try {
      access = await resolvePvAccess(session);
      // I profili limitati richiedono la sessione recente con UUID.
      if (access.profile !== "standard" && session.userId !== access.userId) {
        return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
      }
    } catch (error) {
      if (error instanceof Error && (error.message === "UNAUTHORIZED" || error.message === "Profilo di accesso non riconosciuto")) {
        return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
      }
      throw error;
    }

    const body = await req.json().catch(() => null);

    const summaryId = String(body?.summary_id ?? "").trim();
    const metricKey = normalizeMetricKey(body?.metric_key);
    const status = normalizeStatus(body?.status);

    if (!isUuid(summaryId)) {
      return NextResponse.json(
        { ok: false, error: "ID riepilogo non valido" },
        { status: 400 }
      );
    }

    if (!metricKey) {
      return NextResponse.json(
        { ok: false, error: "Metrica non valida" },
        { status: 400 }
      );
    }

    const { data: summary, error: summaryErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select("id, pv_id")
      .eq("id", summaryId)
      .maybeSingle();

    if (summaryErr) {
      return NextResponse.json({ ok: false, error: summaryErr.message }, { status: 500 });
    }
    if (!summary) {
      return NextResponse.json({ ok: false, error: "Riepilogo non trovato" }, { status: 404 });
    }

    // L'API amministrativa richiede accesso pieno al PV del riepilogo.
    // I profili limitati (anche di sola lettura) non possono scrivere qui.
    try {
      await requirePvAccess(access, String(summary.pv_id), "full");
    } catch (error) {
      if (error instanceof Error && error.message === "FORBIDDEN") {
        return NextResponse.json({ ok: false, error: "Riepilogo non trovato" }, { status: 404 });
      }
      throw error;
    }

    // Se status è null, rimuove lo stato di controllo.
    if (status === null) {
      const { error } = await supabaseAdmin
        .from("cash_summary_metric_checks")
        .delete()
        .eq("summary_id", summaryId)
        .eq("metric_key", metricKey);

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        deleted: true,
      });
    }

    const payload = {
      summary_id: summaryId,
      metric_key: metricKey,
      status,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("cash_summary_metric_checks")
      .upsert(payload, {
        onConflict: "summary_id,metric_key",
      })
      .select("id, summary_id, metric_key, status, updated_at")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: data,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Errore salvataggio stato controllo",
      },
      { status: 500 }
    );
  }
}