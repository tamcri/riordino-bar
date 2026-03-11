"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PV = {
  id: string;
  code: string;
  name: string;
};

type CheckState = "ok" | "check";

type MetricKey =
  | "incasso_totale"
  | "gv_pagati"
  | "vendita_tabacchi"
  | "vendita_gv"
  | "lis_plus"
  | "mooney"
  | "saldo_giorno"
  | "fondo_cassa";

type MetricChecksMap = Partial<Record<MetricKey, CheckState>>;

type RawRow = {
  id: string;
  pv_id: string;
  data: string;
  operatore: string;
  incasso_totale: number | null;
  gv_pagati: number | null;
  lis_plus: number | null;
  mooney: number | null;
  vendita_gv: number | null;
  vendita_tabacchi: number | null;
  da_versare: number | null;
  fondo_cassa: number | null;
  is_closed: boolean;
  pvs?: { code?: string; name?: string } | { code?: string; name?: string }[] | null;
};

type ViewRow = {
  id: string;
  pv_id: string;
  pv_label: string;
  pv_code: string;
  data: string;
  operatore: string;
  incasso_totale: number;
  gv_pagati: number;
  lis_plus: number;
  mooney: number;
  vendita_gv: number;
  vendita_tabacchi: number;
  saldo_giorno: number;
  progressivo_da_versare: number;
  fondo_cassa: number;
  delta_fondo_cassa: number | null;
  is_closed: boolean;
  metric_checks: MetricChecksMap;
};

type MetricOption = {
  key: MetricKey;
  label: string;
};

const METRIC_OPTIONS: MetricOption[] = [
  { key: "incasso_totale", label: "Incasso Totale" },
  { key: "gv_pagati", label: "Pagati G&V" },
  { key: "vendita_tabacchi", label: "Venduto Tabacchi" },
  { key: "vendita_gv", label: "Venduto G&V" },
  { key: "lis_plus", label: "LIS+" },
  { key: "mooney", label: "Mooney" },
  { key: "saldo_giorno", label: "Saldo Giorno" },
  { key: "fondo_cassa", label: "Fondo Cassa" },
];

