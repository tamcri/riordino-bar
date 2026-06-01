"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDaysISO,
  currentWeekMondayISO,
  formatDateIT,
  formatHours,
  formatShiftTimeRange,
  getMondayISO,
  getWeekDates,
  normalizeShiftStatus,
  normalizeTime,
  shiftHoursTotal,
  shiftStatusLabel,
  type ShiftStatus,
  WEEK_DAYS,
  getErrorMessage,
} from "@/lib/work-shifts";

type ApiResponseBase = {
  ok?: boolean;
  error?: string;
};

type ViewMode = "weekly" | "monthly";

type PV = {
  id: string;
  code: string;
  name: string;
};

type Employee = {
  id: string;
  pv_id: string;
  name: string;
  active: boolean;
  pv_code: string | null;
  pv_name: string | null;
};

type PvsResponse = ApiResponseBase & {
  rows?: PV[];
  pvs?: PV[];
};

type EmployeesResponse = ApiResponseBase & {
  rows?: Employee[];
};

type ShiftRow = {
  id: string;
  pv_id: string;
  employee_id: string;
  employee_name: string;
  employee_active: boolean;
  pv_code: string | null;
  pv_name: string | null;
  shift_date: string;
  status: ShiftStatus;
  start_time: string | null;
  end_time: string | null;
  second_start_time: string | null;
  second_end_time: string | null;
  note: string | null;
};

type MonthlyRow = {
  shift_date: string;
  weekday: string;
  has_shift: boolean;
  employee_id?: string | null;
  employee_name?: string | null;
  pv_id?: string | null;
  pv_code?: string | null;
  pv_name?: string | null;
  status: ShiftStatus | null;
  status_label: string;
  start_time: string | null;
  end_time: string | null;
  second_start_time: string | null;
  second_end_time: string | null;
  shift_label: string;
  note: string | null;
  hours: number;
};

type MonthlyEmployee = {
  id: string;
  pv_id: string;
  name: string;
  active: boolean;
  pv_code: string | null;
  pv_name: string | null;
};

type MonthlyResponse = ApiResponseBase & {
  month?: string;
  month_start?: string;
  month_end?: string;
  employee?: MonthlyEmployee;
  rows?: MonthlyRow[];
  grouped_by_name?: boolean;
  matched_employees_count?: number;
  totals?: {
    total_hours?: number;
    total_hours_label?: string;
    total_work_days?: number;
    total_split_days?: number;
    total_rest_days?: number;
    total_vacation_days?: number;
    total_sick_days?: number;
    total_change_days?: number;
  };
};

type GroupedRow = {
  key: string;
  pv_id: string;
  pv_code: string;
  pv_name: string;
  employee_id: string;
  employee_name: string;
  employee_active: boolean;
  shiftsByDate: Record<string, ShiftRow>;
  totalHours: number;
};

type WeekResponse = ApiResponseBase & {
  rows?: ShiftRow[];
};

type ShiftManagerSetting = {
  id: string;
  pv_id: string;
  configured: boolean;
  enabled: boolean;
  updated_at: string | null;
  pv_code: string | null;
  pv_name: string | null;
};

type ShiftManagerSettingsResponse = ApiResponseBase & {
  rows?: ShiftManagerSetting[];
  row?: ShiftManagerSetting;
};

