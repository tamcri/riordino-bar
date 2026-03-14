import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ProgressiviSnapshotHeader = {
  id: string;
  pv_id: string;
  current_header_id: string;
  previous_header_id: string | null;
  inventory_date_current: string;
  inventory_date_previous: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  label: string | null;
  logical_category_id: string | null;
  logical_category_name: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
};

export type ProgressiviSnapshotRow = {
  id?: string;
  report_header_id: string;
  item_id: string | null;
  item_code: string;
  description: string;
  um: string | null;
  prezzo_vendita_eur: number;

  previous_inventario: number;
  previous_gestionale: number;
  previous_carico_non_registrato: number;
  previous_giacenza: number;
  previous_valore: number;

  current_inventario: number;
  current_gestionale: number;
  current_carico_non_registrato: number;
  current_giacenza: number;
  current_valore: number;

  differenza: number;
  valore_differenza: number;

  is_recounted: boolean;
  recount_source_header_id: string | null;
  last_recount_at: string | null;

  created_at?: string;
  updated_at?: string;
};

export type CreateProgressiviSnapshotInput = {
  header: {
    pv_id: string;
    current_header_id: string;
    previous_header_id: string | null;
    inventory_date_current: string;
    inventory_date_previous: string | null;
    category_id: string | null;
    subcategory_id: string | null;
    label: string | null;
    logical_category_id: string | null;
    logical_category_name: string | null;
    created_by_username: string | null;
  };
  rows: Omit<
    ProgressiviSnapshotRow,
    "id" | "report_header_id" | "created_at" | "updated_at"
  >[];
};

export type UpdateSnapshotRowsInput = {
  report_header_id: string;
  rows: Omit<
    ProgressiviSnapshotRow,
    "id" | "report_header_id" | "created_at" | "updated_at"
  >[];
};

