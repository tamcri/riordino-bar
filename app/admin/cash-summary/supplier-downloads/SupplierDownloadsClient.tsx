"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { generateSupplierDownloadsPdf } from "@/lib/pdf/generateSupplierDownloadsPdf";

type PV = {
  id: string;
  code?: string | null;
  name?: string | null;
};

type SupplierDownloadRow = {
  id: string;
  summary_id: string;
  date: string;
  pv_id: string;
  pv_code: string;
  pv_name: string;
  supplier_code: string;
  supplier_name: string;
  amount: number;
  summary_status: string;
  is_closed: boolean;
  created_at?: string;
};

type PeriodPresetKey =
  | "current_month"
  | "current_week"
  | "last_month"
  | "last_30_days"
  | "custom";

type RecurringSupplierRow = {
  key: string;
  supplier_code: string;
  supplier_name: string;
  pv_id: string;
  pv_label: string;
  count: number;
  total_amount: number;
  average_amount: number;
  first_date: string;
  last_date: string;
  is_anomaly: boolean;
};

const PERIOD_PRESETS: Array<{ key: PeriodPresetKey; label: string }> = [
  { key: "current_month", label: "Mese corrente" },
  { key: "current_week", label: "Settimana corrente" },
  { key: "last_month", label: "Mese scorso" },
  { key: "last_30_days", label: "Ultimi 30 giorni" },
  { key: "custom", label: "Personalizzato" },
];

function toDateInputLocal(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getPresetDates(preset: PeriodPresetKey) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === "current_month") {
    return {
      dateFrom: toDateInputLocal(
        new Date(today.getFullYear(), today.getMonth(), 1)
      ),
      dateTo: toDateInputLocal(today),
    };
  }

  if (preset === "current_week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    return {
      dateFrom: toDateInputLocal(monday),
      dateTo: toDateInputLocal(today),
    };
  }

  if (preset === "last_month") {
    const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);

    return {
      dateFrom: toDateInputLocal(firstDay),
      dateTo: toDateInputLocal(lastDay),
    };
  }

  if (preset === "last_30_days") {
    const from = new Date(today);
    from.setDate(today.getDate() - 29);

    return {
      dateFrom: toDateInputLocal(from),
      dateTo: toDateInputLocal(today),
    };
  }

  return {
    dateFrom: "",
    dateTo: toDateInputLocal(today),
  };
}