function statusBadgeClass(status: ShiftStatus) {
  switch (status) {
    case "work":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "split":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "vacation":
      return "border-violet-200 bg-violet-50 text-violet-800";
    case "change":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "rest":
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function monthlyStatusBadgeClass(status: ShiftStatus | null) {
  if (!status) return "border-gray-200 bg-white text-gray-500";
  return statusBadgeClass(status);
}

function currentMonthValue() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function formatMonthIT(value: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;

  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(d);
}

function employeeOptionLabel(employee: Employee) {
  const pvLabel = [employee.pv_code, employee.pv_name].filter(Boolean).join(" — ");
  return pvLabel ? `${employee.name} (${pvLabel})` : employee.name;
}

function timeRangeLabel(startTime: string | null, endTime: string | null) {
  const start = normalizeTime(startTime ?? "");
  const end = normalizeTime(endTime ?? "");

  if (!start || !end) return null;

  return `${start} - ${end}`;
}

function monthlyShiftTimeLabel(row: MonthlyRow) {
  if (!row.has_shift || !row.status) return "—";

  const firstRange = timeRangeLabel(row.start_time, row.end_time);
  const secondRange = timeRangeLabel(row.second_start_time, row.second_end_time);

  if (firstRange && secondRange) return `${firstRange} / ${secondRange}`;
  if (firstRange) return firstRange;

  return row.shift_label || "—";
}

function monthlyRowHours(row: MonthlyRow) {
  if (!row.has_shift || !row.status) return 0;

  return shiftHoursTotal({
    status: row.status,
    start_time: row.start_time,
    end_time: row.end_time,
    second_start_time: row.second_start_time,
    second_end_time: row.second_end_time,
  });
}

async function fetchJsonSafe<T extends ApiResponseBase>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; data: T | null; status: number; rawText: string }> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const status = res.status;
  const rawText = await res.text().catch(() => "");
  let data: T | null = null;

  try {
    data = rawText ? (JSON.parse(rawText) as T) : null;
  } catch {
    data = null;
  }

  return { ok: res.ok && data?.ok === true, data, status, rawText };
}