function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeNullableText(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function normalizeSnapshotRow(
  reportHeaderId: string,
  row: Omit<
    ProgressiviSnapshotRow,
    "id" | "report_header_id" | "created_at" | "updated_at"
  >
) {
  return {
    report_header_id: reportHeaderId,
    item_id: normalizeNullableText(row.item_id),
    item_code: String(row.item_code ?? "").trim(),
    description: String(row.description ?? "").trim(),
    um: normalizeNullableText(row.um),
    prezzo_vendita_eur: toNum(row.prezzo_vendita_eur),

    previous_inventario: toNum(row.previous_inventario),
    previous_gestionale: toNum(row.previous_gestionale),
    previous_carico_non_registrato: toNum(row.previous_carico_non_registrato),
    previous_giacenza: toNum(row.previous_giacenza),
    previous_valore: toNum(row.previous_valore),

    current_inventario: toNum(row.current_inventario),
    current_gestionale: toNum(row.current_gestionale),
    current_carico_non_registrato: toNum(row.current_carico_non_registrato),
    current_giacenza: toNum(row.current_giacenza),
    current_valore: toNum(row.current_valore),

    differenza: toNum(row.differenza),
    valore_differenza: toNum(row.valore_differenza),

    is_recounted: Boolean(row.is_recounted),
    recount_source_header_id: normalizeNullableText(row.recount_source_header_id),
    last_recount_at: row.last_recount_at ? String(row.last_recount_at) : null,
  };
}

export async function findExistingProgressiviSnapshot(params: {
  pv_id: string;
  current_header_id: string;
  previous_header_id: string | null;
  logical_category_id: string | null;
  label: string | null;
}): Promise<ProgressiviSnapshotHeader | null> {
  let q = supabaseAdmin
    .from("progressivi_report_headers")
    .select("*")
    .eq("pv_id", params.pv_id)
    .eq("current_header_id", params.current_header_id);

  if (params.previous_header_id) {
    q = q.eq("previous_header_id", params.previous_header_id);
  } else {
    q = q.is("previous_header_id", null);
  }

  if (params.logical_category_id) {
    q = q.eq("logical_category_id", params.logical_category_id);
  } else {
    q = q.is("logical_category_id", null);
  }

  if (params.label) {
    q = q.eq("label", params.label);
  } else {
    q = q.is("label", null);
  }

  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as ProgressiviSnapshotHeader | null;
}

export async function createProgressiviSnapshot(
  input: CreateProgressiviSnapshotInput
): Promise<{
  header: ProgressiviSnapshotHeader;
  rows: ProgressiviSnapshotRow[];
}> {
  const normalizedInputRows = input.rows
    .map((row) => ({
      ...row,
      item_code: String(row.item_code ?? "").trim(),
      description: String(row.description ?? "").trim(),
    }))
    .filter((row) => row.item_code);

  if (normalizedInputRows.length === 0) {
    throw new Error(
      "Impossibile creare snapshot progressivi: nessuna riga valida da salvare."
    );
  }

  const { data: headerData, error: headerErr } = await supabaseAdmin
    .from("progressivi_report_headers")
    .insert({
      pv_id: input.header.pv_id,
      current_header_id: input.header.current_header_id,
      previous_header_id: input.header.previous_header_id,
      inventory_date_current: input.header.inventory_date_current,
      inventory_date_previous: input.header.inventory_date_previous,
      category_id: input.header.category_id,
      subcategory_id: input.header.subcategory_id,
      label: input.header.label,
      logical_category_id: input.header.logical_category_id,
      logical_category_name: input.header.logical_category_name,
      created_by_username: input.header.created_by_username,
    })
    .select("*")
    .maybeSingle();

  if (headerErr) throw headerErr;
  if (!headerData) throw new Error("Impossibile creare progressivi_report_headers");

  const header = headerData as ProgressiviSnapshotHeader;

  const rowsPayload = normalizedInputRows
    .map((row) => normalizeSnapshotRow(header.id, row))
    .filter((row) => row.item_code);

  const { data: rowsData, error: rowsErr } = await supabaseAdmin
    .from("progressivi_report_rows")
    .insert(rowsPayload)
    .select("*");

  if (rowsErr) {
    await supabaseAdmin
      .from("progressivi_report_headers")
      .delete()
      .eq("id", header.id);

    throw rowsErr;
  }

  return {
    header,
    rows: (rowsData ?? []) as ProgressiviSnapshotRow[],
  };
}

export async function loadProgressiviSnapshot(snapshotId: string): Promise<{
  header: ProgressiviSnapshotHeader | null;
  rows: ProgressiviSnapshotRow[];
}> {
  const { data: headerData, error: headerErr } = await supabaseAdmin
    .from("progressivi_report_headers")
    .select("*")
    .eq("id", snapshotId)
    .maybeSingle();

  if (headerErr) throw headerErr;

  if (!headerData) {
    return { header: null, rows: [] };
  }

  const { data: rowsData, error: rowsErr } = await supabaseAdmin
    .from("progressivi_report_rows")
    .select("*")
    .eq("report_header_id", snapshotId)
    .order("item_code", { ascending: true });

  if (rowsErr) throw rowsErr;

  return {
    header: headerData as ProgressiviSnapshotHeader,
    rows: (rowsData ?? []) as ProgressiviSnapshotRow[],
  };
}

export async function replaceProgressiviSnapshotRows(
  input: UpdateSnapshotRowsInput
): Promise<ProgressiviSnapshotRow[]> {
  const reportHeaderId = String(input.report_header_id ?? "").trim();
  if (!reportHeaderId) throw new Error("report_header_id mancante");

  const rowsPayload = input.rows
    .map((row) => normalizeSnapshotRow(reportHeaderId, row))
    .filter((row) => row.item_code);

  const { error: delErr } = await supabaseAdmin
    .from("progressivi_report_rows")
    .delete()
    .eq("report_header_id", reportHeaderId);

  if (delErr) throw delErr;

  if (rowsPayload.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("progressivi_report_rows")
    .insert(rowsPayload)
    .select("*");

  if (error) throw error;

  return (data ?? []) as ProgressiviSnapshotRow[];
}

export async function updateSingleProgressiviSnapshotRow(params: {
  report_header_id: string;
  item_code: string;
  row: Omit<
    ProgressiviSnapshotRow,
    "id" | "report_header_id" | "created_at" | "updated_at"
  >;
}): Promise<ProgressiviSnapshotRow> {
  const reportHeaderId = String(params.report_header_id ?? "").trim();
  const itemCode = String(params.item_code ?? "").trim();

  if (!reportHeaderId) throw new Error("report_header_id mancante");
  if (!itemCode) throw new Error("item_code mancante");

  const payload = normalizeSnapshotRow(reportHeaderId, params.row);

  const { data, error } = await supabaseAdmin
    .from("progressivi_report_rows")
    .update(payload)
    .eq("report_header_id", reportHeaderId)
    .eq("item_code", itemCode)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Riga snapshot non trovata");

  return data as ProgressiviSnapshotRow;
}