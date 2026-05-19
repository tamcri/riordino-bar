"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDaysISO,
  currentWeekMondayISO,
  formatDateIT,
  formatHours,
  getMondayISO,
  getWeekDates,
  hoursBetween,
  normalizeShiftStatus,
  normalizeTime,
  shiftStatusLabel,
  type ShiftStatus,
  WEEK_DAYS,
  getErrorMessage,
} from "@/lib/work-shifts";

type ApiResponseBase = {
  ok?: boolean;
  error?: string;
};

type PV = {
  id: string;
  code: string;
  name: string;
};

type PvsResponse = ApiResponseBase & {
  rows?: PV[];
  pvs?: PV[];
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
  note: string | null;
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

function statusBadgeClass(status: ShiftStatus) {
  switch (status) {
    case "work":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "change":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "rest":
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
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

export default function TurniAdminClient() {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [weekStart, setWeekStart] = useState(currentWeekMondayISO());
  const [pvId, setPvId] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (row.status !== "rest") {
        current.totalHours += hoursBetween(row.start_time, row.end_time);
      }

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
  const totalChanges = useMemo(
    () => rows.filter((row) => row.status === "change").length,
    [rows]
  );

  async function loadPvs() {
    const res = await fetchJsonSafe<PvsResponse>("/api/pvs/list");
    if (!res.ok) throw new Error(res.data?.error || res.rawText || `HTTP ${res.status}`);

    const list = (res.data?.pvs ?? res.data?.rows ?? []) as PV[];
    setPvs(Array.isArray(list) ? list : []);
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

  useEffect(() => {
    (async () => {
      try {
        await loadPvs();
        await loadRows();
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Errore"));
        setBootLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFilters() {
    setPvId("");
    setWeekStart(currentWeekMondayISO());
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Visualizza turni</h1>
            <p className="text-gray-600 mt-1">
              Consulta i turni settimanali dei punti vendita, filtrando per settimana e PV.
            </p>
          </div>

          <Link href="/admin" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
            Torna ad Admin
          </Link>
        </div>

        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-gray-500">Dipendenti visualizzati</div>
            <div className="text-2xl font-semibold mt-1">{totalEmployees}</div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-gray-500">Ore totali</div>
            <div className="text-2xl font-semibold mt-1">{formatHours(totalHours)} h</div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-gray-500">Giorni di riposo</div>
            <div className="text-2xl font-semibold mt-1">{totalRestDays}</div>
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

            <div className="flex items-end gap-2">
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
              className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
              onClick={() => {
                resetFilters();
                setTimeout(() => loadRows(), 0);
              }}
            >
              Reset filtri
            </button>
          </div>
        </section>

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
                        const startTime = normalizeTime(shift.start_time ?? "");
                        const endTime = normalizeTime(shift.end_time ?? "");

                        return (
                          <td key={date} className="border-b px-3 py-3">
                            <div className={`rounded-xl border px-3 py-2 ${statusBadgeClass(status)}`}>
                              <div className="text-xs font-semibold">{shiftStatusLabel(status)}</div>
                              {status !== "rest" && (
                                <div className="mt-1 text-sm">
                                  {startTime || "--:--"} - {endTime || "--:--"}
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
      </div>
    </main>
  );
}