export default function TurniAdminClient() {
  const [viewMode, setViewMode] = useState<ViewMode>("weekly");
  const [pvs, setPvs] = useState<PV[]>([]);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [weekStart, setWeekStart] = useState(currentWeekMondayISO());
  const [pvId, setPvId] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(currentMonthValue());
  const [monthlyRows, setMonthlyRows] = useState<MonthlyRow[]>([]);
  const [monthlyEmployee, setMonthlyEmployee] = useState<MonthlyEmployee | null>(null);
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyResponse["totals"] | null>(null);
  const [monthlyIncludeSameName, setMonthlyIncludeSameName] = useState(false);
  const [monthlyMatchedEmployeesCount, setMonthlyMatchedEmployeesCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsRows, setSettingsRows] = useState<ShiftManagerSetting[]>([]);
  const [settingsPvId, setSettingsPvId] = useState("");
  const [settingsCode, setSettingsCode] = useState("");
  const [settingsEnabled, setSettingsEnabled] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekLabel = `${formatDateIT(weekDates[0])} - ${formatDateIT(weekDates[6])}`;

  const groupedRows = useMemo<GroupedRow[]>(() => {
    const map = new Map<string, GroupedRow>();

    for (const row of rows) {
      const key = `${row.pv_id}:${row.employee_id}`;
      const current = map.get(key) ?? {
        key,
        pv_id: row.pv_id,
        pv_code: row.pv_code ?? "",
        pv_name: row.pv_name ?? "",
        employee_id: row.employee_id,
        employee_name: row.employee_name || "Dipendente",
        employee_active: row.employee_active !== false,
        shiftsByDate: {},
        totalHours: 0,
      };

      current.shiftsByDate[row.shift_date] = row;
      current.totalHours += shiftHoursTotal(row);

      map.set(key, current);
    }

    return Array.from(map.values()).sort((a, b) => {
      const pvCompare = `${a.pv_code} ${a.pv_name}`.localeCompare(`${b.pv_code} ${b.pv_name}`, "it");
      if (pvCompare !== 0) return pvCompare;
      return a.employee_name.localeCompare(b.employee_name, "it");
    });
  }, [rows]);

  const totalEmployees = groupedRows.length;
  const totalHours = useMemo(
    () => groupedRows.reduce((sum, row) => sum + row.totalHours, 0),
    [groupedRows]
  );
  const totalRestDays = useMemo(
    () => rows.filter((row) => row.status === "rest").length,
    [rows]
  );
  const totalVacationDays = useMemo(
    () => rows.filter((row) => row.status === "vacation").length,
    [rows]
  );
  const totalSplits = useMemo(
    () => rows.filter((row) => row.status === "split").length,
    [rows]
  );
  const totalChanges = useMemo(
    () => rows.filter((row) => row.status === "change").length,
    [rows]
  );

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === employeeId) ?? null,
    [employeeId, employees]
  );

  const selectedShiftSetting = useMemo(
    () => settingsRows.find((row) => row.pv_id === settingsPvId) ?? null,
    [settingsPvId, settingsRows]
  );

  const monthlyRowsTotalHours = useMemo(
    () => monthlyRows.reduce((sum, row) => sum + monthlyRowHours(row), 0),
    [monthlyRows]
  );

  const monthlyTotalHours =
    monthlyRows.length > 0 ? monthlyRowsTotalHours : Number(monthlyTotals?.total_hours ?? 0);
  const monthlyWorkDays = Number(monthlyTotals?.total_work_days ?? 0);
  const monthlySplitDays = Number(monthlyTotals?.total_split_days ?? 0);
  const monthlyRestDays = Number(monthlyTotals?.total_rest_days ?? 0);
  const monthlyVacationDays = Number(monthlyTotals?.total_vacation_days ?? 0);
  const monthlySickDays = Number(monthlyTotals?.total_sick_days ?? 0);
  const monthlyChangeDays = Number(monthlyTotals?.total_change_days ?? 0);

  async function loadPvs() {
    const res = await fetchJsonSafe<PvsResponse>("/api/pvs/list");
    if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

    const list = (res.data?.pvs ?? res.data?.rows ?? []) as PV[];
    setPvs(Array.isArray(list) ? list : []);
  }

  async function loadShiftManagerSettings() {
    const res = await fetchJsonSafe<ShiftManagerSettingsResponse>("/api/work-shifts/manager-settings");
    if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

    const rows = Array.isArray(res.data?.rows) ? (res.data.rows as ShiftManagerSetting[]) : [];
    setSettingsRows(rows);
  }

  async function saveShiftManagerSettings(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);

    if (!settingsPvId) {
      setError("Seleziona un punto vendita.");
      return;
    }

    const code = settingsCode.trim();
    if (code && !/^[A-Za-z0-9]{6,32}$/.test(code)) {
      setError("Il codice responsabile deve essere alfanumerico, senza spazi, da 6 a 32 caratteri.");
      return;
    }

    if (!code && !selectedShiftSetting) {
      setError("Per la prima configurazione devi inserire un codice responsabile.");
      return;
    }

    setSettingsLoading(true);
    try {
      const body: Record<string, unknown> = {
        pv_id: settingsPvId,
        enabled: settingsEnabled,
      };
      if (code) body.code = code;

      const res = await fetchJsonSafe<ShiftManagerSettingsResponse>("/api/work-shifts/manager-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      setSettingsCode("");
      setMsg("Impostazioni responsabile turni salvate.");
      await loadShiftManagerSettings();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore salvataggio impostazioni responsabile"));
    } finally {
      setSettingsLoading(false);
    }
  }

  async function loadRows() {
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      const params = new URLSearchParams();
      params.set("week_start", weekStart);
      if (pvId) params.set("pv_id", pvId);

      const res = await fetchJsonSafe<WeekResponse>(`/api/work-shifts/week?${params.toString()}`);
      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      const nextRows = Array.isArray(res.data?.rows) ? (res.data.rows as ShiftRow[]) : [];
      setRows(
        nextRows.map((row) => ({
          ...row,
          status: normalizeShiftStatus(row.status) ?? "rest",
          start_time: normalizeTime(row.start_time ?? ""),
          end_time: normalizeTime(row.end_time ?? ""),
          second_start_time: normalizeTime(row.second_start_time ?? ""),
          second_end_time: normalizeTime(row.second_end_time ?? ""),
          note: row.note ?? "",
        }))
      );
      setMsg(nextRows.length === 0 ? "Nessun turno trovato con i filtri selezionati." : null);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore caricamento turni"));
      setRows([]);
    } finally {
      setLoading(false);
      setBootLoading(false);
    }
  }

  async function loadEmployees(nextPvId = pvId) {
    setEmployeesLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("include_inactive", "1");
      if (nextPvId) params.set("pv_id", nextPvId);

      const res = await fetchJsonSafe<EmployeesResponse>(`/api/work-shifts/employees?${params.toString()}`);
      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      const list = Array.isArray(res.data?.rows) ? (res.data.rows as Employee[]) : [];
      setEmployees(list);

      if (employeeId && !list.some((employee) => employee.id === employeeId)) {
        setEmployeeId("");
        setMonthlyRows([]);
        setMonthlyEmployee(null);
        setMonthlyTotals(null);
        setMonthlyMatchedEmployeesCount(0);
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore caricamento dipendenti"));
      setEmployees([]);
    } finally {
      setEmployeesLoading(false);
    }
  }

  async function loadMonthlyRows() {
    setMonthlyLoading(true);
    setError(null);
    setMsg(null);

    try {
      if (!employeeId) {
        setMonthlyRows([]);
        setMonthlyEmployee(null);
        setMonthlyTotals(null);
        setMonthlyMatchedEmployeesCount(0);
        setMsg("Seleziona un dipendente per visualizzare la scheda mensile.");
        return;
      }

      const params = new URLSearchParams();
      params.set("month", month);
      params.set("employee_id", employeeId);
      if (pvId) params.set("pv_id", pvId);
      if (monthlyIncludeSameName) params.set("include_same_name", "1");

      const res = await fetchJsonSafe<MonthlyResponse>(`/api/work-shifts/monthly-employee?${params.toString()}`);
      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      const nextRows = Array.isArray(res.data?.rows) ? res.data.rows : [];
      setMonthlyRows(nextRows);
      setMonthlyEmployee(res.data?.employee ?? selectedEmployee ?? null);
      setMonthlyTotals(res.data?.totals ?? null);
      setMonthlyMatchedEmployeesCount(Number(res.data?.matched_employees_count ?? 0));
      setMsg(nextRows.length === 0 ? "Nessun dato mensile trovato." : null);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore caricamento scheda mensile"));
      setMonthlyRows([]);
      setMonthlyEmployee(null);
      setMonthlyTotals(null);
      setMonthlyMatchedEmployeesCount(0);
    } finally {
      setMonthlyLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadPvs();
        await loadShiftManagerSettings();
        await loadRows();
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Errore"));
        setBootLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewMode !== "monthly") return;
    void loadEmployees(pvId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, pvId]);

  function resetWeeklyFilters() {
    setPvId("");
    setWeekStart(currentWeekMondayISO());
  }

  function resetMonthlyFilters() {
    setPvId("");
    setEmployeeId("");
    setMonth(currentMonthValue());
    setMonthlyRows([]);
    setMonthlyEmployee(null);
    setMonthlyTotals(null);
    setMonthlyIncludeSameName(false);
    setMonthlyMatchedEmployeesCount(0);
  }

  function openPdfReport(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function downloadWeeklyPdf() {
    setError(null);
    setMsg(null);

    const params = new URLSearchParams();
    params.set("week_start", weekStart);
    if (pvId) params.set("pv_id", pvId);

    openPdfReport(`/api/work-shifts/pdf-weekly?${params.toString()}`);
  }

  function downloadMonthlyPdf() {
    setError(null);
    setMsg(null);

    if (!employeeId) {
      setError("Seleziona un dipendente prima di scaricare il PDF.");
      return;
    }

    const params = new URLSearchParams();
    params.set("month", month);
    params.set("employee_id", employeeId);
    if (pvId) params.set("pv_id", pvId);
    if (monthlyIncludeSameName) params.set("include_same_name", "1");

    openPdfReport(`/api/work-shifts/pdf-monthly-employee?${params.toString()}`);
  }


  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Visualizza turni</h1>
            <p className="text-gray-600 mt-1">
              Consulta i turni dei punti vendita con vista settimanale o scheda mensile per dipendente.
            </p>
          </div>

          <Link href="/admin" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
            Torna ad Admin
          </Link>
        </div>

        <section className="rounded-2xl border bg-white p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-xl px-4 py-2 ${
                viewMode === "weekly" ? "bg-slate-900 text-white" : "border bg-white hover:bg-gray-50"
              }`}
              onClick={() => {
                setViewMode("weekly");
                setMsg(null);
                setError(null);
              }}
            >
              Vista settimanale
            </button>

            <button
              type="button"
              className={`rounded-xl px-4 py-2 ${
                viewMode === "monthly" ? "bg-slate-900 text-white" : "border bg-white hover:bg-gray-50"
              }`}
              onClick={() => {
                setViewMode("monthly");
                setMsg(null);
                setError(null);
              }}
            >
              Scheda mensile dipendente
            </button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Gestione codice responsabile turni</h2>
              <p className="mt-1 text-sm text-gray-600">
                Imposta il codice responsabile per ogni PV e blocca o riattiva temporaneamente l'accesso alla sezione Turni lato PV.
              </p>
              {selectedShiftSetting && (
                <p className="mt-2 text-xs text-gray-500">
                  Stato attuale: {selectedShiftSetting.configured ? "codice configurato" : "codice non configurato"} · {selectedShiftSetting.enabled ? "accesso attivo" : "accesso bloccato"}
                </p>
              )}
            </div>

            <form onSubmit={saveShiftManagerSettings} className="grid w-full grid-cols-1 gap-3 lg:max-w-3xl md:grid-cols-4">
              <div className="md:col-span-1">
                <label className="mb-2 block text-sm font-medium">Punto Vendita</label>
                <select
                  className="w-full rounded-xl border bg-white p-3"
                  value={settingsPvId}
                  onChange={(e) => {
                    const nextPvId = e.target.value;
                    const current = settingsRows.find((row) => row.pv_id === nextPvId) ?? null;
                    setSettingsPvId(nextPvId);
                    setSettingsEnabled(current?.enabled !== false);
                    setSettingsCode("");
                  }}
                >
                  <option value="">Seleziona PV</option>
                  {pvs.map((pv) => (
                    <option key={pv.id} value={pv.id}>
                      {pv.code} — {pv.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1">
                <label className="mb-2 block text-sm font-medium">Nuovo codice</label>
                <input
                  type="password"
                  className="w-full rounded-xl border p-3"
                  value={settingsCode}
                  minLength={6}
                  maxLength={32}
                  placeholder={selectedShiftSetting?.configured ? "Lascia vuoto per non cambiarlo" : "Min. 6 caratteri"}
                  autoComplete="off"
                  onChange={(e) => setSettingsCode(e.target.value)}
                />
              </div>

              <div className="md:col-span-1">
                <label className="mb-2 block text-sm font-medium">Stato accesso</label>
                <select
                  className="w-full rounded-xl border bg-white p-3"
                  value={settingsEnabled ? "enabled" : "disabled"}
                  onChange={(e) => setSettingsEnabled(e.target.value === "enabled")}
                >
                  <option value="enabled">Attivo</option>
                  <option value="disabled">Bloccato</option>
                </select>
              </div>

              <div className="md:col-span-1">
                <label className="mb-2 block text-sm font-medium invisible">Azione</label>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-slate-900 px-4 py-3 text-white disabled:opacity-60"
                  disabled={settingsLoading || !settingsPvId}
                >
                  {settingsLoading ? "Salvo..." : "Salva"}
                </button>
              </div>
            </form>
          </div>
        </section>

        {viewMode === "weekly" ? (
          <>
            <section className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Dipendenti visualizzati</div>
                <div className="text-2xl font-semibold mt-1">{totalEmployees}</div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Ore totali</div>
                <div className="text-2xl font-semibold mt-1">{formatHours(totalHours)} h</div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Spezzati</div>
                <div className="text-2xl font-semibold mt-1">{totalSplits}</div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Riposi</div>
                <div className="text-2xl font-semibold mt-1">{totalRestDays}</div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Ferie</div>
                <div className="text-2xl font-semibold mt-1">{totalVacationDays}</div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Cambi turno</div>
                <div className="text-2xl font-semibold mt-1">{totalChanges}</div>
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-2">Settimana</label>
                  <input
                    type="date"
                    className="w-full rounded-xl border p-3 bg-white"
                    value={weekStart}
                    onChange={(e) => setWeekStart(getMondayISO(e.target.value))}
                  />
                  <p className="text-xs text-gray-500 mt-1">Periodo: {weekLabel}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Punto Vendita</label>
                  <select
                    className="w-full rounded-xl border p-3 bg-white"
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
                  <label className="block text-sm font-medium mb-2 invisible">Navigazione</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-xl border bg-white px-4 py-3 hover:bg-gray-50"
                      onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
                    >
                      ← Prec.
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border bg-white px-4 py-3 hover:bg-gray-50"
                      onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
                    >
                      Succ. →
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
                  disabled={loading}
                  onClick={loadRows}
                >
                  {loading ? "Caricamento..." : "Aggiorna"}
                </button>

                <button
                  type="button"
                  className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
                  disabled={loading}
                  onClick={downloadWeeklyPdf}
                >
                  Scarica PDF
                </button>

                <button
                  type="button"
                  className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
                  onClick={() => {
                    resetWeeklyFilters();
                    setTimeout(() => loadRows(), 0);
                  }}
                >
                  Reset filtri
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Dipendente</div>
                <div className="text-lg font-semibold mt-1 truncate">
                  {monthlyEmployee?.name || selectedEmployee?.name || "—"}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Ore mese</div>
                <div className="text-2xl font-semibold mt-1">{formatHours(monthlyTotalHours)} h</div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Giorni lavorati</div>
                <div className="text-2xl font-semibold mt-1">{monthlyWorkDays}</div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Riposi / Cambi</div>
                <div className="text-2xl font-semibold mt-1">
                  {monthlyRestDays} / {monthlyChangeDays}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-2">Mese</label>
                  <input
                    type="month"
                    className="w-full rounded-xl border p-3 bg-white"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">Periodo: {formatMonthIT(month)}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Punto Vendita</label>
                  <select
                    className="w-full rounded-xl border p-3 bg-white"
                    value={pvId}
                    onChange={(e) => {
                      setPvId(e.target.value);
                      setEmployeeId("");
                      setMonthlyRows([]);
                      setMonthlyEmployee(null);
                      setMonthlyTotals(null);
                      setMonthlyMatchedEmployeesCount(0);
                      setMonthlyMatchedEmployeesCount(0);
                    }}
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
                  <label className="block text-sm font-medium mb-2">Dipendente</label>
                  <select
                    className="w-full rounded-xl border p-3 bg-white"
                    value={employeeId}
                    disabled={employeesLoading}
                    onChange={(e) => {
                      setEmployeeId(e.target.value);
                      setMonthlyRows([]);
                      setMonthlyEmployee(null);
                      setMonthlyTotals(null);
                      setMonthlyMatchedEmployeesCount(0);
                      setMonthlyMatchedEmployeesCount(0);
                    }}
                  >
                    <option value="">Seleziona dipendente</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employeeOptionLabel(employee)}{employee.active ? "" : " — non attivo"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 invisible">Azione</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-xl bg-slate-900 text-white px-4 py-3 disabled:opacity-60"
                      disabled={monthlyLoading || !employeeId}
                      onClick={loadMonthlyRows}
                    >
                      {monthlyLoading ? "Caricamento..." : "Visualizza"}
                    </button>
                  </div>
                </div>
              </div>

              <label className="mt-4 flex items-start gap-3 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={monthlyIncludeSameName}
                  disabled={!employeeId && monthlyRows.length === 0}
                  onChange={(e) => {
                    setMonthlyIncludeSameName(e.target.checked);
                    setMonthlyRows([]);
                    setMonthlyEmployee(null);
                    setMonthlyTotals(null);
                    setMonthlyMatchedEmployeesCount(0);
                  }}
                />
                <span>
                  <span className="font-medium">Includi stesso dipendente su altri PV</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    Usa il nome normalizzato del dipendente selezionato e somma i turni trovati negli altri punti vendita. Nel report comparirà anche la colonna PV.
                  </span>
                </span>
              </label>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
                  onClick={() => void loadEmployees(pvId)}
                >
                  Aggiorna dipendenti
                </button>

                <button
                  type="button"
                  className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
                  disabled={monthlyLoading || !employeeId}
                  onClick={downloadMonthlyPdf}
                >
                  Scarica PDF
                </button>

                <button
                  type="button"
                  className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
                  onClick={resetMonthlyFilters}
                >
                  Reset filtri
                </button>
              </div>
            </section>
          </>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {msg && (
          <div className="rounded-xl border bg-white p-3 text-sm text-gray-700">
            {msg}
          </div>
        )}



        {viewMode === "weekly" ? (
          <section className="rounded-2xl border bg-white overflow-hidden">
            <div className="border-b p-4">
              <h2 className="text-lg font-semibold">Riepilogo settimanale</h2>
              <p className="text-sm text-gray-600 mt-1">
                Riposi e cambi turno sono evidenziati; le note sono visibili nella cella del giorno.
              </p>
            </div>

            {bootLoading ? (
              <div className="p-6 text-sm text-gray-600">Caricamento turni...</div>
            ) : groupedRows.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">Nessun turno da visualizzare.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="border-b px-3 py-3 font-semibold min-w-44">PV</th>
                      <th className="border-b px-3 py-3 font-semibold min-w-44">Dipendente</th>
                      {weekDates.map((date, index) => (
                        <th key={date} className="border-b px-3 py-3 font-semibold min-w-40">
                          <div>{WEEK_DAYS[index]?.shortLabel}</div>
                          <div className="text-xs font-normal text-gray-500">{formatDateIT(date)}</div>
                        </th>
                      ))}
                      <th className="border-b px-3 py-3 font-semibold min-w-28 text-right">Totale</th>
                    </tr>
                  </thead>

                  <tbody>
                    {groupedRows.map((group) => (
                      <tr key={group.key} className="align-top hover:bg-gray-50">
                        <td className="border-b px-3 py-3">
                          <div className="font-medium">{group.pv_code || "—"}</div>
                          <div className="text-xs text-gray-500">{group.pv_name || ""}</div>
                        </td>
                        <td className="border-b px-3 py-3">
                          <div className="font-medium">{group.employee_name}</div>
                          {!group.employee_active && (
                            <div className="mt-1 text-xs text-gray-500">Non attivo</div>
                          )}
                        </td>

                        {weekDates.map((date) => {
                          const shift = group.shiftsByDate[date];

                          if (!shift) {
                            return (
                              <td key={date} className="border-b px-3 py-3 text-gray-400">
                                —
                              </td>
                            );
                          }

                          const status = normalizeShiftStatus(shift.status) ?? "rest";
                          const shiftTimeLabel = formatShiftTimeRange(shift);

                          return (
                            <td key={date} className="border-b px-3 py-3">
                              <div className={`rounded-xl border px-3 py-2 ${statusBadgeClass(status)}`}>
                                <div className="text-xs font-semibold">{shiftStatusLabel(status)}</div>
                                {shiftTimeLabel !== "—" && (
                                  <div className="mt-1 whitespace-pre-line text-sm">
                                    {shiftTimeLabel.replace(" / ", "\n")}
                                  </div>
                                )}
                                {shift.note && (
                                  <div className="mt-1 text-xs leading-snug text-gray-700">
                                    {shift.note}
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })}

                        <td className="border-b px-3 py-3 text-right font-semibold">
                          {formatHours(group.totalHours)} h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-2xl border bg-white overflow-hidden">
            <div className="border-b p-4">
              <h2 className="text-lg font-semibold">Scheda mensile dipendente</h2>
              <p className="text-sm text-gray-600 mt-1">
                Seleziona mese, PV e dipendente per vedere data, turno, ore e totale mensile.
              </p>
              {(monthlyEmployee || selectedEmployee) && (
                <div className="mt-3 rounded-xl border bg-gray-50 p-3 text-sm">
                  <div className="font-semibold">
                    {(monthlyEmployee ?? selectedEmployee)?.name} — {formatMonthIT(month)}
                  </div>
                  <div className="text-gray-600 mt-1">
                    {monthlyIncludeSameName && monthlyRows.length > 0
                      ? `Report aggregato su ${monthlyMatchedEmployeesCount || 1} record dipendente`
                      : [(monthlyEmployee ?? selectedEmployee)?.pv_code, (monthlyEmployee ?? selectedEmployee)?.pv_name]
                          .filter(Boolean)
                          .join(" — ") || "PV non indicato"}
                  </div>
                </div>
              )}
            </div>

            {!employeeId ? (
              <div className="p-6 text-sm text-gray-600">Seleziona un dipendente per visualizzare la scheda mensile.</div>
            ) : monthlyLoading ? (
              <div className="p-6 text-sm text-gray-600">Caricamento scheda mensile...</div>
            ) : monthlyRows.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">Nessuna scheda mensile caricata.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="border-b px-3 py-3 font-semibold min-w-32">Data</th>
                      {monthlyIncludeSameName && (
                        <th className="border-b px-3 py-3 font-semibold min-w-36">PV</th>
                      )}
                      <th className="border-b px-3 py-3 font-semibold min-w-24">Giorno</th>
                      <th className="border-b px-3 py-3 font-semibold min-w-40">Stato</th>
                      <th className="border-b px-3 py-3 font-semibold min-w-36">Turno</th>
                      <th className="border-b px-3 py-3 font-semibold min-w-24 text-right">Ore</th>
                      <th className="border-b px-3 py-3 font-semibold min-w-60">Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    {monthlyRows.map((row) => {
                      const status = normalizeShiftStatus(row.status ?? "");
                      const shiftTimeLabel = monthlyShiftTimeLabel(row);
                      const rowHours = monthlyRowHours(row);

                      return (
                        <tr key={`${row.shift_date}:${row.pv_id ?? ""}:${row.employee_id ?? ""}`} className="align-top hover:bg-gray-50">
                          <td className="border-b px-3 py-3 font-medium">{formatDateIT(row.shift_date)}</td>
                          {monthlyIncludeSameName && (
                            <td className="border-b px-3 py-3">
                              <div className="font-medium">{row.pv_code || "—"}</div>
                              <div className="text-xs text-gray-500">{row.pv_name || ""}</div>
                            </td>
                          )}
                          <td className="border-b px-3 py-3 text-gray-600">{row.weekday}</td>
                          <td className="border-b px-3 py-3">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${monthlyStatusBadgeClass(status)}`}>
                              {status ? shiftStatusLabel(status) : "Nessun turno"}
                            </span>
                          </td>
                          <td className="border-b px-3 py-3 whitespace-pre-line">
                            {shiftTimeLabel !== "—" ? shiftTimeLabel.replace(" / ", "\n") : "—"}
                          </td>
                          <td className="border-b px-3 py-3 text-right font-semibold">{formatHours(rowHours)} h</td>
                          <td className="border-b px-3 py-3 text-gray-700">{row.note || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>

                  <tfoot className="bg-gray-50">
                    <tr>
                      <td className="px-3 py-3 font-semibold" colSpan={monthlyIncludeSameName ? 5 : 4}>
                        Totale mese
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">{formatHours(monthlyTotalHours)} h</td>
                      <td className="px-3 py-3 text-sm text-gray-600">
                        Lavorati: {monthlyWorkDays} · Spezzati: {monthlySplitDays} · Riposi: {monthlyRestDays} · Ferie: {monthlyVacationDays} · Malattia: {monthlySickDays} · Cambi: {monthlyChangeDays}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}