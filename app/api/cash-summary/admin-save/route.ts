import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type SupplierInput = {
  id?: string;
  supplier_code?: string | null;
  supplier_name?: string | null;
  amount?: number | null;
};

type Body = {
  id?: string;
  data?: string;
  operatore?: string;
  incasso_totale?: number | null;
  gv_pagati?: number | null;
  lis_plus?: number | null;
  mooney?: number | null;
  vendita_gv?: number | null;
  vendita_tabacchi?: number | null;
  pos?: number | null;
  spese_extra?: number | null;
  tot_versato?: number | null;
  fondo_cassa_iniziale?: number | null;
  parziale_1?: number | null;
  parziale_2?: number | null;
  parziale_3?: number | null;
  fondo_cassa?: number | null;
  status?: string | null;
  suppliers?: SupplierInput[];
  field_comments?: Record<string, string>;
};

const ALLOWED_COMMENT_FIELDS = new Set([
  "incasso_totale",
  "gv_pagati",
  "lis_plus",
  "mooney",
  "vendita_gv",
  "vendita_tabacchi",
  "pos",
  "spese_extra",
  "tot_versato",
  "fondo_cassa_iniziale",
  "parziale_1",
  "parziale_2",
  "parziale_3",
  "fondo_cassa",
]);

const TRACKED_NOTIFICATION_FIELDS = [
  "incasso_totale",
  "gv_pagati",
  "lis_plus",
  "mooney",
  "vendita_gv",
  "vendita_tabacchi",
  "pos",
  "spese_extra",
  "tot_versato",
  "fondo_cassa_iniziale",
  "parziale_1",
  "parziale_2",
  "parziale_3",
  "fondo_cassa",
] as const;

type TrackedFieldKey = (typeof TRACKED_NOTIFICATION_FIELDS)[number];