function n(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function formatEuro(value: number | null | undefined) {
  const num = Number(value ?? 0);

  return num.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function formatLongDate(value: string) {
  if (!value) return "—";

  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;

  return `${dd}/${mm}/${yyyy}`;
}

function formatPvLabel(row: Pick<SupplierDownloadRow, "pv_code" | "pv_name">) {
  const code = cleanText(row.pv_code);
  const name = cleanText(row.pv_name);

  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  if (code) return code;

  return "PV";
}

function formatPvOptionLabel(pv: PV) {
  const code = cleanText(pv.code);
  const name = cleanText(pv.name);

  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  if (code) return code;

  return "PV";
}

function formatSupplierLabel(
  row: Pick<SupplierDownloadRow, "supplier_code" | "supplier_name">
) {
  const code = cleanText(row.supplier_code);
  const name = cleanText(row.supplier_name);

  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  if (code) return code;

  return "Fornitore non indicato";
}

function daysBetween(dateFrom: string, dateTo: string) {
  if (!dateFrom || !dateTo) return null;

  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T00:00:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;

  const diff = to.getTime() - from.getTime();
  return Math.floor(diff / 86400000) + 1;
}

function getAnomalyThreshold(dateFrom: string, dateTo: string) {
  const days = daysBetween(dateFrom, dateTo);

  if (days !== null && days <= 7) {
    return {
      label: "più di 2 scarichi nella settimana",
      value: 2,
    };
  }

  return {
    label: "più di 4 scarichi nel mese/periodo",
    value: 4,
  };
}

function normalizeRows(rows: unknown): SupplierDownloadRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.map((row: any) => ({
    id: cleanText(row?.id),
    summary_id: cleanText(row?.summary_id),
    date: cleanText(row?.date),
    pv_id: cleanText(row?.pv_id),
    pv_code: cleanText(row?.pv_code),
    pv_name: cleanText(row?.pv_name),
    supplier_code: cleanText(row?.supplier_code),
    supplier_name: cleanText(row?.supplier_name),
    amount: n(row?.amount),
    summary_status: cleanText(row?.summary_status),
    is_closed: Boolean(row?.is_closed),
    created_at: cleanText(row?.created_at),
  }));
}

export default function SupplierDownloadsClient() {
  const initialDates = useMemo(() => getPresetDates("current_month"), []);

  const [pvs, setPvs] = useState<PV[]>([]);
  const [rows, setRows] = useState<SupplierDownloadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pvsLoading, setPvsLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [periodPreset, setPeriodPreset] =
    useState<PeriodPresetKey>("current_month");
  const [dateFrom, setDateFrom] = useState(initialDates.dateFrom);
  const [dateTo, setDateTo] = useState(initialDates.dateTo);
  const [pvId, setPvId] = useState("");
  const [supplier, setSupplier] = useState("");

  async function loadPvs() {
    setPvsLoading(true);

    try {
      const res = await fetch("/api/pvs/list", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      const list = json?.pvs ?? json?.rows ?? [];

      setPvs(Array.isArray(list) ? list : []);
    } catch {
      setPvs([]);
    } finally {
      setPvsLoading(false);
    }
  }

  async function loadRows(overrides?: {
    dateFrom?: string;
    dateTo?: string;
    pvId?: string;
    supplier?: string;
  }) {
    setLoading(true);
    setMsg(null);

    try {
      const effectiveDateFrom = overrides?.dateFrom ?? dateFrom;
      const effectiveDateTo = overrides?.dateTo ?? dateTo;
      const effectivePvId = overrides?.pvId ?? pvId;
      const effectiveSupplier = overrides?.supplier ?? supplier;

      const params = new URLSearchParams();

      if (effectiveDateFrom) params.set("date_from", effectiveDateFrom);
      if (effectiveDateTo) params.set("date_to", effectiveDateTo);
      if (effectivePvId) params.set("pv_id", effectivePvId);
      if (cleanText(effectiveSupplier)) {
        params.set("supplier", cleanText(effectiveSupplier));
      }

      const res = await fetch(
        `/api/cash-summary/supplier-downloads?${params.toString()}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setRows([]);
        setMsg(
          json?.error || "Errore durante il caricamento scarichi fornitori"
        );
        return;
      }

      setRows(normalizeRows(json.rows));
    } catch {
      setRows([]);
      setMsg("Errore di rete durante il caricamento scarichi fornitori");
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(nextPreset: PeriodPresetKey) {
    setPeriodPreset(nextPreset);

    if (nextPreset === "custom") return;

    const nextDates = getPresetDates(nextPreset);
    setDateFrom(nextDates.dateFrom);
    setDateTo(nextDates.dateTo);

    loadRows({
      dateFrom: nextDates.dateFrom,
      dateTo: nextDates.dateTo,
    });
  }

  function resetFilters() {
    const nextDates = getPresetDates("current_month");

    setPeriodPreset("current_month");
    setDateFrom(nextDates.dateFrom);
    setDateTo(nextDates.dateTo);
    setPvId("");
    setSupplier("");

    loadRows({
      dateFrom: nextDates.dateFrom,
      dateTo: nextDates.dateTo,
      pvId: "",
      supplier: "",
    });
  }

  useEffect(() => {
    loadPvs();
    loadRows({
      dateFrom: initialDates.dateFrom,
      dateTo: initialDates.dateTo,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const totalDownloads = rows.length;
    const totalAmount = rows.reduce((sum, row) => sum + n(row.amount), 0);

    const suppliersMap = new Map<string, { label: string; count: number }>();
    const pvsMap = new Map<string, { label: string; count: number }>();

    rows.forEach((row) => {
      const supplierKey =
        cleanText(row.supplier_code) ||
        cleanText(row.supplier_name) ||
        "fornitore-non-indicato";

      const supplierCurrent = suppliersMap.get(supplierKey) ?? {
        label: formatSupplierLabel(row),
        count: 0,
      };

      supplierCurrent.count += 1;
      suppliersMap.set(supplierKey, supplierCurrent);

      const pvKey = cleanText(row.pv_id) || formatPvLabel(row);
      const pvCurrent = pvsMap.get(pvKey) ?? {
        label: formatPvLabel(row),
        count: 0,
      };

      pvCurrent.count += 1;
      pvsMap.set(pvKey, pvCurrent);
    });

    const topSupplier =
      Array.from(suppliersMap.values()).sort((a, b) => b.count - a.count)[0] ??
      null;

    const topPv =
      Array.from(pvsMap.values()).sort((a, b) => b.count - a.count)[0] ?? null;

    return {
      totalDownloads,
      totalAmount,
      distinctSuppliers: suppliersMap.size,
      topSupplier,
      topPv,
    };
  }, [rows]);

  const anomalyThreshold = useMemo(
    () => getAnomalyThreshold(dateFrom, dateTo),
    [dateFrom, dateTo]
  );

  const recurringSuppliers = useMemo<RecurringSupplierRow[]>(() => {
    const map = new Map<string, RecurringSupplierRow>();

    rows.forEach((row) => {
      const supplierCode = cleanText(row.supplier_code);
      const supplierName = cleanText(row.supplier_name);
      const supplierKey =
        supplierCode || supplierName || "fornitore-non-indicato";
      const pvKey = cleanText(row.pv_id) || formatPvLabel(row);
      const key = `${supplierKey}__${pvKey}`;

      const current = map.get(key) ?? {
        key,
        supplier_code: supplierCode,
        supplier_name: supplierName || "Fornitore non indicato",
        pv_id: cleanText(row.pv_id),
        pv_label: formatPvLabel(row),
        count: 0,
        total_amount: 0,
        average_amount: 0,
        first_date: row.date,
        last_date: row.date,
        is_anomaly: false,
      };

      current.count += 1;
      current.total_amount += n(row.amount);

      if (row.date && (!current.first_date || row.date < current.first_date)) {
        current.first_date = row.date;
      }

      if (row.date && (!current.last_date || row.date > current.last_date)) {
        current.last_date = row.date;
      }

      current.average_amount =
        current.count > 0 ? current.total_amount / current.count : 0;

      current.is_anomaly = current.count > anomalyThreshold.value;

      map.set(key, current);
    });

    return Array.from(map.values())
      .filter((row) => row.count > 1)
      .sort((a, b) => {
        if (a.is_anomaly !== b.is_anomaly) return a.is_anomaly ? -1 : 1;
        if (b.count !== a.count) return b.count - a.count;
        return b.total_amount - a.total_amount;
      });
  }, [rows, anomalyThreshold.value]);

  function downloadPdf() {
    const selectedPv = pvs.find((pv) => pv.id === pvId);
    const periodLabel =
      PERIOD_PRESETS.find((preset) => preset.key === periodPreset)?.label ??
      "Periodo selezionato";

    generateSupplierDownloadsPdf({
      rows,
      recurringSuppliers,
      stats,
      filters: {
        dateFrom,
        dateTo,
        periodLabel,
        pvLabel: selectedPv ? formatPvOptionLabel(selectedPv) : "Tutti i PV",
        supplier: cleanText(supplier) || "Tutti i fornitori",
        anomalyThresholdLabel: anomalyThreshold.label,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Filtri</h2>
            <p className="text-sm text-slate-500">
              Seleziona periodo, punto vendita e fornitore da analizzare.
            </p>
          </div>

          <button
            type="button"
            onClick={resetFilters}
            className="w-fit rounded-xl border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50"
          >
            Reset filtri
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Periodo</span>
            <select
              value={periodPreset}
              onChange={(e) => applyPreset(e.target.value as PeriodPresetKey)}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              {PERIOD_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Dal</span>
            <input
              type="date"
              value={dateFrom}
              disabled={periodPreset !== "custom"}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Al</span>
            <input
              type="date"
              value={dateTo}
              disabled={periodPreset !== "custom"}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">PV</span>
            <select
              value={pvId}
              onChange={(e) => setPvId(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              <option value="">Tutti i PV</option>
              {pvs.map((pv) => (
                <option key={pv.id} value={pv.id}>
                  {formatPvOptionLabel(pv)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">
              Fornitore
            </span>
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Codice o ragione sociale"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-500">
            {pvsLoading ? "Caricamento PV..." : `${pvs.length} PV disponibili`}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={downloadPdf}
              disabled={loading}
              className="rounded-xl border bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Scarica PDF
            </button>

            <button
              type="button"
              onClick={() => loadRows()}
              disabled={loading}
              className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Caricamento..." : "Applica filtri"}
            </button>
          </div>
        </div>

        {msg ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {msg}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Totale scarichi</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {stats.totalDownloads}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Totale importi</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {formatEuro(stats.totalAmount)}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Fornitori diversi</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {stats.distinctSuppliers}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Fornitore più frequente</div>
          <div className="mt-2 text-base font-semibold text-slate-900">
            {stats.topSupplier?.label ?? "—"}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {stats.topSupplier ? `${stats.topSupplier.count} scarichi` : ""}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">PV con più scarichi</div>
          <div className="mt-2 text-base font-semibold text-slate-900">
            {stats.topPv?.label ?? "—"}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {stats.topPv ? `${stats.topPv.count} scarichi` : ""}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Scarichi registrati
            </h2>
            <p className="text-sm text-slate-500">
              Elenco dei fornitori presenti nei riepiloghi incassato filtrati.
            </p>
          </div>

          <div className="text-sm font-medium text-slate-600">
            {rows.length} righe
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                  Data
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                  PV
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                  Codice fornitore
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                  Ragione sociale
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600">
                  Importo
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-center font-semibold text-slate-600">
                  Stato
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600">
                  Riepilogo
                </th>
              </tr>
            </thead>

            <tbody className="divide-y bg-white">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    Caricamento scarichi fornitori...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    Nessuno scarico fornitore trovato nel periodo selezionato.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id || `${row.summary_id}-${row.supplier_code}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatLongDate(row.date)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatPvLabel(row)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                      {row.supplier_code || "—"}
                    </td>

                    <td className="min-w-[240px] px-4 py-3 text-slate-700">
                      {row.supplier_name || "—"}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                      {formatEuro(row.amount)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <span
                        className={
                          row.is_closed
                            ? "inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                            : "inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                        }
                      >
                        {row.is_closed ? "Chiuso" : "Aperto"}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {row.summary_id ? (
                        <Link
                          href={`/admin/cash-summary/${row.summary_id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          Apri
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Fornitori ricorrenti
          </h2>
          <p className="text-sm text-slate-500">
            Evidenzia fornitori che scaricano più volte nello stesso PV. Soglia
            anomalia: {anomalyThreshold.label}.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                  Fornitore
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                  PV
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600">
                  N. scarichi
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600">
                  Importo totale
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600">
                  Media
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                  Prima data
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                  Ultima data
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-center font-semibold text-slate-600">
                  Anomalia
                </th>
              </tr>
            </thead>

            <tbody className="divide-y bg-white">
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    Caricamento analisi ricorrenze...
                  </td>
                </tr>
              ) : recurringSuppliers.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    Nessun fornitore ricorrente nel periodo selezionato.
                  </td>
                </tr>
              ) : (
                recurringSuppliers.map((row) => (
                  <tr
                    key={row.key}
                    className={row.is_anomaly ? "bg-red-50/60" : undefined}
                  >
                    <td className="min-w-[260px] px-4 py-3 text-slate-700">
                      <div className="font-semibold text-slate-900">
                        {row.supplier_name || "Fornitore non indicato"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {row.supplier_code || "Codice non indicato"}
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {row.pv_label}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                      {row.count}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                      {formatEuro(row.total_amount)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                      {formatEuro(row.average_amount)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatLongDate(row.first_date)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatLongDate(row.last_date)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      {row.is_anomaly ? (
                        <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                          Da controllare
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          Normale
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}