"use client";
import { generateCashSummaryExcelReport } from "@/lib/cash-summary-report-excel";
import {
  generateCashSummaryDataReport,
  type CashSummaryDataReportRow,
} from "@/lib/cash-summary-report-data";
import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  CartesianGrid,
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
  | "mooney";

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

type ComparisonSeriesMeta = {
  pv_id: string;
  pv_code: string;
  pv_label: string;
  color: string;
};

const METRIC_OPTIONS: MetricOption[] = [
  { key: "incasso_totale", label: "Incasso Totale" },
  { key: "gv_pagati", label: "Pagati G&V" },
  { key: "vendita_tabacchi", label: "Venduto Tabacchi" },
  { key: "vendita_gv", label: "Venduto G&V" },
  { key: "lis_plus", label: "LIS+" },
  { key: "mooney", label: "Mooney" },
];

const METRIC_COLORS: Record<MetricKey, string> = {
  incasso_totale: "#16a34a",
  gv_pagati: "#dc2626",
  vendita_tabacchi: "#2563eb",
  vendita_gv: "#9333ea",
  lis_plus: "#ea580c",
  mooney: "#ca8a04",
};

const PV_COMPARE_LINE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
  "#be185d",
  "#4f46e5",
  "#0f766e",
  "#7c3aed",
  "#1d4ed8",
];

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