const METRIC_COLORS: Record<MetricKey, string> = {
  incasso_totale: "#16a34a",
  gv_pagati: "#dc2626",
  vendita_tabacchi: "#2563eb",
  vendita_gv: "#9333ea",
  lis_plus: "#ea580c",
  mooney: "#ca8a04",
  saldo_giorno: "#db2777",
  fondo_cassa: "#334155",
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function pvLabelFromJoin(pvs: RawRow["pvs"]) {
  const row = Array.isArray(pvs) ? pvs[0] : pvs;
  const code = String(row?.code ?? "").trim();
  const name = String(row?.name ?? "").trim();

  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  if (code) return code;
  return "PV";
}

function pvCodeFromJoin(pvs: RawRow["pvs"]) {
  const row = Array.isArray(pvs) ? pvs[0] : pvs;
  return String(row?.code ?? "").trim() || "PV";
}

function formatEuro(value: number | null | undefined) {
  const num = Number(value ?? 0);
  return num.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function formatAxisEuro(value: number | null | undefined) {
  const num = Number(value ?? 0);

  if (Math.abs(num) >= 1000) {
    return `${num.toLocaleString("it-IT", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}€`;
  }

  return `${num.toLocaleString("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}€`;
}

function formatShortDate(value: string) {
  if (!value) return "";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}`;
}

function renderSaldoLabel(value: number) {
  if (value > 0) return `Da Versare ${formatEuro(value)}`;
  if (value < 0) return `Versato in più ${formatEuro(Math.abs(value))}`;
  return `Pareggio ${formatEuro(0)}`;
}

function metricLabel(metric: MetricKey) {
  switch (metric) {
    case "incasso_totale":
      return "Incasso Totale";
    case "gv_pagati":
      return "Pagati G&V";
    case "vendita_tabacchi":
      return "Venduto Tabacchi";
    case "vendita_gv":
      return "Venduto G&V";
    case "lis_plus":
      return "LIS+";
    case "mooney":
      return "Mooney";
    case "saldo_giorno":
      return "Saldo Giorno";
    case "fondo_cassa":
      return "Fondo Cassa";
    default:
      return "Valore";
  }
}

function metricValue(row: ViewRow, metric: MetricKey) {
  switch (metric) {
    case "incasso_totale":
      return row.incasso_totale;
    case "gv_pagati":
      return row.gv_pagati;
    case "vendita_tabacchi":
      return row.vendita_tabacchi;
    case "vendita_gv":
      return row.vendita_gv;
    case "lis_plus":
      return row.lis_plus;
    case "mooney":
      return row.mooney;
    case "saldo_giorno":
      return row.saldo_giorno;
    case "fondo_cassa":
      return row.fondo_cassa;
    default:
      return 0;
  }
}

function TooltipValue({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-white p-3 text-sm shadow-lg">
      <div className="font-medium text-slate-900">{label}</div>
      <div className="mt-1 text-gray-700">
        {payload.map((entry: any, index: number) => (
          <div key={`${entry?.name ?? "v"}-${index}`}>
            {entry.name}: <span className="font-semibold">{formatEuro(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CashSummaryAdminClient() {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(todayISO());

  const [rows, setRows] = useState<RawRow[]>([]);
  const [checksBySummary, setChecksBySummary] = useState<Record<string, MetricChecksMap>>({});
  const [saldoInizialeByPv, setSaldoInizialeByPv] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [metric, setMetric] = useState<MetricKey>("incasso_totale");
  const [showDetail, setShowDetail] = useState(false);
  const [detailSavingKey, setDetailSavingKey] = useState<string | null>(null);

  const [selectedComparePvIds, setSelectedComparePvIds] = useState<string[]>([]);

  const [balancePvId, setBalancePvId] = useState("");
  const [balanceStartDate, setBalanceStartDate] = useState("2026-02-28");
  const [balanceValue, setBalanceValue] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceMsg, setBalanceMsg] = useState<string | null>(null);

  async function loadPvs() {
    try {
      const res = await fetch("/api/pvs/list", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      const list = (json?.pvs ?? json?.rows) ?? [];
      const normalized = Array.isArray(list) ? list : [];
      setPvs(normalized);

      if (!balancePvId && normalized[0]?.id) {
        setBalancePvId(normalized[0].id);
      }
    } catch {
      setPvs([]);
    }
  }

  async function loadRows() {
    setLoading(true);
    setMsg(null);

    try {
      const params = new URLSearchParams();

      if (pvId) params.set("pv_id", pvId);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await fetch(`/api/cash-summary/list?${params.toString()}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setRows([]);
        setChecksBySummary({});
        setSaldoInizialeByPv({});
        setMsg(json?.error || "Errore caricamento riepiloghi");
        return;
      }

      setRows(Array.isArray(json.rows) ? json.rows : []);
      setChecksBySummary(
        json?.checks_by_summary && typeof json.checks_by_summary === "object"
          ? json.checks_by_summary
          : {}
      );
      setSaldoInizialeByPv(
        json?.saldo_iniziale_by_pv && typeof json.saldo_iniziale_by_pv === "object"
          ? json.saldo_iniziale_by_pv
          : {}
      );
    } catch {
      setRows([]);
      setChecksBySummary({});
      setSaldoInizialeByPv({});
      setMsg("Errore di rete");
    } finally {
      setLoading(false);
    }
  }

  async function loadBalanceStart(selectedPvId: string) {
    if (!selectedPvId) {
      setBalanceValue(null);
      setBalanceMsg(null);
      return;
    }

    setBalanceLoading(true);
    setBalanceMsg(null);

    try {
      const res = await fetch(
        `/api/cash-summary/balance-start/get?pv_id=${encodeURIComponent(selectedPvId)}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setBalanceValue(null);
        setBalanceMsg(json?.error || "Errore lettura saldo iniziale");
        return;
      }

      if (json.row) {
        setBalanceStartDate(String(json.row.start_date ?? "2026-02-28"));
        setBalanceValue(Number(json.row.saldo_iniziale ?? 0) || 0);
      } else {
        setBalanceStartDate("2026-02-28");
        setBalanceValue(null);
      }
    } catch {
      setBalanceMsg("Errore di rete");
      setBalanceValue(null);
    } finally {
      setBalanceLoading(false);
    }
  }

  async function saveBalanceStart(e: React.FormEvent) {
    e.preventDefault();

    if (!balancePvId) {
      setBalanceMsg("Seleziona un PV.");
      return;
    }

    if (!balanceStartDate) {
      setBalanceMsg("Data obbligatoria.");
      return;
    }

    if (balanceValue === null) {
      setBalanceMsg("Saldo iniziale obbligatorio.");
      return;
    }

    setBalanceLoading(true);
    setBalanceMsg(null);

    try {
      const res = await fetch("/api/cash-summary/balance-start/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pv_id: balancePvId,
          start_date: balanceStartDate,
          saldo_iniziale: balanceValue,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setBalanceMsg(json?.error || "Errore salvataggio saldo iniziale");
        return;
      }

      setBalanceMsg("Saldo iniziale salvato.");
      await loadBalanceStart(balancePvId);
      await loadRows();
    } catch {
      setBalanceMsg("Errore di rete");
    } finally {
      setBalanceLoading(false);
    }
  }

  function toggleComparePv(pvIdToToggle: string) {
    setSelectedComparePvIds((prev) =>
      prev.includes(pvIdToToggle)
        ? prev.filter((id) => id !== pvIdToToggle)
        : [...prev, pvIdToToggle]
    );
  }

  async function saveDetailCheck(summaryId: string, metricKey: MetricKey, status: CheckState) {
    const savingKey = `${summaryId}:${metricKey}`;
    setDetailSavingKey(savingKey);
    setMsg(null);

    const previousChecks = checksBySummary;

    setChecksBySummary((prev) => ({
      ...prev,
      [summaryId]: {
        ...(prev[summaryId] ?? {}),
        [metricKey]: status,
      },
    }));

    try {
      const res = await fetch("/api/cash-summary/admin-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary_id: summaryId,
          metric_key: metricKey,
          status,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setChecksBySummary(previousChecks);
        setMsg(json?.error || "Errore salvataggio stato controllo");
        return;
      }
    } catch {
      setChecksBySummary(previousChecks);
      setMsg("Errore di rete");
    } finally {
      setDetailSavingKey(null);
    }
  }

  useEffect(() => {
    loadPvs();
  }, []);

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!balancePvId) return;
    loadBalanceStart(balancePvId);
  }, [balancePvId]);

  const computedRows = useMemo<ViewRow[]>(() => {
    const sorted = [...rows].sort((a, b) => {
      if (a.pv_id !== b.pv_id) return a.pv_id.localeCompare(b.pv_id);
      return a.data.localeCompare(b.data);
    });

    const progressivoByPv = new Map<string, number>();
    const lastFondoByPv = new Map<string, number>();

    const mapped = sorted.map((row) => {
      const saldoGiorno = n(row.da_versare);
      const fondo = n(row.fondo_cassa);

      const initialProgressivo =
        progressivoByPv.has(row.pv_id)
          ? progressivoByPv.get(row.pv_id) ?? 0
          : n(saldoInizialeByPv[row.pv_id]);

      const progressivo = initialProgressivo + saldoGiorno;
      progressivoByPv.set(row.pv_id, progressivo);

      const prevFondo = lastFondoByPv.get(row.pv_id);
      const deltaFondo = prevFondo === undefined ? null : fondo - prevFondo;
      lastFondoByPv.set(row.pv_id, fondo);

      return {
        id: row.id,
        pv_id: row.pv_id,
        pv_label: pvLabelFromJoin(row.pvs),
        pv_code: pvCodeFromJoin(row.pvs),
        data: row.data,
        operatore: String(row.operatore ?? ""),
        incasso_totale: n(row.incasso_totale),
        gv_pagati: n(row.gv_pagati),
        lis_plus: n(row.lis_plus),
        mooney: n(row.mooney),
        vendita_gv: n(row.vendita_gv),
        vendita_tabacchi: n(row.vendita_tabacchi),
        saldo_giorno: saldoGiorno,
        progressivo_da_versare: progressivo,
        fondo_cassa: fondo,
        delta_fondo_cassa: deltaFondo,
        is_closed: !!row.is_closed,
        metric_checks: checksBySummary[row.id] ?? {},
      };
    });

    return mapped.sort((a, b) => {
      if (a.data !== b.data) return b.data.localeCompare(a.data);
      return a.pv_label.localeCompare(b.pv_label);
    });
  }, [rows, saldoInizialeByPv, checksBySummary]);

  const chartData = useMemo(() => {
    const grouped = new Map<
      string,
      {
        label: string;
        total: number;
        count: number;
      }
    >();

    const sorted = [...computedRows].sort((a, b) => a.data.localeCompare(b.data));

    sorted.forEach((row) => {
      const value = metricValue(row, metric);
      const prev = grouped.get(row.data) ?? {
        label: formatShortDate(row.data),
        total: 0,
        count: 0,
      };

      prev.total += value;
      prev.count += 1;

      grouped.set(row.data, prev);
    });

    const entries = Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, item]) => ({
        date,
        label: item.label,
        value: item.total,
      }));

    const total = entries.reduce((sum, item) => sum + item.value, 0);
    const avg = entries.length ? total / entries.length : 0;

    return {
      rows: entries,
      average: avg,
    };
  }, [computedRows, metric]);

  const compareByPv = useMemo(() => {
    const filteredRows =
      selectedComparePvIds.length > 0
        ? computedRows.filter((row) => selectedComparePvIds.includes(row.pv_id))
        : computedRows;

    const map = new Map<
      string,
      {
        pv_id: string;
        pv_label: string;
        pv_code: string;
        total: number;
      }
    >();

    filteredRows.forEach((row) => {
      const value = metricValue(row, metric);

      const prev = map.get(row.pv_id) ?? {
        pv_id: row.pv_id,
        pv_label: row.pv_label,
        pv_code: row.pv_code,
        total: 0,
      };

      prev.total += value;
      map.set(row.pv_id, prev);
    });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [computedRows, metric, selectedComparePvIds]);

  const comparisonChartData = useMemo(() => {
    const metricColor = METRIC_COLORS[metric];

    return compareByPv.map((row) => ({
      name: row.pv_code,
      totale: row.total,
      fill: row.total < 0 ? "#dc2626" : metricColor,
    }));
  }, [compareByPv, metric]);

  const detailRows = useMemo(() => {
    return [...computedRows]
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((row) => ({
        id: row.id,
        data: row.data,
        pv_label: row.pv_label,
        operatore: row.operatore,
        value: metricValue(row, metric),
        status: row.metric_checks[metric] ?? null,
      }));
  }, [computedRows, metric]);

  const currentMetricCheckCount = useMemo(() => {
    return detailRows.filter((row) => row.status === "check").length;
  }, [detailRows]);

  const metricCheckCounts = useMemo(() => {
    const counts: Record<MetricKey, number> = {
      incasso_totale: 0,
      gv_pagati: 0,
      vendita_tabacchi: 0,
      vendita_gv: 0,
      lis_plus: 0,
      mooney: 0,
      saldo_giorno: 0,
      fondo_cassa: 0,
    };

    for (const row of computedRows) {
      for (const metricOption of METRIC_OPTIONS) {
        if (row.metric_checks[metricOption.key] === "check") {
          counts[metricOption.key] += 1;
        }
      }
    }

    return counts;
  }, [computedRows]);

  async function onFilter(e: React.FormEvent) {
    e.preventDefault();
    await loadRows();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Saldo iniziale PV</h2>
        <p className="mt-1 text-sm text-gray-600">
          Serve solo come punto di partenza del progressivo. Dopo il riporto continua in automatico.
        </p>

        <form onSubmit={saveBalanceStart} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Punto Vendita</label>
            <select
              className="w-full rounded-xl border bg-white p-3"
              value={balancePvId}
              onChange={(e) => setBalancePvId(e.target.value)}
            >
              <option value="">Seleziona</option>
              {pvs.map((pv) => (
                <option key={pv.id} value={pv.id}>
                  {pv.code} — {pv.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Data riferimento</label>
            <input
              type="date"
              className="w-full rounded-xl border bg-white p-3"
              value={balanceStartDate}
              onChange={(e) => setBalanceStartDate(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Saldo iniziale</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-xl border bg-white p-3"
              value={balanceValue ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                setBalanceValue(raw === "" ? null : Number(raw));
              }}
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-xl bg-slate-900 p-3 text-white disabled:opacity-60"
              disabled={balanceLoading}
            >
              {balanceLoading ? "Salvo..." : "Salva saldo iniziale"}
            </button>
          </div>
        </form>

        {balanceMsg && <div className="mt-3 text-sm text-gray-700">{balanceMsg}</div>}
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Filtri</h2>

        <form onSubmit={onFilter} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Punto Vendita</label>
            <select
              className="w-full rounded-xl border bg-white p-3"
              value={pvId}
              onChange={(e) => setPvId(e.target.value)}
            >
              <option value="">Tutti</option>
              {pvs.map((pv) => (
                <option key={pv.id} value={pv.id}>
                  {pv.code} — {pv.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Data da</label>
            <input
              type="date"
              className="w-full rounded-xl border bg-white p-3"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Data a</label>
            <input
              type="date"
              className="w-full rounded-xl border bg-white p-3"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-xl bg-slate-900 p-3 text-white disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Carico..." : "Applica filtri"}
            </button>
          </div>
        </form>

        {msg && <div className="mt-3 text-sm text-gray-700">{msg}</div>}
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Andamento PV</h2>
            <p className="mt-1 text-sm text-gray-600">
              Seleziona la metrica da analizzare e apri il dettaglio per il controllo dei movimenti.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {currentMetricCheckCount > 0 && (
              <div className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-sm font-medium text-orange-700">
                Ricontrollare: {currentMetricCheckCount}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowDetail((prev) => !prev)}
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            >
              {showDetail ? "Chiudi Dettaglio" : "Dettaglio"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {METRIC_OPTIONS.map((option) => {
            const active = metric === option.key;
            const checkCount = metricCheckCounts[option.key];

            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setMetric(option.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
                }`}
              >
                <span>{option.label}</span>

                {checkCount > 0 && (
                  <span
                    className={`inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      active
                        ? "bg-orange-400 text-white"
                        : "border border-orange-300 bg-orange-50 text-orange-700"
                    }`}
                  >
                    {checkCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-6 h-80 rounded-2xl border bg-slate-50 p-4">
          {chartData.rows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData.rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={formatAxisEuro} width={70} />
                <Tooltip content={<TooltipValue />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={metricLabel(metric)}
                  stroke={METRIC_COLORS[metric]}
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              Nessun dato disponibile per il grafico.
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <div className="rounded-xl border bg-slate-50 px-4 py-3 text-right">
            <div className="text-xs uppercase tracking-wide text-gray-500">Media giornaliera</div>
            <div className="text-lg font-semibold text-slate-900">
              {formatEuro(chartData.average)}
            </div>
          </div>
        </div>

        {showDetail && (
          <div className="mt-6 rounded-2xl border bg-white p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">
                  Dettaglio movimenti — {metricLabel(metric)}
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  Segna le righe come OK oppure Da ricontrollare.
                </p>
              </div>
            </div>

            {currentMetricCheckCount > 0 && (
              <div className="mb-4 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                Attenzione: ci sono {currentMetricCheckCount} movimenti da ricontrollare in questa metrica.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 text-left">Data</th>
                    <th className="p-2 text-left">PV</th>
                    <th className="p-2 text-left">Operatore</th>
                    <th className="p-2 text-right">{metricLabel(metric)}</th>
                    <th className="p-2 text-center">Stato</th>
                    <th className="p-2 text-center">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((row) => {
                    const status = row.status;
                    const isSaving = detailSavingKey === `${row.id}:${metric}`;

                    return (
                      <tr
                        key={`${metric}-${row.id}`}
                        className={`border-t ${
                          status === "ok"
                            ? "bg-green-50"
                            : status === "check"
                              ? "bg-orange-50"
                              : ""
                        }`}
                      >
                        <td className="p-2">{row.data}</td>
                        <td className="p-2">{row.pv_label}</td>
                        <td className="p-2">{row.operatore}</td>
                        <td className="p-2 text-right">{formatEuro(row.value)}</td>
                        <td className="p-2 text-center">
                          {status === "ok" ? (
                            <span className="font-medium text-green-700">OK</span>
                          ) : status === "check" ? (
                            <span className="font-medium text-orange-700">Ricontrollare</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <div className="flex justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => saveDetailCheck(row.id, metric, "ok")}
                              disabled={isSaving}
                              className="rounded-lg border border-green-600 px-3 py-1 text-green-700 hover:bg-green-50 disabled:opacity-50"
                            >
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={() => saveDetailCheck(row.id, metric, "check")}
                              disabled={isSaving}
                              className="rounded-lg border border-orange-600 px-3 py-1 text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                            >
                              Ricontrolla
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {detailRows.length === 0 && (
                    <tr className="border-t">
                      <td className="p-3 text-gray-500" colSpan={6}>
                        Nessun movimento disponibile.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Confronto PV</h2>
        <p className="mt-1 text-sm text-gray-600">
          Seleziona due o più PV per confrontare il totale periodo sulla metrica selezionata.
        </p>

        <div className="mt-4">
          <div className="mb-2 block text-sm font-medium">PV da confrontare</div>

          <div className="flex flex-wrap gap-2">
            {pvs.map((pv) => {
              const active = selectedComparePvIds.includes(pv.id);

              return (
                <button
                  key={pv.id}
                  type="button"
                  onClick={() => toggleComparePv(pv.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
                  }`}
                >
                  {pv.code}
                </button>
              );
            })}
          </div>

          <div className="mt-2 text-xs text-gray-500">
            Se non selezioni nulla, il confronto mostra automaticamente tutti i PV.
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="h-80 rounded-2xl border bg-slate-50 p-4">
            {comparisonChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonChartData} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={formatAxisEuro} width={80} />
                  <Tooltip content={<TooltipValue />} />
                  <Legend />
                  <Bar dataKey="totale" name="Totale periodo" radius={[8, 8, 0, 0]}>
                    {comparisonChartData.map((entry, index) => (
                      <Cell key={`cell-${entry.name}-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">
                Nessun dato disponibile per il confronto.
              </div>
            )}
          </div>

          <div className="space-y-3">
            {compareByPv.map((row) => {
              const max = Math.max(...compareByPv.map((x) => Math.abs(x.total)), 1);
              const width = (Math.abs(row.total) / max) * 100;

              return (
                <div key={row.pv_id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
               <span className="truncate font-medium">{row.pv_label}</span>
              <span className="font-semibold">{formatEuro(row.total)}</span>
              </div>
                  <div className="h-4 overflow-hidden rounded bg-gray-100">
                    <div
                      className={row.total < 0 ? "h-full bg-red-600" : ""}
                      style={{
                        width: `${width}%`,
                        backgroundColor: row.total < 0 ? "#dc2626" : METRIC_COLORS[metric],
                      }}
                    />
                  </div>
                </div>
              );
            })}

            {compareByPv.length === 0 && (
              <div className="text-sm text-gray-500">
                Nessun dato disponibile per il confronto.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Storico Riepiloghi</h2>
        <p className="mt-1 text-sm text-gray-600">
          Il progressivo usa il saldo iniziale del PV e continua automaticamente nel tempo.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">Data</th>
                <th className="p-2 text-left">PV</th>
                <th className="p-2 text-right">Incasso Totale</th>
                <th className="p-2 text-right">Vendita G&amp;V</th>
                <th className="p-2 text-right">Vendita Tabacchi</th>
                <th className="p-2 text-right">Saldo giorno</th>
                <th className="p-2 text-right">Progressivo</th>
                <th className="p-2 text-right">Fondo Cassa</th>
                <th className="p-2 text-right">Δ Fondo Cassa</th>
                <th className="p-2 text-center">Stato</th>
                <th className="p-2 text-center">Azioni</th>
                            
              </tr>
            </thead>

            <tbody>
              {computedRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">{row.data}</td>
                  <td className="p-2">{row.pv_label}</td>
                  <td className="p-2 text-right">{formatEuro(row.incasso_totale)}</td>
                  <td className="p-2 text-right">{formatEuro(row.vendita_gv)}</td>
                  <td className="p-2 text-right">{formatEuro(row.vendita_tabacchi)}</td>
                  <td
                    className={`p-2 text-right font-medium ${
                      row.saldo_giorno > 0
                        ? "text-red-700"
                        : row.saldo_giorno < 0
                          ? "text-green-700"
                          : "text-gray-700"
                    }`}
                  >
                    {renderSaldoLabel(row.saldo_giorno)}
                  </td>
                  <td
                    className={`p-2 text-right font-semibold ${
                      row.progressivo_da_versare > 0
                        ? "text-red-700"
                        : row.progressivo_da_versare < 0
                          ? "text-green-700"
                          : "text-gray-700"
                    }`}
                  >
                    {formatEuro(row.progressivo_da_versare)}
                  </td>
                  <td className="p-2 text-right">{formatEuro(row.fondo_cassa)}</td>
                  <td className="p-2 text-right">
                    {row.delta_fondo_cassa === null ? "—" : formatEuro(row.delta_fondo_cassa)}
                  </td>
                  <td className="p-2 text-center">{row.is_closed ? "Chiuso" : "Aperto"}</td>
                  <td className="p-2 text-center">
                    <a
                      href={`/admin/cash-summary/${row.id}`}
                      className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-100"
                    >
                      Apri
                    </a>
                  </td>
                </tr>
              ))}

              {!loading && computedRows.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-gray-500" colSpan={11}>
                    Nessun riepilogo trovato.
                  </td>
                </tr>
              )}

              {loading && (
                <tr className="border-t">
                  <td className="p-3 text-gray-500" colSpan={11}>
                    Caricamento...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}