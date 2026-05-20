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

type ShiftApiRow = {
  employee_id: string;
  shift_date: string;
  status: ShiftStatus;
  start_time: string | null;
  end_time: string | null;
  second_start_time: string | null;
  second_end_time: string | null;
  note: string | null;
};

type ShiftCell = {
  employee_id: string;
  shift_date: string;
  status: ShiftStatus;
  start_time: string;
  end_time: string;
  second_start_time: string;
  second_end_time: string;
  note: string;
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

type WeekResponse = ApiResponseBase & {
  rows?: ShiftApiRow[];
  saved?: number;
};

type CopyPreviousResponse = ApiResponseBase & {
  copied?: number;
};

function cellKey(employeeId: string, date: string) {
  return `${employeeId}:${date}`;
}

function emptyCell(employeeId: string, date: string): ShiftCell {
  return {
    employee_id: employeeId,
    shift_date: date,
    status: "rest",
    start_time: "",
    end_time: "",
    second_start_time: "",
    second_end_time: "",
    note: "",
  };
}

function buildCells(employees: Employee[], shifts: ShiftApiRow[], weekDates: string[]) {
  const next: Record<string, ShiftCell> = {};

  for (const employee of employees) {
    for (const date of weekDates) {
      next[cellKey(employee.id, date)] = emptyCell(employee.id, date);
    }
  }

  for (const row of shifts) {
    const key = cellKey(row.employee_id, row.shift_date);
    if (!next[key]) continue;

    const status = normalizeShiftStatus(row.status) ?? "rest";
    const noTime = isNoTimeStatus(status);
    next[key] = {
      employee_id: row.employee_id,
      shift_date: row.shift_date,
      status,
      start_time: noTime ? "" : normalizeTime(row.start_time ?? "") ?? "",
      end_time: noTime ? "" : normalizeTime(row.end_time ?? "") ?? "",
      second_start_time: status === "split" ? normalizeTime(row.second_start_time ?? "") ?? "" : "",
      second_end_time: status === "split" ? normalizeTime(row.second_end_time ?? "") ?? "" : "",
      note: String(row.note ?? ""),
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
    case "change":
      return "border-amber-200 bg-amber-50";
    case "rest":
    default:
      return "border-slate-200 bg-slate-50";
  }
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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cells, setCells] = useState<Record<string, ShiftCell>>({});

  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekLabel = `${formatDateIT(weekDates[0])} - ${formatDateIT(weekDates[6])}`;

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

      setMe({
        pv_id: String(meRes.data.pv_id),
        pv_code: String(meRes.data.pv_code || ""),
        pv_name: String(meRes.data.pv_name || ""),
      });

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
      setEmployees(employeeRows.filter((employee) => employee.active !== false));
      setCells(buildCells(employeeRows.filter((employee) => employee.active !== false), shiftRows, dates));
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Errore caricamento turni"));
      setEmployees([]);
      setCells({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  function updateCell(employeeId: string, date: string, patch: Partial<ShiftCell>) {
    const key = cellKey(employeeId, date);

    setCells((prev) => {
      const current = prev[key] ?? emptyCell(employeeId, date);
      const next: ShiftCell = { ...current, ...patch };

      if (patch.status && isNoTimeStatus(patch.status)) {
        next.start_time = "";
        next.end_time = "";
        next.second_start_time = "";
        next.second_end_time = "";
      }

      if (patch.status && patch.status !== "split") {
        next.second_start_time = "";
        next.second_end_time = "";
      }

      return { ...prev, [key]: next };
    });
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
            throw new Error(`${employee.name}, ${formatDateIT(date)}: ora fine deve essere successiva a ora inizio.`);
          }
        }

        if (requiresSecondShift(cell.status)) {
          if (!cell.second_start_time || !cell.second_end_time) {
            throw new Error(`${employee.name}, ${formatDateIT(date)}: per lo spezzato inserisci anche inizio e fine pomeriggio.`);
          }

          if (minutesBetween(cell.second_start_time, cell.second_end_time) <= 0) {
            throw new Error(`${employee.name}, ${formatDateIT(date)}: fine pomeriggio deve essere successiva a inizio pomeriggio.`);
          }

          if (cell.end_time && cell.second_start_time && minutesBetween(cell.end_time, cell.second_start_time) <= 0) {
            throw new Error(`${employee.name}, ${formatDateIT(date)}: il turno pomeriggio deve iniziare dopo la fine del turno mattina.`);
          }
        }

        shifts.push({
          employee_id: employee.id,
          shift_date: date,
          status: cell.status,
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
  <label className="block text-sm font-medium mb-2 invisible">
    Navigazione
  </label>

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

  <p className="text-xs text-gray-500 mt-1 invisible">
    La data viene portata al lunedì della settimana.
  </p>
</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Dipendenti</h2>
            <p className="text-sm text-gray-600 mt-1">
              Aggiungi i dipendenti del tuo PV. La disattivazione non elimina i turni già salvati.
            </p>
          </div>

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
        </div>

        {employees.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {employees.map((employee) => (
              <div key={employee.id} className="inline-flex items-center gap-2 rounded-xl border bg-gray-50 px-3 py-2 text-sm">
                <span>{employee.name}</span>
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
              Dipendenti sulle righe, giorni sulle colonne, totale ore nella colonna finale.
            </p>
          </div>

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
        </div>

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
                  <th className="border-b px-3 py-3 font-semibold min-w-28 text-right">Totale</th>
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
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                      {cell.status === "split" ? "AM inizio" : "Inizio"}
                                    </div>
                                    <input
                                      type="time"
                                      className="w-full rounded-lg border bg-white p-2 text-xs"
                                      value={cell.start_time}
                                      onChange={(e) => updateCell(employee.id, date, { start_time: e.target.value })}
                                      aria-label={cell.status === "split" ? "Mattina inizio" : "Ora inizio"}
                                    />
                                  </div>

                                  <div>
                                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                      {cell.status === "split" ? "AM fine" : "Fine"}
                                    </div>
                                    <input
                                      type="time"
                                      className="w-full rounded-lg border bg-white p-2 text-xs"
                                      value={cell.end_time}
                                      onChange={(e) => updateCell(employee.id, date, { end_time: e.target.value })}
                                      aria-label={cell.status === "split" ? "Mattina fine" : "Ora fine"}
                                    />
                                  </div>
                                </div>

                                {requiresSecondShift(cell.status) && (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                        PM inizio
                                      </div>
                                      <input
                                        type="time"
                                        className="w-full rounded-lg border bg-white p-2 text-xs"
                                        value={cell.second_start_time}
                                        onChange={(e) => updateCell(employee.id, date, { second_start_time: e.target.value })}
                                        aria-label="Pomeriggio inizio"
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                        PM fine
                                      </div>
                                      <input
                                        type="time"
                                        className="w-full rounded-lg border bg-white p-2 text-xs"
                                        value={cell.second_end_time}
                                        onChange={(e) => updateCell(employee.id, date, { second_end_time: e.target.value })}
                                        aria-label="Pomeriggio fine"
                                      />
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
                          </div>
                        </td>
                      );
                    })}

                    <td className="border-b px-3 py-3 text-right font-semibold">
                      {formatHours(employeeTotals[employee.id] ?? 0)} h
                    </td>
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
          <span className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">Cambio turno: conta nelle ore e può avere nota</span>
        </div>
      </section>
    </div>
  );
}