function formatLongDate(value: string) {
  if (!value) return "";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
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

function ComparisonTooltip({
  active,
  payload,
  label,
  seriesMap,
}: {
  active?: boolean;
  payload?: Array<any>;
  label?: string;
  seriesMap: Record<string, ComparisonSeriesMeta>;
}) {
  if (!active || !payload?.length) return null;

  const sortedPayload = [...payload]
    .filter((entry) => Number.isFinite(Number(entry?.value)))
    .sort((a, b) => Number(b?.value ?? 0) - Number(a?.value ?? 0));

  if (sortedPayload.length === 0) return null;

  return (
    <div className="min-w-[220px] rounded-xl border bg-white p-3 text-sm shadow-lg">
      <div className="border-b pb-2 font-semibold text-slate-900">
        {formatLongDate(String(label ?? ""))}
      </div>

      <div className="mt-2 space-y-1.5">
        {sortedPayload.map((entry, index) => {
          const meta = seriesMap[String(entry.dataKey)] ?? null;
          return (
            <div
              key={`${entry?.dataKey ?? "series"}-${index}`}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex min-w-0 items-center gap-2 text-slate-700">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: meta?.color ?? "#64748b" }}
                />
                <span className="truncate">{meta?.pv_label ?? entry?.name ?? "PV"}</span>
              </div>
              <span className="shrink-0 font-semibold text-slate-900">
                {formatEuro(Number(entry?.value ?? 0))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function computePercentDifference(initialValue: number | null, finalValue: number | null) {
  const initial = Number(initialValue);
  const final = Number(finalValue);

  if (!Number.isFinite(initial) || !Number.isFinite(final) || initial === 0) {
    return null;
  }

  return ((final - initial) / initial) * 100;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function fallbackColorFromString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PV_COMPARE_LINE_COLORS[Math.abs(hash) % PV_COMPARE_LINE_COLORS.length];
}

function drawKpiBox(pdf: jsPDF, x: number, y: number, w: number, h: number, title: string, value: string, note?: string) {
  pdf.setDrawColor(203, 213, 225);
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(x, y, w, h, 2, 2, "FD");

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.text(title, x + 3, y + 5);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text(value, x + 3, y + 12);

  if (note) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    const lines = pdf.splitTextToSize(note, w - 6);
    pdf.text(lines, x + 3, y + 17);
  }
}

function drawSimpleLineChart(
  pdf: jsPDF,
  rows: Array<{ date: string; value: number }>,
  x: number,
  y: number,
  w: number,
  h: number,
  colorHex: string,
  metricTitle: string
) {
  pdf.setDrawColor(203, 213, 225);
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(x, y, w, h, 2, 2, "FD");


  if (rows.length === 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(100, 116, 139);
    pdf.text("Nessun dato disponibile", x + 3, y + 15);
    return;
  }

  const plotX = x + 8;
  const plotY = y + 8;
  const plotW = w - 12;
  const plotH = h - 14;

  const values = rows.map((row) => row.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  pdf.setDrawColor(226, 232, 240);
  for (let i = 0; i <= 4; i += 1) {
    const gy = plotY + (plotH / 4) * i;
    pdf.line(plotX, gy, plotX + plotW, gy);
  }
  pdf.line(plotX, plotY, plotX, plotY + plotH);
  pdf.line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  const rgb = colorHex.replace("#", "");
  const r = parseInt(rgb.substring(0, 2), 16);
  const g = parseInt(rgb.substring(2, 4), 16);
  const b = parseInt(rgb.substring(4, 6), 16);

  pdf.setDrawColor(r, g, b);
  pdf.setLineWidth(0.8);

  let prevX = 0;
  let prevY = 0;
  rows.forEach((row, index) => {
    const px = plotX + (rows.length === 1 ? plotW / 2 : (plotW / (rows.length - 1)) * index);
    const py = plotY + plotH - ((row.value - min) / range) * plotH;

    if (index > 0) {
      pdf.line(prevX, prevY, px, py);
    }

    pdf.setFillColor(r, g, b);
    pdf.circle(px, py, 0.9, "F");
    prevX = px;
    prevY = py;
  });
}

export default function CashSummaryAdminClient() {
  const reportChartRef = useRef<HTMLDivElement | null>(null);

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
  const [detailFilter, setDetailFilter] = useState<"all" | "check">("all");

  const [selectedComparePvIds, setSelectedComparePvIds] = useState<string[]>([]);
  const [activeComparePvId, setActiveComparePvId] = useState<string | null>(null);

  const [showBalanceBlock, setShowBalanceBlock] = useState(false);
  const [showFondoBlock, setShowFondoBlock] = useState(false);

  const [balancePvId, setBalancePvId] = useState("");
  const [balanceStartDate, setBalanceStartDate] = useState("2026-02-28");
  const [balanceValue, setBalanceValue] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceMsg, setBalanceMsg] = useState<string | null>(null);

  const [fondoPvId, setFondoPvId] = useState("");
  const [fondoValue, setFondoValue] = useState<number | null>(null);
  const [fondoLoading, setFondoLoading] = useState(false);
  const [fondoMsg, setFondoMsg] = useState<string | null>(null);

  const [chartFondoInitialValue, setChartFondoInitialValue] = useState<number | null>(null);
  const [chartFondoLoading, setChartFondoLoading] = useState(false);

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

      if (!fondoPvId && normalized[0]?.id) {
        setFondoPvId(normalized[0].id);
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

  async function loadFondoCassaIniziale(selectedPvId: string) {
    if (!selectedPvId) {
      setFondoValue(null);
      setFondoMsg(null);
      return;
    }

    setFondoLoading(true);
    setFondoMsg(null);

    try {
      const res = await fetch(
        `/api/cash-summary/fondo-cassa-iniziale/get?pv_id=${encodeURIComponent(selectedPvId)}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setFondoValue(null);
        setFondoMsg(json?.error || "Errore lettura fondo cassa iniziale");
        return;
      }

      if (json.row) {
        setFondoValue(Number(json.row.fondo_cassa_iniziale ?? 0) || 0);
      } else {
        setFondoValue(null);
      }
    } catch {
      setFondoMsg("Errore di rete");
      setFondoValue(null);
    } finally {
      setFondoLoading(false);
    }
  }

  async function saveFondoCassaIniziale(e: React.FormEvent) {
    e.preventDefault();

    if (!fondoPvId) {
      setFondoMsg("Seleziona un PV.");
      return;
    }

    if (fondoValue === null) {
      setFondoMsg("Fondo cassa iniziale obbligatorio.");
      return;
    }

    setFondoLoading(true);
    setFondoMsg(null);

    try {
      const res = await fetch("/api/cash-summary/fondo-cassa-iniziale/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pv_id: fondoPvId,
          fondo_cassa_iniziale: fondoValue,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setFondoMsg(json?.error || "Errore salvataggio fondo cassa iniziale");
        return;
      }

      setFondoMsg("Fondo cassa iniziale salvato.");
      await loadFondoCassaIniziale(fondoPvId);
    } catch {
      setFondoMsg("Errore di rete");
    } finally {
      setFondoLoading(false);
    }
  }

  async function loadChartFondoInitial(selectedPvId: string) {
    if (!selectedPvId) {
      setChartFondoInitialValue(null);
      setChartFondoLoading(false);
      return;
    }

    setChartFondoLoading(true);

    try {
      const res = await fetch(
        `/api/cash-summary/fondo-cassa-iniziale/get?pv_id=${encodeURIComponent(selectedPvId)}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setChartFondoInitialValue(null);
        return;
      }

      if (json.row) {
        setChartFondoInitialValue(Number(json.row.fondo_cassa_iniziale ?? 0) || 0);
      } else {
        setChartFondoInitialValue(null);
      }
    } catch {
      setChartFondoInitialValue(null);
    } finally {
      setChartFondoLoading(false);
    }
  }

  function toggleComparePv(pvIdToToggle: string) {
    setSelectedComparePvIds((prev) =>
      prev.includes(pvIdToToggle)
        ? prev.filter((id) => id !== pvIdToToggle)
        : [...prev, pvIdToToggle]
    );
  }

  async function saveDetailCheck(summaryId: string, metricKey: MetricKey, status: CheckState | null) {
    const savingKey = `${summaryId}:${metricKey}`;
    setDetailSavingKey(savingKey);
    setMsg(null);

    const previousChecks = checksBySummary;

    setChecksBySummary((prev) => {
      const currentRowChecks = prev[summaryId] ?? {};
      const nextRowChecks = { ...currentRowChecks };

      if (status === null) {
        delete nextRowChecks[metricKey];
      } else {
        nextRowChecks[metricKey] = status;
      }

      return {
        ...prev,
        [summaryId]: nextRowChecks,
      };
    });

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

  useEffect(() => {
    if (!fondoPvId) return;
    loadFondoCassaIniziale(fondoPvId);
  }, [fondoPvId]);

  useEffect(() => {
    if (!pvId) {
      setChartFondoInitialValue(null);
      setChartFondoLoading(false);
      return;
    }

    loadChartFondoInitial(pvId);
  }, [pvId]);

  const compareColorByPvId = useMemo(() => {
    const map: Record<string, string> = {};
    pvs.forEach((pv, index) => {
      map[pv.id] = PV_COMPARE_LINE_COLORS[index % PV_COMPARE_LINE_COLORS.length];
    });
    return map;
  }, [pvs]);

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
      total,
      average: avg,
    };
  }, [computedRows, metric]);

  const bestRow = useMemo(() => {
    if (chartData.rows.length === 0) return null;
    return [...chartData.rows].sort((a, b) => b.value - a.value)[0];
  }, [chartData.rows]);

  const worstRow = useMemo(() => {
    if (chartData.rows.length === 0) return null;
    return [...chartData.rows].sort((a, b) => a.value - b.value)[0];
  }, [chartData.rows]);

  const latestFilteredPvRow = useMemo(() => {
    if (!pvId) return null;

    const filtered = computedRows.filter((row) => row.pv_id === pvId);
    if (filtered.length === 0) return null;

    const sorted = [...filtered].sort((a, b) => {
      if (a.data !== b.data) return b.data.localeCompare(a.data);
      return b.id.localeCompare(a.id);
    });

    return sorted[0];
  }, [computedRows, pvId]);

  const fondoCassaPercent = useMemo(() => {
    if (!pvId) return null;
    if (!latestFilteredPvRow) return null;
    return computePercentDifference(chartFondoInitialValue, latestFilteredPvRow.fondo_cassa);
  }, [pvId, chartFondoInitialValue, latestFilteredPvRow]);

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
    const filteredRows =
      selectedComparePvIds.length > 0
        ? computedRows.filter((row) => selectedComparePvIds.includes(row.pv_id))
        : computedRows;

    const grouped = new Map<string, Record<string, number | string>>();

    filteredRows
      .slice()
      .sort((a, b) => a.data.localeCompare(b.data))
      .forEach((row) => {
        const current = grouped.get(row.data) ?? {
          date: row.data,
          label: formatShortDate(row.data),
        };

        current[row.pv_id] = n(current[row.pv_id]) + metricValue(row, metric);
        grouped.set(row.data, current);
      });

    const rows = Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, value]) => value);

    const series = compareByPv.map((row) => ({
      pv_id: row.pv_id,
      pv_code: row.pv_code,
      pv_label: row.pv_label,
      color: compareColorByPvId[row.pv_id] ?? fallbackColorFromString(row.pv_id),
    }));

    return {
      rows,
      series,
    };
  }, [compareByPv, compareColorByPvId, computedRows, metric, selectedComparePvIds]);

  const comparisonSeriesMap = useMemo(() => {
    const map: Record<string, ComparisonSeriesMeta> = {};
    comparisonChartData.series.forEach((series) => {
      map[series.pv_id] = series;
    });
    return map;
  }, [comparisonChartData.series]);

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

  const filteredDetailRows = useMemo(() => {
    if (detailFilter === "check") {
      return detailRows.filter((row) => row.status === "check");
    }
    return detailRows;
  }, [detailRows, detailFilter]);

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

    function handleGenerateDataReport() {
    try {
      const rowsForReport = computedRows.map((row) => ({
        data: row.data,
        pv_label: row.pv_label,
        operatore: row.operatore,
        incasso_totale: Number(row.incasso_totale || 0),
        gv_pagati: Number(row.gv_pagati || 0),
        lis_plus: Number(row.lis_plus || 0),
        mooney: Number(row.mooney || 0),
        vendita_gv: Number(row.vendita_gv || 0),
        vendita_tabacchi: Number(row.vendita_tabacchi || 0),
        saldo_giorno: Number(row.saldo_giorno || 0),
        progressivo_da_versare: Number(row.progressivo_da_versare || 0),
        fondo_cassa: Number(row.fondo_cassa || 0),
      }));

      const selectedPvRow = pvs.find((pv) => pv.id === pvId);
      const selectedPvLabel = selectedPvRow
        ? `${selectedPvRow.code} — ${selectedPvRow.name}`
        : "Tutti i PV";

      generateCashSummaryDataReport({
        rows: rowsForReport,
        pvLabel: selectedPvLabel,
        dateFrom,
        dateTo,
      });

      setMsg("Report dati generato correttamente.");
    } catch (error) {
      console.error("REPORT DATI ERROR:", error);
      setMsg("Errore durante la generazione del report dati.");
    }
  }

    function handleGenerateExcelReport() {
    try {
      const rowsForReport = computedRows.map((row) => ({
        data: String(row.data ?? ""),
        pv_label: String(row.pv_label ?? ""),
        operatore: String(row.operatore ?? ""),
        incasso_totale: Number(row.incasso_totale ?? 0),
        gv_pagati: Number(row.gv_pagati ?? 0),
        lis_plus: Number(row.lis_plus ?? 0),
        mooney: Number(row.mooney ?? 0),
        vendita_gv: Number(row.vendita_gv ?? 0),
        vendita_tabacchi: Number(row.vendita_tabacchi ?? 0),
        saldo_giorno: Number(row.saldo_giorno ?? 0),
        progressivo_da_versare: Number(row.progressivo_da_versare ?? 0),
        fondo_cassa: Number(row.fondo_cassa ?? 0),
      }));

      const selectedPvRow = pvs.find((pv) => pv.id === pvId);
      const selectedPvLabel = selectedPvRow
        ? `${selectedPvRow.code} — ${selectedPvRow.name}`
        : "Tutti i PV";

      generateCashSummaryExcelReport({
        rows: rowsForReport,
        pvLabel: selectedPvLabel,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });

      setMsg("Report Excel generato correttamente.");
    } catch (error) {
      console.error("REPORT EXCEL ERROR:", error);
      setMsg("Errore durante la generazione del report Excel.");
    }
  }

  async function handleGenerateReport() {
    if (chartData.rows.length === 0) {
      setMsg("Nessun dato disponibile per generare il report.");
      return;
    }

    try {
      setMsg(null);

      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 12;
      const contentWidth = pageWidth - margin * 2;

      const selectedPvRow = pvs.find((pv) => pv.id === pvId);
      const selectedPv = selectedPvRow
        ? `${selectedPvRow.code} — ${selectedPvRow.name}`
        : "Tutti i PV";

      const periodLabel = `${dateFrom ? formatLongDate(dateFrom) : "inizio"} - ${
        dateTo ? formatLongDate(dateTo) : "oggi"
      }`;

      const sortedRows = [...chartData.rows].sort((a, b) => a.date.localeCompare(b.date));
      const firstValue = sortedRows[0]?.value ?? null;
      const lastValue = sortedRows[sortedRows.length - 1]?.value ?? null;
      const trendPercent = computePercentDifference(firstValue, lastValue);
      const trendLabel =
        trendPercent === null
          ? "Non disponibile"
          : trendPercent > 3
            ? "In crescita"
            : trendPercent < -3
              ? "In calo"
              : "Stabile";
      const aboveAverageDays = sortedRows.filter((row) => row.value > chartData.average).length;
      const belowAverageDays = sortedRows.filter((row) => row.value < chartData.average).length;
      const generatedAt = new Date().toLocaleString("it-IT");

      let y = 14;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(17);
      pdf.setTextColor(15, 23, 42);
      pdf.text("Report Analitico Riepiloghi Incassato", margin, y);

      y += 8;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(71, 85, 105);
      pdf.text(`PV: ${selectedPv}`, margin, y);
      y += 5;
      pdf.text(`Periodo: ${periodLabel}`, margin, y);
      y += 5;
      pdf.text(`Metrica: ${metricLabel(metric)}`, margin, y);
      y += 5;
      pdf.text(`Generato il: ${generatedAt}`, margin, y);

      y += 8;
      const gap = 4;
      const boxWidth = (contentWidth - gap) / 2;
      drawKpiBox(pdf, margin, y, boxWidth, 22, "Totale periodo", formatEuro(chartData.total));
      drawKpiBox(pdf, margin + boxWidth + gap, y, boxWidth, 22, "Media giornaliera", formatEuro(chartData.average));
      y += 26;
      drawKpiBox(
        pdf,
        margin,
        y,
        boxWidth,
        22,
        "Giorno migliore",
        bestRow ? formatEuro(bestRow.value) : "—",
        bestRow ? formatLongDate(bestRow.date) : undefined
      );
      drawKpiBox(
        pdf,
        margin + boxWidth + gap,
        y,
        boxWidth,
        22,
        "Giorno peggiore",
        worstRow ? formatEuro(worstRow.value) : "—",
        worstRow ? formatLongDate(worstRow.date) : undefined
      );
      y += 26;
      const boxWidthThree = (contentWidth - gap * 2) / 3;
      drawKpiBox(pdf, margin, y, boxWidthThree, 22, "Giorni analizzati", String(sortedRows.length));
      drawKpiBox(pdf, margin + boxWidthThree + gap, y, boxWidthThree, 22, "Trend periodo", trendLabel);
      drawKpiBox(
        pdf,
        margin + (boxWidthThree + gap) * 2,
        y,
        boxWidthThree,
        22,
        "Variazione primo/ultimo",
        trendPercent === null ? "—" : formatPercent(trendPercent)
      );
      y += 30;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(15, 23, 42);
      pdf.text("Lettura veloce", margin, y);
      y += 6;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(51, 65, 85);

      const insights = [
        `Totale periodo ${formatEuro(chartData.total)} con media giornaliera di ${formatEuro(chartData.average)}.`,
        bestRow
          ? `Picco massimo registrato il ${formatLongDate(bestRow.date)} con ${formatEuro(bestRow.value)}.`
          : "Picco massimo non disponibile.",
        worstRow
          ? `Valore minimo registrato il ${formatLongDate(worstRow.date)} con ${formatEuro(worstRow.value)}.`
          : "Valore minimo non disponibile.",
        `Trend del periodo: ${trendLabel}${trendPercent === null ? "" : ` (${formatPercent(trendPercent)})`}.`,
        `Giorni sopra media: ${aboveAverageDays}. Giorni sotto media: ${belowAverageDays}.`,
      ];

      insights.forEach((text) => {
        const lines = pdf.splitTextToSize(`• ${text}`, contentWidth);
        pdf.text(lines, margin, y);
        y += lines.length * 4.5;
      });

      y += 4;
      drawSimpleLineChart(
        pdf,
        sortedRows,
        margin,
        y,
        contentWidth,
        58,
        METRIC_COLORS[metric],
        metricLabel(metric)
      );
      y += 66;

      autoTable(pdf, {
        startY: y,
        theme: "grid",
        head: [["Data", "Valore", "Scost. giorno prec.", "Indicatore"]],
        body: sortedRows.map((row, index) => {
          const prevValue = index > 0 ? sortedRows[index - 1].value : null;
          const delta = prevValue === null ? null : row.value - prevValue;
          const indicator =
            row.value > chartData.average ? "Sopra media" : row.value < chartData.average ? "Sotto media" : "In media";

          return [
            formatLongDate(row.date),
            formatEuro(row.value),
            delta === null ? "—" : formatEuro(delta),
            indicator,
          ];
        }),
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: 255,
          fontStyle: "bold",
        },
        bodyStyles: {
          textColor: [51, 65, 85],
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          1: { halign: "right" },
          2: { halign: "right" },
        },
        margin: { left: margin, right: margin },
        didDrawPage: () => {
          const totalPages = pdf.getNumberOfPages();
          const currentPage = pdf.getCurrentPageInfo().pageNumber;
          pdf.setFontSize(9);
          pdf.setTextColor(100, 116, 139);
          pdf.text(
            `Pagina ${currentPage} di ${totalPages}`,
            pageWidth - margin,
            pdf.internal.pageSize.getHeight() - 6,
            { align: "right" }
          );
        },
      });

      const fileMetric = metricLabel(metric).toLowerCase().replace(/\s+/g, "-");
      
const pvCode = selectedPvRow?.code || "Tutti";

const metricLabelMap: Record<string, string> = {
  incasso_totale: "IncassoTotale",
  vendita_tabacchi: "Tabacchi",
  vendita_gv: "GrattaEVinci",
  lis_plus: "LIS",
  mooney: "Mooney",
  gv_pagati: "PagatiGV",
};

const metricName = metricLabelMap[metric] || metric;

const safePv = pvCode.replace(/\s+/g, "").replace(/[^\w\-]/g, "");

const fileName = `Report-Analitico-${safePv}-${metricName}.pdf`;

pdf.save(fileName);
      setMsg("Report generato correttamente.");
    } catch (error) {
      console.error("REPORT PDF ERROR:", error);
      const message = error instanceof Error ? error.message : "Errore sconosciuto";
      setMsg(`Errore report PDF: ${message}`);
    }
  }

  async function onFilter(e: React.FormEvent) {
    e.preventDefault();
    await loadRows();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Saldo iniziale PV</h2>
            <p className="mt-1 text-sm text-gray-600">
              Serve solo come punto di partenza del progressivo. Dopo il riporto continua in automatico.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowBalanceBlock((prev) => !prev)}
            aria-expanded={showBalanceBlock}
            aria-label={showBalanceBlock ? "Chiudi saldo iniziale PV" : "Apri saldo iniziale PV"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border text-xl font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {showBalanceBlock ? "−" : "+"}
          </button>
        </div>

        {showBalanceBlock && (
          <>
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
          </>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Fondo Cassa Iniziale PV</h2>
            <p className="mt-1 text-sm text-gray-600">
              È un dato amministrativo fisso del PV, separato dal saldo iniziale e usato nei controlli del fondo cassa.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowFondoBlock((prev) => !prev)}
            aria-expanded={showFondoBlock}
            aria-label={showFondoBlock ? "Chiudi fondo cassa iniziale PV" : "Apri fondo cassa iniziale PV"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border text-xl font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {showFondoBlock ? "−" : "+"}
          </button>
        </div>

        {showFondoBlock && (
          <>
            <form onSubmit={saveFondoCassaIniziale} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium">Punto Vendita</label>
                <select
                  className="w-full rounded-xl border bg-white p-3"
                  value={fondoPvId}
                  onChange={(e) => setFondoPvId(e.target.value)}
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
                <label className="mb-2 block text-sm font-medium">Fondo Cassa Iniziale</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-xl border bg-white p-3"
                  value={fondoValue ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setFondoValue(raw === "" ? null : Number(raw));
                  }}
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full rounded-xl bg-slate-900 p-3 text-white disabled:opacity-60"
                  disabled={fondoLoading}
                >
                  {fondoLoading ? "Salvo..." : "Salva fondo cassa iniziale"}
                </button>
              </div>
            </form>

            {fondoMsg && <div className="mt-3 text-sm text-gray-700">{fondoMsg}</div>}
          </>
        )}
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
            onClick={handleGenerateDataReport}
            title="Dati completi per tutte le metriche"
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            >
            REPORT COMPLETO
            </button>

            <button
            type="button"
            onClick={handleGenerateExcelReport}
           title="Esporta in Excel tutti i dati del report completo"
           className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            >
           EXPORT EXCEL
            </button>

            <button
              type="button"
              onClick={handleGenerateReport}
              title="Analisi grafica della metrica selezionata"
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            >
              REPORT ANALITICO
            </button>

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

        <div ref={reportChartRef} className="mt-6 rounded-2xl border bg-slate-50 p-4">
          {chartData.rows.length > 0 ? (
            <div className="h-80">
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
            </div>
          ) : (
            <div className="flex h-80 items-center justify-center text-sm text-gray-500">
              Nessun dato disponibile per il grafico.
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-stretch justify-between gap-3">
          <div className="rounded-xl border bg-slate-50 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Differenza % Fondo Cassa</div>

            <div
              className={`mt-1 text-lg font-semibold ${
                fondoCassaPercent === null
                  ? "text-slate-900"
                  : fondoCassaPercent < 0
                    ? "text-red-600"
                    : fondoCassaPercent > 0
                      ? "text-green-600"
                      : "text-slate-900"
              }`}
            >
              {chartFondoLoading ? "Caricamento..." : formatPercent(fondoCassaPercent)}
            </div>

            <div className="mt-1 text-xs text-gray-500">
              {pvId
                ? latestFilteredPvRow
                  ? "Calcolata su ultimo riepilogo del PV selezionato."
                  : "Nessun riepilogo disponibile per il PV selezionato."
                : "Seleziona un PV nei filtri per visualizzarla."}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <div className="rounded-xl border bg-slate-50 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500">Totale {metricLabel(metric)}</div>
              <div className="text-lg font-semibold text-slate-900">{formatEuro(chartData.total)}</div>
            </div>

            <div className="rounded-xl border bg-slate-50 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500">Media giornaliera</div>
              <div className="text-lg font-semibold text-slate-900">{formatEuro(chartData.average)}</div>
            </div>

            <div className="rounded-xl border bg-slate-50 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500">Giorno migliore</div>
              <div className="text-sm font-semibold text-slate-900">{bestRow ? formatLongDate(bestRow.date) : "—"}</div>
              <div className="text-sm text-slate-700">{bestRow ? formatEuro(bestRow.value) : "—"}</div>
            </div>

            <div className="rounded-xl border bg-slate-50 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500">Giorno peggiore</div>
              <div className="text-sm font-semibold text-slate-900">{worstRow ? formatLongDate(worstRow.date) : "—"}</div>
              <div className="text-sm text-slate-700">{worstRow ? formatEuro(worstRow.value) : "—"}</div>
            </div>
          </div>
        </div>

        {showDetail && (
          <div className="mt-6 rounded-2xl border bg-white p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Dettaglio movimenti — {metricLabel(metric)}</h3>
                <p className="mt-1 text-sm text-gray-600">Segna le righe come OK oppure Da ricontrollare.</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailFilter("all")}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    detailFilter === "all"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
                  }`}
                >
                  Tutti
                </button>

                <button
                  type="button"
                  onClick={() => setDetailFilter("check")}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    detailFilter === "check"
                      ? "border-orange-600 bg-orange-600 text-white"
                      : "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                  }`}
                >
                  Solo da ricontrollare
                </button>
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
                  {filteredDetailRows.map((row) => {
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
                              onClick={() => saveDetailCheck(row.id, metric, status === "ok" ? null : "ok")}
                              disabled={isSaving}
                              className="rounded-lg border border-green-600 px-3 py-1 text-green-700 hover:bg-green-50 disabled:opacity-50"
                            >
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                saveDetailCheck(row.id, metric, status === "check" ? null : "check")
                              }
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

                  {filteredDetailRows.length === 0 && (
                    <tr className="border-t">
                      <td className="p-3 text-gray-500" colSpan={6}>
                        {detailFilter === "check"
                          ? "Nessun movimento da ricontrollare."
                          : "Nessun movimento disponibile."}
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
          Seleziona due o più PV per confrontare l'andamento periodo sulla metrica selezionata.
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

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_280px]">
          <div className="h-80 rounded-2xl border bg-slate-50 p-4">
            {comparisonChartData.rows.length > 0 && comparisonChartData.series.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={comparisonChartData.rows}
                  margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
                  onMouseLeave={() => setActiveComparePvId(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={formatAxisEuro} width={70} />
                  <Tooltip content={<ComparisonTooltip seriesMap={comparisonSeriesMap} />} />
                  <Legend />
                  {comparisonChartData.series.map((series) => {
                    const isActive = activeComparePvId === series.pv_id;
                    const hasActive = activeComparePvId !== null;

                    return (
                      <Line
                        key={series.pv_id}
                        type="monotone"
                        dataKey={series.pv_id}
                        name={series.pv_code}
                        stroke={series.color}
                        strokeWidth={isActive ? 4 : 3}
                        opacity={hasActive && !isActive ? 0.2 : 1}
                        dot={{ r: isActive ? 4 : 3 }}
                        activeDot={{ r: isActive ? 6 : 5 }}
                        connectNulls
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">
                Nessun dato disponibile per il confronto.
              </div>
            )}
          </div>

          <div className="space-y-2">
            {compareByPv.map((row) => {
              const max = Math.max(...compareByPv.map((x) => Math.abs(x.total)), 1);
              const width = (Math.abs(row.total) / max) * 100;
              const color = compareColorByPvId[row.pv_id] ?? fallbackColorFromString(row.pv_id);
              const isActive = activeComparePvId === row.pv_id;
              const hasActive = activeComparePvId !== null;

              return (
                <button
                  key={row.pv_id}
                  type="button"
                  onMouseEnter={() => setActiveComparePvId(row.pv_id)}
                  onMouseLeave={() => setActiveComparePvId(null)}
                  onFocus={() => setActiveComparePvId(row.pv_id)}
                  onBlur={() => setActiveComparePvId(null)}
                  className={`block w-full rounded-xl border px-3 py-2 text-left transition ${
                    isActive
                      ? "border-slate-400 bg-slate-50 shadow-sm"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  } ${hasActive && !isActive ? "opacity-60" : "opacity-100"}`}
                >
                  <div className="flex items-center justify-between gap-2 text-[13px] leading-tight">
                    <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="truncate">{row.pv_label}</span>
                    </span>
                    <span className="shrink-0 font-semibold text-slate-900">
                      {formatEuro(row.total)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${width}%`,
                        backgroundColor: row.total < 0 ? "#dc2626" : color,
                      }}
                    />
                  </div>
                </button>
              );
            })}

            {compareByPv.length === 0 && (
              <div className="text-sm text-gray-500">Nessun dato disponibile per il confronto.</div>
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