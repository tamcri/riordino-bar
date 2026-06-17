"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDaysISO,
  currentWeekMondayISO,
  formatDateIT,
  formatHours,
  getMondayISO,
  getWeekDates,
  isNoTimeStatus,
  minutesBetween,
  timeToMinutes,
  requiresSecondShift,
  shiftHoursTotal,
  SHIFT_STATUSES,
  normalizeShiftStatus,
  normalizeTime,
  shiftStatusLabel,
  type ShiftStatus,
  WEEK_DAYS,
  getErrorMessage,

} from "@/lib/work-shifts";

type Employee = {
  id: string;
  pv_id: string;
  name: string;
  active: boolean;
};

type PV = {
  id: string;
  code: string;
  name: string;
};

type ShiftApiRow = {
  employee_id: string;
  shift_date: string;
  work_pv_id: string | null;
  second_work_pv_id: string | null;
  status: ShiftStatus;
  start_time: string | null;
  end_time: string | null;
  second_start_time: string | null;
  second_end_time: string | null;
  note: string | null;
  public_label?: string | null;
};

type ShiftCell = {
  employee_id: string;
  shift_date: string;
  work_pv_id: string;
  second_work_pv_id: string;
  status: ShiftStatus;
  start_time: string;
  end_time: string;
  second_start_time: string;
  second_end_time: string;
  note: string;
  public_label: string;
};

type CopyDayState = {
  employeeId: string;
  sourceDate: string;
  targetDates: string[];
};

type ApiResponseBase = {
  ok?: boolean;
  error?: string;
};

type MeResponse = ApiResponseBase & {
  role?: string;
  username?: string;
  pv_id?: string | null;
  pv_code?: string | null;
  pv_name?: string | null;
};

type EmployeesResponse = ApiResponseBase & {
  rows?: Employee[];
};

type PvsResponse = ApiResponseBase & {
  rows?: PV[];
  pvs?: PV[];
};

type WeekResponse = ApiResponseBase & {
  rows?: ShiftApiRow[];
  saved?: number;
  pv_summary_only?: boolean;
};

type CopyPreviousResponse = ApiResponseBase & {
  copied?: number;
};

type ManagerStatusResponse = ApiResponseBase & {
  configured?: boolean;
  enabled?: boolean;
  unlocked?: boolean;
};

type ManagerLoginResponse = ApiResponseBase & {
  unlocked?: boolean;
};

function cellKey(employeeId: string, date: string) {
  return `${employeeId}:${date}`;
}

function emptyCell(employeeId: string, date: string, defaultPvId = ""): ShiftCell {
  return {
    employee_id: employeeId,
    shift_date: date,
    work_pv_id: defaultPvId,
    second_work_pv_id: "",
    status: "rest",
    start_time: "",
    end_time: "",
    second_start_time: "",
    second_end_time: "",
    note: "",
    public_label: "",
  };
}

function cloneCellForDate(cell: ShiftCell, employeeId: string, date: string): ShiftCell {
  return {
    employee_id: employeeId,
    shift_date: date,
    work_pv_id: cell.work_pv_id,
    second_work_pv_id: cell.second_work_pv_id,
    status: cell.status,
    start_time: cell.start_time,
    end_time: cell.end_time,
    second_start_time: cell.second_start_time,
    second_end_time: cell.second_end_time,
    note: cell.note,
    public_label: "",
  };
}

function isFilledCell(cell: ShiftCell) {
  return (
    cell.status !== "rest" ||
    Boolean(cell.start_time) ||
    Boolean(cell.end_time) ||
    Boolean(cell.second_start_time) ||
    Boolean(cell.second_end_time) ||
    Boolean(cell.note.trim())
  );
}

function buildCells(employees: Employee[], shifts: ShiftApiRow[], weekDates: string[], fallbackPvId = "") {
  const next: Record<string, ShiftCell> = {};

  for (const employee of employees) {
    const employeePvId = employee.pv_id || fallbackPvId;
    for (const date of weekDates) {
      next[cellKey(employee.id, date)] = emptyCell(employee.id, date, employeePvId);
    }
  }

  for (const row of shifts) {
    const key = cellKey(row.employee_id, row.shift_date);
    if (!next[key]) continue;

    const status = normalizeShiftStatus(row.status) ?? "rest";
    const noTime = isNoTimeStatus(status);
    const defaultWorkPvId = next[key]?.work_pv_id || fallbackPvId;
    next[key] = {
      employee_id: row.employee_id,
      shift_date: row.shift_date,
      work_pv_id: noTime ? "" : String(row.work_pv_id ?? defaultWorkPvId),
      second_work_pv_id: status === "split" ? String(row.second_work_pv_id ?? row.work_pv_id ?? defaultWorkPvId) : "",
      status,
      start_time: noTime ? "" : normalizeTime(row.start_time ?? "") ?? "",
      end_time: noTime ? "" : normalizeTime(row.end_time ?? "") ?? "",
      second_start_time: status === "split" ? normalizeTime(row.second_start_time ?? "") ?? "" : "",
      second_end_time: status === "split" ? normalizeTime(row.second_end_time ?? "") ?? "" : "",
      note: String(row.note ?? ""),
      public_label: String(row.public_label ?? ""),
    };
  }

  return next;
}