const FIELD_LABELS: Record<TrackedFieldKey, string> = {
  incasso_totale: "Incasso Totale",
  gv_pagati: "G&V Pagati",
  lis_plus: "LIS+",
  mooney: "Mooney",
  vendita_gv: "Vendita G&V",
  vendita_tabacchi: "Vendita Tabacchi",
  pos: "POS",
  spese_extra: "Spese Extra",
  tot_versato: "Tot. Versato",
  fondo_cassa_iniziale: "Fondo Cassa Iniziale",
  parziale_1: "Parziale 1",
  parziale_2: "Parziale 2",
  parziale_3: "Parziale 3",
  fondo_cassa: "Fondo Cassa",
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFieldComments(value: unknown) {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return Object.entries(raw)
    .map(([fieldKey, commentText]) => ({
      field_key: String(fieldKey ?? "").trim(),
      comment_text: String(commentText ?? "").trim(),
    }))
    .filter(
      (row) =>
        ALLOWED_COMMENT_FIELDS.has(row.field_key) &&
        row.comment_text.length > 0
    );
}

function commentsRowsToMap(rows: any[]) {
  return (rows ?? []).reduce((acc: Record<string, string>, row: any) => {
    const fieldKey = String(row?.field_key ?? "").trim();
    const commentText = String(row?.comment_text ?? "").trim();
    if (!fieldKey) return acc;
    acc[fieldKey] = commentText;
    return acc;
  }, {});
}

function numbersEqual(a: number | null, b: number | null) {
  if (a === null && b === null) return true;
  return Number(a ?? 0) === Number(b ?? 0);
}

function normalizeStatus(value: unknown, isClosed: boolean) {
  if (isClosed) return "chiuso";

  const raw = String(value ?? "").trim().toLowerCase();

  if (raw === "bozza") return "bozza";
  if (raw === "completato") return "completato";
  if (raw === "chiuso") return "chiuso";

  return "completato";
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

    const body = (await req.json().catch(() => null)) as Body | null;

    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Body non valido" },
        { status: 400 }
      );
    }

    const id = String(body.id ?? "").trim();
    const data = String(body.data ?? "").trim();
    const operatore = String(body.operatore ?? "").trim();

    if (!isUuid(id)) {
      return NextResponse.json(
        { ok: false, error: "ID riepilogo non valido" },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return NextResponse.json(
        { ok: false, error: "Data non valida (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    if (!operatore) {
      return NextResponse.json(
        { ok: false, error: "Operatore obbligatorio" },
        { status: 400 }
      );
    }

    const { data: currentSummary, error: currentSummaryErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select(`
        id,
        pv_id,
        data,
        incasso_totale,
        gv_pagati,
        lis_plus,
        mooney,
        vendita_gv,
        vendita_tabacchi,
        pos,
        spese_extra,
        tot_versato,
        fondo_cassa_iniziale,
        parziale_1,
        parziale_2,
        parziale_3,
        fondo_cassa,
        status
      `)
      .eq("id", id)
      .maybeSingle();

    if (currentSummaryErr) {
      return NextResponse.json(
        { ok: false, error: currentSummaryErr.message },
        { status: 500 }
      );
    }

    if (!currentSummary) {
      return NextResponse.json(
        { ok: false, error: "Riepilogo non trovato" },
        { status: 404 }
      );
    }

    const { data: existingCommentRows, error: existingCommentsErr } = await supabaseAdmin
      .from("cash_summary_field_comments")
      .select("field_key, comment_text")
      .eq("summary_id", id);

    if (existingCommentsErr) {
      return NextResponse.json(
        { ok: false, error: existingCommentsErr.message },
        { status: 500 }
      );
    }

    const existingCommentsMap = commentsRowsToMap(existingCommentRows ?? []);

    const incasso_totale = toNumber(body.incasso_totale);
    const gv_pagati = toNumber(body.gv_pagati);
    const lis_plus = toNumber(body.lis_plus);
    const mooney = toNumber(body.mooney);
    const vendita_gv = toNumber(body.vendita_gv);
    const vendita_tabacchi = toNumber(body.vendita_tabacchi);
    const pos = toNumber(body.pos);
    const spese_extra = toNumber(body.spese_extra) ?? 0;
    const tot_versato = toNumber(body.tot_versato);
    const fondo_cassa_iniziale = toNumber(body.fondo_cassa_iniziale);
    const parziale_1 = toNumber(body.parziale_1);
    const parziale_2 = toNumber(body.parziale_2);
    const parziale_3 = toNumber(body.parziale_3);
    const fondo_cassa = toNumber(body.fondo_cassa);

    if (incasso_totale === null) {
      return NextResponse.json(
        { ok: false, error: "Incasso Totale obbligatorio" },
        { status: 400 }
      );
    }

    if (gv_pagati === null) {
      return NextResponse.json(
        { ok: false, error: "G&V Pagati obbligatorio" },
        { status: 400 }
      );
    }

    if (lis_plus === null) {
      return NextResponse.json(
        { ok: false, error: "LIS+ obbligatorio" },
        { status: 400 }
      );
    }

    if (mooney === null) {
      return NextResponse.json(
        { ok: false, error: "MOONEY obbligatorio" },
        { status: 400 }
      );
    }

    if (vendita_gv === null) {
      return NextResponse.json(
        { ok: false, error: "Vendita G&V obbligatorio" },
        { status: 400 }
      );
    }

    if (vendita_tabacchi === null) {
      return NextResponse.json(
        { ok: false, error: "Vendita Tabacchi obbligatorio" },
        { status: 400 }
      );
    }

    if (pos === null) {
      return NextResponse.json(
        { ok: false, error: "POS obbligatorio" },
        { status: 400 }
      );
    }

    if (fondo_cassa === null) {
      return NextResponse.json(
        { ok: false, error: "Fondo Cassa obbligatorio" },
        { status: 400 }
      );
    }

    const rawSuppliers = Array.isArray(body.suppliers) ? body.suppliers : [];

    const normalizedSuppliers = rawSuppliers
      .map((row) => ({
        supplier_code: String(row?.supplier_code ?? "").trim() || null,
        supplier_name: String(row?.supplier_name ?? "").trim() || null,
        amount: toNumber(row?.amount) ?? 0,
      }))
      .filter((row) => row.amount > 0 || row.supplier_code || row.supplier_name);

    const pagamento_fornitori = normalizedSuppliers.reduce(
      (sum, row) => sum + Number(row.amount ?? 0),
      0
    );

    const totale_esistenza_cassa =
      incasso_totale -
      pagamento_fornitori -
      gv_pagati +
      lis_plus +
      mooney;

    const totale = totale_esistenza_cassa + vendita_gv + vendita_tabacchi;
    const versamento = totale - pos - spese_extra;
    const da_versare =
      tot_versato === null || tot_versato === 0
        ? versamento
        : versamento - tot_versato;

    const is_closed = tot_versato !== null;
    const status = normalizeStatus(body.status, is_closed);

    const normalizedFieldComments = normalizeFieldComments(body.field_comments);
    const normalizedFieldCommentsMap = normalizedFieldComments.reduce(
      (acc: Record<string, string>, row) => {
        acc[row.field_key] = row.comment_text;
        return acc;
      },
      {}
    );

    const changedFields: string[] = [];

    const previousTrackedValues: Record<TrackedFieldKey, number | null> = {
      incasso_totale: toNumber(currentSummary.incasso_totale),
      gv_pagati: toNumber(currentSummary.gv_pagati),
      lis_plus: toNumber(currentSummary.lis_plus),
      mooney: toNumber(currentSummary.mooney),
      vendita_gv: toNumber(currentSummary.vendita_gv),
      vendita_tabacchi: toNumber(currentSummary.vendita_tabacchi),
      pos: toNumber(currentSummary.pos),
      spese_extra: toNumber(currentSummary.spese_extra) ?? 0,
      tot_versato: toNumber(currentSummary.tot_versato),
      fondo_cassa_iniziale: toNumber(currentSummary.fondo_cassa_iniziale),
      parziale_1: toNumber(currentSummary.parziale_1),
      parziale_2: toNumber(currentSummary.parziale_2),
      parziale_3: toNumber(currentSummary.parziale_3),
      fondo_cassa: toNumber(currentSummary.fondo_cassa),
    };

    const nextTrackedValues: Record<TrackedFieldKey, number | null> = {
      incasso_totale,
      gv_pagati,
      lis_plus,
      mooney,
      vendita_gv,
      vendita_tabacchi,
      pos,
      spese_extra,
      tot_versato,
      fondo_cassa_iniziale,
      parziale_1,
      parziale_2,
      parziale_3,
      fondo_cassa,
    };

    for (const fieldKey of TRACKED_NOTIFICATION_FIELDS) {
      if (!numbersEqual(previousTrackedValues[fieldKey], nextTrackedValues[fieldKey])) {
        changedFields.push(fieldKey);
        continue;
      }

      const previousComment = String(existingCommentsMap[fieldKey] ?? "").trim();
      const nextComment = String(normalizedFieldCommentsMap[fieldKey] ?? "").trim();

      if (previousComment !== nextComment) {
        changedFields.push(fieldKey);
      }
    }

    const previousStatus = String(currentSummary.status ?? "").trim().toLowerCase();
    if (previousStatus !== status) {
      changedFields.push("status");
    }

    const updatePayload = {
      data,
      operatore,
      incasso_totale,
      pagamento_fornitori,
      gv_pagati,
      lis_plus,
      mooney,
      totale_esistenza_cassa,
      vendita_gv,
      vendita_tabacchi,
      totale,
      pos,
      spese_extra,
      versamento,
      da_versare,
      tot_versato,
      fondo_cassa_iniziale,
      parziale_1,
      parziale_2,
      parziale_3,
      fondo_cassa,
      status,
      is_closed,
      updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .update(updatePayload)
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: updateErr.message },
        { status: 500 }
      );
    }

    const { error: deleteSuppliersErr } = await supabaseAdmin
      .from("pv_cash_supplier_payments")
      .delete()
      .eq("summary_id", id);

    if (deleteSuppliersErr) {
      return NextResponse.json(
        { ok: false, error: deleteSuppliersErr.message },
        { status: 500 }
      );
    }

    if (normalizedSuppliers.length > 0) {
      const supplierRows = normalizedSuppliers.map((row) => ({
        summary_id: id,
        supplier_code: row.supplier_code,
        supplier_name: row.supplier_name,
        amount: row.amount,
      }));

      const { error: insertSuppliersErr } = await supabaseAdmin
        .from("pv_cash_supplier_payments")
        .insert(supplierRows);

      if (insertSuppliersErr) {
        return NextResponse.json(
          { ok: false, error: insertSuppliersErr.message },
          { status: 500 }
        );
      }
    }

    const { error: deleteCommentsErr } = await supabaseAdmin
      .from("cash_summary_field_comments")
      .delete()
      .eq("summary_id", id);

    if (deleteCommentsErr) {
      return NextResponse.json(
        { ok: false, error: deleteCommentsErr.message },
        { status: 500 }
      );
    }

    if (normalizedFieldComments.length > 0) {
      const commentRows = normalizedFieldComments.map((row) => ({
        summary_id: id,
        field_key: row.field_key,
        comment_text: row.comment_text,
      }));

      const { error: insertCommentsErr } = await supabaseAdmin
        .from("cash_summary_field_comments")
        .insert(commentRows);

      if (insertCommentsErr) {
        return NextResponse.json(
          { ok: false, error: insertCommentsErr.message },
          { status: 500 }
        );
      }
    }

    if (changedFields.length > 0) {
      const changedFieldLabels = changedFields.map(
        (fieldKey) =>
          FIELD_LABELS[fieldKey as TrackedFieldKey] ??
          (fieldKey === "status" ? "Stato" : fieldKey)
      );

      const changedCommentsOnly = changedFields.reduce((acc: Record<string, string>, fieldKey) => {
        const nextComment = String(normalizedFieldCommentsMap[fieldKey] ?? "").trim();
        if (nextComment) {
          acc[fieldKey] = nextComment;
        }
        return acc;
      }, {});

      const notificationPayload = {
        summary_id: id,
        pv_id: String(currentSummary.pv_id),
        summary_date: data,
        message: `Il riepilogo del ${data} è stato modificato dall'amministrazione.`,
        changed_fields: changedFieldLabels,
        field_comments: changedCommentsOnly,
        is_read: false,
      };

      const { error: notificationErr } = await supabaseAdmin
        .from("pv_cash_summary_notifications")
        .insert(notificationPayload);

      if (notificationErr) {
        return NextResponse.json(
          { ok: false, error: notificationErr.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      id,
      pagamento_fornitori,
      totale_esistenza_cassa,
      totale,
      versamento,
      da_versare,
      is_closed,
      status,
      field_comments: normalizedFieldCommentsMap,
      changed_fields: changedFields,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore salvataggio admin" },
      { status: 500 }
    );
  }
}