function statusCellClass(status: ShiftStatus) {
  switch (status) {
    case "work":
      return "border-emerald-200 bg-emerald-50";
    case "split":
      return "border-sky-200 bg-sky-50";
    case "vacation":
      return "border-violet-200 bg-violet-50";
    case "sick":
      return "border-rose-200 bg-rose-50";
    case "change":
      return "border-amber-200 bg-amber-50";
    case "rest":
    default:
      return "border-slate-200 bg-slate-50";
  }
}

function pvOptionLabel(pv: PV) {
  return [pv.code, pv.name].filter(Boolean).join(" — ") || "PV";
}

function mergeCurrentPv(rows: PV[], currentPv: PV) {
  const map = new Map<string, PV>();
  if (currentPv.id) map.set(currentPv.id, currentPv);

  for (const row of rows) {
    if (!row.id) continue;
    map.set(row.id, row);
  }

  return Array.from(map.values()).sort((a, b) =>
    pvOptionLabel(a).localeCompare(pvOptionLabel(b), "it")
  );
}

function pvLabelById(rows: PV[], pvId: string, fallback = "PV non indicato") {
  if (!pvId) return fallback;
  const pv = rows.find((row) => row.id === pvId);
  return pv ? pvOptionLabel(pv) : fallback;
}

function cellWorkPvLabel(cell: ShiftCell, pvs: PV[], fallbackPvId: string) {
  const firstPvId = cell.work_pv_id || fallbackPvId;
  const firstLabel = pvLabelById(pvs, firstPvId, "PV non indicato");

  if (!requiresSecondShift(cell.status)) return firstLabel;

  const secondPvId = cell.second_work_pv_id || firstPvId;
  const secondLabel = pvLabelById(pvs, secondPvId, "PV non indicato");

  return firstLabel === secondLabel ? firstLabel : `${firstLabel} / ${secondLabel}`;
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

export default function TurniPvClient() {
  const [weekStart, setWeekStart] = useState(currentWeekMondayISO());
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const [me, setMe] = useState<{ pv_id: string; pv_code: string; pv_name: string } | null>(null);
  const [pvs, setPvs] = useState<PV[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cells, setCells] = useState<Record<string, ShiftCell>>({});
  const [summaryOnly, setSummaryOnly] = useState(false);

  const [managerStatusLoading, setManagerStatusLoading] = useState(true);
  const [managerUnlocked, setManagerUnlocked] = useState(false);
  const [managerConfigured, setManagerConfigured] = useState(false);
  const [managerEnabled, setManagerEnabled] = useState(true);
  const [managerCode, setManagerCode] = useState("");
  const [managerLoginLoading, setManagerLoginLoading] = useState(false);

  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [copyDay, setCopyDay] = useState<CopyDayState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekLabel = `${formatDateIT(weekDates[0])} - ${formatDateIT(weekDates[6])}`;

  const workPvOptions = useMemo(() => {
    if (pvs.length > 0) return pvs;
    if (!me) return [];

    return [{ id: me.pv_id, code: me.pv_code, name: me.pv_name }];
  }, [me, pvs]);

  const employeeTotals = useMemo(() => {
    const totals: Record<string, number> = {};

    for (const employee of employees) {
      let total = 0;
      for (const date of weekDates) {
        const cell = cells[cellKey(employee.id, date)] ?? emptyCell(employee.id, date);
        total += shiftHoursTotal(cell);
      }
      totals[employee.id] = total;
    }

    return totals;
  }, [cells, employees, weekDates]);

  async function loadData(nextWeekStart = weekStart) {
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      const meRes = await fetchJsonSafe<MeResponse>("/api/me");
      if (!meRes.ok || !meRes.data) {
        throw new Error(meRes.data?.error || meRes.rawText || `HTTP ${meRes.status}`);
      }
      if (meRes.data.role !== "punto_vendita") throw new Error("Non autorizzato");
      if (!meRes.data.pv_id) throw new Error("PV non assegnato all'utente");

      const currentPv: PV = {
        id: String(meRes.data.pv_id),
        code: String(meRes.data.pv_code || ""),
        name: String(meRes.data.pv_name || ""),
      };

      setMe({
        pv_id: currentPv.id,
        pv_code: currentPv.code,
        pv_name: currentPv.name,
      });

      let pvRows: PV[] = [currentPv];
      try {
        const pvsRes = await fetchJsonSafe<PvsResponse>("/api/pvs/list");
        const rawRows = pvsRes.ok ? pvsRes.data?.pvs ?? pvsRes.data?.rows ?? [] : [];
        const normalizedPvs = Array.isArray(rawRows)
          ? rawRows
              .map((row) => ({
                id: String(row.id || ""),
                code: String(row.code || ""),
                name: String(row.name || ""),
              }))
              .filter((pv) => Boolean(pv.id))
          : [];

        pvRows = mergeCurrentPv(normalizedPvs, currentPv);
      } catch {
        pvRows = [currentPv];
      }
      setPvs(pvRows);

      const employeesRes = await fetchJsonSafe<EmployeesResponse>("/api/work-shifts/employees");
      if (!employeesRes.ok) {
        throw new Error(employeesRes.data?.error || employeesRes.rawText || `HTTP ${employeesRes.status}`);
      }

      const employeeRows = Array.isArray(employeesRes.data?.rows)
        ? (employeesRes.data.rows as Employee[])
        : [];

      const params = new URLSearchParams();
      params.set("week_start", nextWeekStart);
      const shiftsRes = await fetchJsonSafe<WeekResponse>(`/api/work-shifts/week?${params.toString()}`);
      if (!shiftsRes.ok) {
        throw new Error(shiftsRes.data?.error || shiftsRes.rawText || `HTTP ${shiftsRes.status}`);
      }

      const shiftRows = Array.isArray(shiftsRes.data?.rows)
        ? (shiftsRes.data.rows as ShiftApiRow[])
        : [];

      const dates = getWeekDates(nextWeekStart);
      const activeEmployees = employeeRows.filter((employee) => employee.active !== false);
      setSummaryOnly(Boolean(shiftsRes.data?.pv_summary_only && shiftRows.length > 0));
      setEmployees(activeEmployees);
      setCells(buildCells(activeEmployees, shiftRows, dates, currentPv.id));
      setCopyDay(null);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore caricamento turni"));
      setSummaryOnly(false);
      setPvs([]);
      setEmployees([]);
      setCells({});
    } finally {
      setLoading(false);
    }
  }

  async function checkManagerStatus(loadAfterUnlock = false) {
    setManagerStatusLoading(true);
    setError(null);
    setMsg(null);

    try {
      const res = await fetchJsonSafe<ManagerStatusResponse>("/api/work-shifts/manager-status");
      if (!res.ok || !res.data) {
        throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);
      }

      const configured = res.data.configured === true;
      const enabled = res.data.enabled !== false;
      const unlocked = res.data.unlocked === true;

      setManagerConfigured(configured);
      setManagerEnabled(enabled);
      setManagerUnlocked(unlocked);

      if (!configured) {
        setError("Codice responsabile non configurato. Contatta l'amministratore.");
        setLoading(false);
        return;
      }

      if (!enabled) {
        setError("Accesso turni momentaneamente bloccato. Contatta l'amministratore.");
        setLoading(false);
        return;
      }

      if (unlocked && loadAfterUnlock) {
        await loadData(weekStart);
      } else {
        setLoading(false);
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore verifica accesso responsabile"));
      setManagerUnlocked(false);
      setLoading(false);
    } finally {
      setManagerStatusLoading(false);
    }
  }

  async function managerLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);

    const code = managerCode.trim();
    if (!/^[A-Za-z0-9]{6,32}$/.test(code)) {
      setError("Il codice responsabile deve essere alfanumerico, senza spazi, da 6 a 32 caratteri.");
      return;
    }

    setManagerLoginLoading(true);
    try {
      const res = await fetchJsonSafe<ManagerLoginResponse>("/api/work-shifts/manager-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      setManagerCode("");
      setManagerUnlocked(true);
      setMsg("Accesso responsabile sbloccato.");
      await loadData(weekStart);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Codice responsabile non valido"));
    } finally {
      setManagerLoginLoading(false);
    }
  }

  async function managerLogout() {
    setError(null);
    setMsg(null);

    try {
      await fetchJsonSafe<ApiResponseBase>("/api/work-shifts/manager-logout", { method: "POST" });
    } finally {
      setManagerUnlocked(false);
      setSummaryOnly(false);
      setPvs([]);
      setEmployees([]);
      setCells({});
      setMsg("Accesso responsabile chiuso.");
    }
  }

  useEffect(() => {
    void checkManagerStatus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      try {
        fetch("/api/work-shifts/manager-logout", {
          method: "POST",
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Non bloccare la navigazione se la pulizia fallisce.
      }
    };
  }, []);

  useEffect(() => {
    if (!managerUnlocked) return;
    void loadData(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, managerUnlocked]);

  function updateCell(employeeId: string, date: string, patch: Partial<ShiftCell>) {
    const key = cellKey(employeeId, date);

    setCells((prev) => {
      const current = prev[key] ?? emptyCell(employeeId, date);
      const next: ShiftCell = { ...current, ...patch, public_label: "" };

      if (patch.status && isNoTimeStatus(patch.status)) {
        next.start_time = "";
        next.end_time = "";
        next.second_start_time = "";
        next.second_end_time = "";
        next.work_pv_id = "";
        next.second_work_pv_id = "";
      }

      if (patch.status && patch.status !== "split") {
        next.second_start_time = "";
        next.second_end_time = "";
        next.second_work_pv_id = "";
      }

      const defaultPvId = me?.pv_id ?? current.work_pv_id ?? "";
      if (!isNoTimeStatus(next.status)) {
        if (!next.work_pv_id) next.work_pv_id = defaultPvId;

        if (
          patch.work_pv_id &&
          next.status === "split" &&
          (!current.second_work_pv_id || current.second_work_pv_id === current.work_pv_id)
        ) {
          next.second_work_pv_id = patch.work_pv_id;
        }

        if (next.status === "split" && !next.second_work_pv_id) {
          next.second_work_pv_id = next.work_pv_id || defaultPvId;
        }
      }

      return { ...prev, [key]: next };
    });
  }

  function openCopyDay(employeeId: string, sourceDate: string) {
    setError(null);
    setMsg(null);
    setCopyDay({ employeeId, sourceDate, targetDates: [] });
  }

  function toggleCopyTarget(date: string) {
    setCopyDay((prev) => {
      if (!prev) return prev;

      const exists = prev.targetDates.includes(date);
      return {
        ...prev,
        targetDates: exists
          ? prev.targetDates.filter((item) => item !== date)
          : [...prev.targetDates, date],
      };
    });
  }

  function cancelCopyDay() {
    setCopyDay(null);
  }

  function applyCopyDay() {
    if (!copyDay) return;

    const { employeeId, sourceDate, targetDates } = copyDay;
    if (targetDates.length === 0) {
      setError("Seleziona almeno un giorno su cui applicare il turno.");
      return;
    }

    const sourceKey = cellKey(employeeId, sourceDate);
    const sourceCell = cells[sourceKey] ?? emptyCell(employeeId, sourceDate);

    const hasFilledTargets = targetDates.some((date) => {
      const targetCell = cells[cellKey(employeeId, date)] ?? emptyCell(employeeId, date);
      return isFilledCell(targetCell);
    });

    if (
      hasFilledTargets &&
      !window.confirm("I giorni selezionati verranno sovrascritti. Vuoi continuare?")
    ) {
      return;
    }

    setCells((prev) => {
      const next = { ...prev };

      for (const date of targetDates) {
        next[cellKey(employeeId, date)] = cloneCellForDate(sourceCell, employeeId, date);
      }

      return next;
    });

    setCopyDay(null);
    setError(null);
    setMsg("Turno copiato sui giorni selezionati.");
  }

  async function addEmployee(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);

    const name = newEmployeeName.trim();
    if (!name) {
      setError("Inserisci il nome del dipendente.");
      return;
    }

    setEmployeeLoading(true);
    try {
      const res = await fetchJsonSafe<EmployeesResponse>("/api/work-shifts/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      setNewEmployeeName("");
      setMsg("Dipendente aggiunto.");
      await loadData(weekStart);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore aggiunta dipendente"));
    } finally {
      setEmployeeLoading(false);
    }
  }

  async function deactivateEmployee(employee: Employee) {
    if (!window.confirm(`Disattivare ${employee.name}? I turni già salvati restano nello storico.`)) return;

    setError(null);
    setMsg(null);
    setEmployeeLoading(true);

    try {
      const res = await fetchJsonSafe<EmployeesResponse>("/api/work-shifts/employees", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: employee.id, active: false }),
      });

      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      setMsg("Dipendente disattivato.");
      await loadData(weekStart);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore disattivazione dipendente"));
    } finally {
      setEmployeeLoading(false);
    }
  }

  async function renameEmployee(employee: Employee) {
    const nextName = window.prompt("Nuovo nome dipendente", employee.name)?.trim();
    if (!nextName || nextName === employee.name) return;

    setError(null);
    setMsg(null);
    setEmployeeLoading(true);

    try {
      const res = await fetchJsonSafe<EmployeesResponse>("/api/work-shifts/employees", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: employee.id, name: nextName }),
      });

      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      setMsg("Nome dipendente aggiornato.");
      await loadData(weekStart);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore modifica dipendente"));
    } finally {
      setEmployeeLoading(false);
    }
  }

  function buildSavePayload() {
    const shifts: Array<{
      employee_id: string;
      shift_date: string;
      status: ShiftStatus;
      work_pv_id: string | null;
      second_work_pv_id: string | null;
      start_time: string | null;
      end_time: string | null;
      second_start_time: string | null;
      second_end_time: string | null;
      note: string | null;
    }> = [];

    for (const employee of employees) {
      for (const date of weekDates) {
        const cell = cells[cellKey(employee.id, date)] ?? emptyCell(employee.id, date);

        if (!isNoTimeStatus(cell.status)) {
          if (!cell.start_time || !cell.end_time) {
            throw new Error(`${employee.name}, ${formatDateIT(date)}: inserisci ora inizio e ora fine.`);
          }

          if (minutesBetween(cell.start_time, cell.end_time) <= 0) {
            throw new Error(`${employee.name}, ${formatDateIT(date)}: ora fine deve essere diversa da ora inizio.`);
          }
        }

        if (requiresSecondShift(cell.status)) {
          if (!cell.second_start_time || !cell.second_end_time) {
            throw new Error(`${employee.name}, ${formatDateIT(date)}: per lo spezzato inserisci anche inizio e fine pomeriggio.`);
          }

          if (minutesBetween(cell.second_start_time, cell.second_end_time) <= 0) {
            throw new Error(`${employee.name}, ${formatDateIT(date)}: fine pomeriggio deve essere diversa da inizio pomeriggio.`);
          }

          const firstEndMinutes = timeToMinutes(cell.end_time);
const secondStartMinutes = timeToMinutes(cell.second_start_time);

if (
  firstEndMinutes !== null &&
  secondStartMinutes !== null &&
  secondStartMinutes < firstEndMinutes
) {
  throw new Error(`${employee.name}, ${formatDateIT(date)}: il secondo turno non può iniziare prima della fine del primo turno.`);
}
        }

        const firstWorkPvId = !isNoTimeStatus(cell.status)
          ? cell.work_pv_id || me?.pv_id || employee.pv_id || null
          : null;
        const secondWorkPvId = cell.status === "split"
          ? cell.second_work_pv_id || firstWorkPvId
          : null;

        if (!isNoTimeStatus(cell.status) && !firstWorkPvId) {
          throw new Error(`${employee.name}, ${formatDateIT(date)}: seleziona il PV lavoro.`);
        }

        if (cell.status === "split" && !secondWorkPvId) {
          throw new Error(`${employee.name}, ${formatDateIT(date)}: seleziona il PV lavoro del secondo turno.`);
        }

        shifts.push({
          employee_id: employee.id,
          shift_date: date,
          status: cell.status,
          work_pv_id: firstWorkPvId,
          second_work_pv_id: secondWorkPvId,
          start_time: isNoTimeStatus(cell.status) ? null : cell.start_time,
          end_time: isNoTimeStatus(cell.status) ? null : cell.end_time,
          second_start_time: cell.status === "split" ? cell.second_start_time : null,
          second_end_time: cell.status === "split" ? cell.second_end_time : null,
          note: cell.note.trim() || null,
        });
      }
    }

    return shifts;
  }

  async function saveWeek() {
    setError(null);
    setMsg(null);

    if (employees.length === 0) {
      setError("Aggiungi almeno un dipendente prima di salvare i turni.");
      return;
    }

    let shifts: ReturnType<typeof buildSavePayload>;
    try {
      shifts = buildSavePayload();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Controlla i dati inseriti."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetchJsonSafe<WeekResponse>("/api/work-shifts/week", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ week_start: weekStart, shifts }),
      });

      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      setMsg(`Settimana salvata (${res.data?.saved ?? shifts.length} righe).`);
      await loadData(weekStart);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore salvataggio turni"));
    } finally {
      setSaving(false);
    }
  }

  async function copyPreviousWeek() {
    setError(null);
    setMsg(null);
    setCopying(true);

    try {
      const res = await fetchJsonSafe<CopyPreviousResponse>("/api/work-shifts/copy-previous", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ week_start: weekStart }),
      });

      if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

      setMsg(`Settimana precedente copiata (${res.data?.copied ?? 0} turni).`);
      await loadData(weekStart);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore copia settimana precedente"));
    } finally {
      setCopying(false);
    }
  }

  if (managerStatusLoading) {
    return (
      <div className="rounded-2xl border bg-white p-6 text-sm text-gray-600">
        Verifica accesso responsabile turni...
      </div>
    );
  }

  if (!managerUnlocked) {
    return (
      <div className="space-y-6">
        <section className="rounded-2xl border bg-white p-6">
          <div>
            <h2 className="text-xl font-semibold">Accesso responsabile turni</h2>
            <p className="mt-1 text-sm text-gray-600">
              Questa sezione è riservata al responsabile. Inserisci il codice configurato dall'amministratore.
            </p>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {msg && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {msg}
            </div>
          )}

          {managerConfigured && managerEnabled ? (
            <form onSubmit={managerLogin} className="mt-5 flex max-w-md flex-col gap-3 sm:flex-row">
              <input
                type="password"
                className="w-full rounded-xl border p-3"
                placeholder="Codice responsabile"
                value={managerCode}
                minLength={6}
                maxLength={32}
                autoComplete="off"
                onChange={(e) => setManagerCode(e.target.value)}
              />
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-5 py-3 text-white disabled:opacity-60"
                disabled={managerLoginLoading}
              >
                {managerLoginLoading ? "Verifica..." : "Entra"}
              </button>
            </form>
          ) : (
            <div className="mt-5 rounded-xl border bg-gray-50 p-4 text-sm text-gray-700">
              {!managerConfigured
                ? "Codice responsabile non configurato. Chiedi all'admin di impostarlo."
                : "Accesso turni momentaneamente bloccato dall'admin."}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Settimana</h2>
            <p className="text-sm text-gray-600 mt-1">
              {me ? `${me.pv_code} — ${me.pv_name}` : "Caricamento punto vendita..."}
            </p>
            <p className="text-sm text-gray-500 mt-1">Periodo: {weekLabel}</p>
            <button
              type="button"
              className="mt-3 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50"
              onClick={managerLogout}
            >
              Chiudi accesso responsabile
            </button>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div>
              <label className="block text-sm font-medium mb-2">Seleziona settimana</label>
              <input
                type="date"
                className="w-full rounded-xl border p-3 bg-white"
                value={weekStart}
                onChange={(e) => setWeekStart(getMondayISO(e.target.value))}
              />
              <p className="text-xs text-gray-500 mt-1">La data viene portata al lunedì della settimana.</p>
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

              <p className="text-xs text-gray-500 mt-1 invisible">La data viene portata al lunedì della settimana.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Dipendenti</h2>
            <p className="text-sm text-gray-600 mt-1">
              {summaryOnly
                ? "Settimana già salvata: lato PV sono visibili solo presenze e stati, senza orari."
                : "Aggiungi i dipendenti del tuo PV. La disattivazione non elimina i turni già salvati."}
            </p>
          </div>

          {!summaryOnly && (
          <form onSubmit={addEmployee} className="flex flex-col gap-2 sm:flex-row">
            <input
              className="w-full rounded-xl border p-3 sm:w-72"
              placeholder="Nome dipendente"
              value={newEmployeeName}
              onChange={(e) => setNewEmployeeName(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-xl bg-slate-900 text-white px-4 py-3 disabled:opacity-60"
              disabled={employeeLoading || !newEmployeeName.trim()}
            >
              {employeeLoading ? "Salvataggio..." : "Aggiungi"}
            </button>
          </form>
          )}
        </div>

        {employees.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {employees.map((employee) => (
              <div key={employee.id} className="inline-flex items-center gap-2 rounded-xl border bg-gray-50 px-3 py-2 text-sm">
                <span>{employee.name}</span>
                {!summaryOnly && (
                  <>
                    <button
                      type="button"
                      className="text-xs text-slate-700 hover:underline disabled:opacity-60"
                      disabled={employeeLoading}
                      onClick={() => renameEmployee(employee)}
                    >
                      Rinomina
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline disabled:opacity-60"
                      disabled={employeeLoading}
                      onClick={() => deactivateEmployee(employee)}
                    >
                      Disattiva
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {msg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {msg}
        </div>
      )}

      <section className="rounded-2xl border bg-white overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Griglia turni</h2>
            <p className="text-sm text-gray-600 mt-1">
              {summaryOnly
                ? "Settimana già salvata: gli orari e il totale ore sono visibili solo all'admin."
                : "Dipendenti sulle righe, giorni sulle colonne, totale ore nella colonna finale."}
            </p>
          </div>

          {!summaryOnly && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
              disabled={loading || copying || employees.length === 0}
              onClick={copyPreviousWeek}
            >
              {copying ? "Copio..." : "Copia settimana precedente"}
            </button>

            <button
              type="button"
              className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
              disabled={loading || saving || employees.length === 0}
              onClick={saveWeek}
            >
              {saving ? "Salvataggio..." : "Salva settimana"}
            </button>
          </div>
          )}
        </div>

        {summaryOnly && (
          <div className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Questa settimana è già stata salvata. Lato PV restano visibili solo Mattina, Pomeriggio, Notte, Spezzato, Riposo, Ferie, Malattia o Cambio turno.
          </div>
        )}

        {loading ? (
          <div className="p-6 text-sm text-gray-600">Caricamento turni...</div>
        ) : employees.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">
            Nessun dipendente attivo. Aggiungi il primo dipendente per compilare la griglia.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="sticky left-0 z-10 border-b bg-gray-50 px-3 py-3 font-semibold min-w-48">
                    Dipendente
                  </th>
                  {weekDates.map((date, index) => (
                    <th key={date} className="border-b px-3 py-3 font-semibold min-w-48">
                      <div>{WEEK_DAYS[index]?.shortLabel}</div>
                      <div className="text-xs font-normal text-gray-500">{formatDateIT(date)}</div>
                    </th>
                  ))}
                  {!summaryOnly && (
                    <th className="border-b px-3 py-3 font-semibold min-w-28 text-right">Totale</th>
                  )}
                </tr>
              </thead>

              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id} className="align-top">
                    <td className="sticky left-0 z-10 border-b bg-white px-3 py-3 font-medium">
                      {employee.name}
                    </td>

                    {weekDates.map((date) => {
                      const key = cellKey(employee.id, date);
                      const cell = cells[key] ?? emptyCell(employee.id, date);

                      return (
                        <td key={key} className="border-b px-2 py-2">
                          <div className={`rounded-xl border p-2 ${statusCellClass(cell.status)}`}>
                            {summaryOnly ? (
                              <div className="rounded-lg border bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700">
                                <div>{cell.public_label || shiftStatusLabel(cell.status)}</div>
                                {!isNoTimeStatus(cell.status) && (
                                  <div className="mt-1 text-[10px] font-medium text-gray-500">
                                    {cellWorkPvLabel(cell, workPvOptions, me?.pv_id ?? employee.pv_id)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <>
                                <select
                                  className="w-full rounded-lg border bg-white p-2 text-xs"
                                  value={cell.status}
                                  onChange={(e) =>
                                    updateCell(employee.id, date, {
                                      status: e.target.value as ShiftStatus,
                                    })
                                  }
                                >
                                  {SHIFT_STATUSES.map((status) => (
                                    <option key={status} value={status}>
                                      {shiftStatusLabel(status)}
                                    </option>
                                  ))}
                                </select>

                                {!isNoTimeStatus(cell.status) && (
                                  <div className="mt-2 space-y-2">
                                    <div className="rounded-lg border bg-white/70 p-2">
                                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                        {requiresSecondShift(cell.status) ? "Primo turno" : "PV lavoro"}
                                      </div>
                                      <select
                                        className="w-full rounded-lg border bg-white p-2 text-xs"
                                        value={cell.work_pv_id || me?.pv_id || employee.pv_id || ""}
                                        disabled={workPvOptions.length === 0}
                                        onChange={(e) => updateCell(employee.id, date, { work_pv_id: e.target.value })}
                                        aria-label="PV lavoro primo turno"
                                      >
                                        <option value="">Seleziona PV</option>
                                        {workPvOptions.map((pv) => (
                                          <option key={pv.id} value={pv.id}>
                                            {pvOptionLabel(pv)}
                                          </option>
                                        ))}
                                      </select>

                                      <div className="mt-2 grid grid-cols-2 gap-2">
                                        <div>
                                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                            {cell.status === "split" ? "Inizio" : "Inizio"}
                                          </div>
                                          <input
                                            type="time"
                                            className="w-full rounded-lg border bg-white p-2 text-xs"
                                            value={cell.start_time}
                                            onChange={(e) => updateCell(employee.id, date, { start_time: e.target.value })}
                                            aria-label={cell.status === "split" ? "Primo turno inizio" : "Ora inizio"}
                                          />
                                        </div>

                                        <div>
                                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                            Fine
                                          </div>
                                          <input
                                            type="time"
                                            className="w-full rounded-lg border bg-white p-2 text-xs"
                                            value={cell.end_time}
                                            onChange={(e) => updateCell(employee.id, date, { end_time: e.target.value })}
                                            aria-label={cell.status === "split" ? "Primo turno fine" : "Ora fine"}
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    {requiresSecondShift(cell.status) && (
                                      <div className="rounded-lg border bg-white/70 p-2">
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                          Secondo turno
                                        </div>
                                        <select
                                          className="w-full rounded-lg border bg-white p-2 text-xs"
                                          value={cell.second_work_pv_id || cell.work_pv_id || me?.pv_id || employee.pv_id || ""}
                                          disabled={workPvOptions.length === 0}
                                          onChange={(e) => updateCell(employee.id, date, { second_work_pv_id: e.target.value })}
                                          aria-label="PV lavoro secondo turno"
                                        >
                                          <option value="">Seleziona PV</option>
                                          {workPvOptions.map((pv) => (
                                            <option key={pv.id} value={pv.id}>
                                              {pvOptionLabel(pv)}
                                            </option>
                                          ))}
                                        </select>

                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                          <div>
                                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                              Inizio
                                            </div>
                                            <input
                                              type="time"
                                              className="w-full rounded-lg border bg-white p-2 text-xs"
                                              value={cell.second_start_time}
                                              onChange={(e) => updateCell(employee.id, date, { second_start_time: e.target.value })}
                                              aria-label="Secondo turno inizio"
                                            />
                                          </div>

                                          <div>
                                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                              Fine
                                            </div>
                                            <input
                                              type="time"
                                              className="w-full rounded-lg border bg-white p-2 text-xs"
                                              value={cell.second_end_time}
                                              onChange={(e) => updateCell(employee.id, date, { second_end_time: e.target.value })}
                                              aria-label="Secondo turno fine"
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    <div className="text-[11px] font-semibold text-gray-600">
                                      Ore: {formatHours(shiftHoursTotal(cell))} h
                                    </div>
                                  </div>
                                )}

                                <input
                                  className="mt-2 w-full rounded-lg border bg-white p-2 text-xs"
                                  placeholder={cell.status === "change" ? "Nota cambio turno" : "Nota"}
                                  value={cell.note}
                                  maxLength={500}
                                  onChange={(e) => updateCell(employee.id, date, { note: e.target.value })}
                                />

                                <div className="mt-2">
                                  <button
                                    type="button"
                                    className="w-full rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-gray-50"
                                    onClick={() => openCopyDay(employee.id, date)}
                                  >
                                    Copia giorno
                                  </button>
                                </div>

                                {copyDay?.employeeId === employee.id && copyDay.sourceDate === date && (
                                  <div className="mt-2 rounded-lg border bg-white p-2 text-xs">
                                    <div className="font-semibold text-slate-700">Applica questo turno a:</div>

                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {weekDates.map((targetDate, targetIndex) => {
                                        const disabled = targetDate === date;
                                        const checked = copyDay.targetDates.includes(targetDate);

                                        return (
                                          <label
                                            key={targetDate}
                                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 ${
                                              disabled ? "bg-gray-100 text-gray-400" : "bg-white"
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              disabled={disabled}
                                              checked={checked}
                                              onChange={() => toggleCopyTarget(targetDate)}
                                            />
                                            <span>{WEEK_DAYS[targetIndex]?.shortLabel}</span>
                                          </label>
                                        );
                                      })}
                                    </div>

                                    <div className="mt-2 flex gap-2">
                                      <button
                                        type="button"
                                        className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white"
                                        onClick={applyCopyDay}
                                      >
                                        Applica
                                      </button>

                                      <button
                                        type="button"
                                        className="rounded-lg border bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-gray-50"
                                        onClick={cancelCopyDay}
                                      >
                                        Annulla
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      );
                    })}

                    {!summaryOnly && (
                      <td className="border-b px-3 py-3 text-right font-semibold">
                        {formatHours(employeeTotals[employee.id] ?? 0)} h
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Legenda</h2>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <span className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">Turno: orario continuo, conta nelle ore</span>
          <span className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">Spezzato: mattina + pomeriggio, conta entrambe le fasce</span>
          <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">Riposo: 0 ore</span>
          <span className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">Ferie: 0 ore</span>
          <span className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">Malattia: 0 ore</span>
          <span className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">Cambio turno: conta nelle ore e può avere nota</span>
        </div>
      </section>
    </div>
  );
}
