import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  asRecord,
  formatHours,
  isUuid,
  normalizeShiftStatus,
  normalizeTime,
  shiftHoursTotal,
  timeToMinutes,
  toDateOnlyUTC,
  type ShiftStatus,
} from "@/lib/work-shifts";

export const runtime = "nodejs";

type EmployeeDbRow = {
  id?: unknown;
  pv_id?: unknown;
  name?: unknown;
  active?: unknown;
  pvs?: unknown;
};

type ShiftDbRow = {
  id?: unknown;
  pv_id?: unknown;
  employee_id?: unknown;
  shift_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  second_start_time?: unknown;
  second_end_time?: unknown;
  status?: unknown;
  note?: unknown;
};

type AnalysisRow = {
  employee_id: string;
  employee_name: string;
  employee_active: boolean;
  pv_id: string;
  pv_code: string | null;
  pv_name: string | null;
  total_hours: number;
  total_hours_label: string;
  worked_days: number;
  mornings: number;
  afternoons: number;
  nights: number;
  sunday_worked: number;
  sunday_free: number;
  splits: number;
  rest_days: number;
  vacation_days: number;
  sick_days: number;
  change_days: number;
};

type AnalysisAlert = {
  level: "info" | "warning";
  message: string;
  employee_id?: string;
  employee_name?: string;
};

function isMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return false;

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  return yyyy >= 2000 && yyyy <= 2100 && mm >= 1 && mm <= 12;
}

function monthBounds(month: string) {
  const [yyyy, mm] = month.split("-").map(Number);
  const start = new Date(Date.UTC(yyyy, mm - 1, 1));
  const end = new Date(Date.UTC(yyyy, mm, 0));

  return {
    month_start: toDateOnlyUTC(start),
    month_end: toDateOnlyUTC(end),
  };
}

function employeeSelect() {
  return `
    id,
    pv_id,
    name,
    active,
    pvs:pvs(code, name)
  `;
}

function normalizeEmployee(row: EmployeeDbRow) {
  const pv = asRecord(row?.pvs);

  return {
    id: String(row?.id ?? ""),
    pv_id: String(row?.pv_id ?? ""),
    name: String(row?.name ?? ""),
    active: row?.active !== false,
    pv_code: pv.code ? String(pv.code) : null,
    pv_name: pv.name ? String(pv.name) : null,
  };
}

function normalizeShift(row: ShiftDbRow) {
  const status = normalizeShiftStatus(row?.status) ?? "rest";
  const startTime = normalizeTime(row?.start_time ?? "") ?? null;
  const endTime = normalizeTime(row?.end_time ?? "") ?? null;
  const secondStartTime = normalizeTime(row?.second_start_time ?? "") ?? null;
  const secondEndTime = normalizeTime(row?.second_end_time ?? "") ?? null;

  return {
    id: String(row?.id ?? ""),
    pv_id: String(row?.pv_id ?? ""),
    employee_id: String(row?.employee_id ?? ""),
    shift_date: String(row?.shift_date ?? ""),
    status,
    start_time: startTime,
    end_time: endTime,
    second_start_time: secondStartTime,
    second_end_time: secondEndTime,
    hours: shiftHoursTotal({
      status,
      start_time: startTime,
      end_time: endTime,
      second_start_time: secondStartTime,
      second_end_time: secondEndTime,
    }),
  };
}

function isOvernight(startTime: string | null, endTime: string | null) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return start !== null && end !== null && end < start;
}

function isSundayISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).getUTCDay() === 0;
}

function addShiftClassification(row: AnalysisRow, shift: ReturnType<typeof normalizeShift>) {
  const status = shift.status;
  const isSunday = isSundayISODate(shift.shift_date);

  row.total_hours += shift.hours;

  if (status === "rest") {
    row.rest_days += 1;
    if (isSunday) row.sunday_free += 1;
    return;
  }

  if (status === "vacation") {
    row.vacation_days += 1;
    if (isSunday) row.sunday_free += 1;
    return;
  }

  if (status === "sick") {
    row.sick_days += 1;
    if (isSunday) row.sunday_free += 1;
    return;
  }

  if (status === "split") {
    row.splits += 1;
    row.worked_days += 1;
    if (isSunday) row.sunday_worked += 1;
    if (isOvernight(shift.start_time, shift.end_time) || isOvernight(shift.second_start_time, shift.second_end_time)) {
      row.nights += 1;
    }
    return;
  }

  if (status === "change") {
    row.change_days += 1;
    row.worked_days += 1;
    if (isSunday) row.sunday_worked += 1;
  } else if (status === "work") {
    row.worked_days += 1;
    if (isSunday) row.sunday_worked += 1;
  }

  const start = timeToMinutes(shift.start_time);
  const end = timeToMinutes(shift.end_time);

  if (start !== null && end !== null && end < start) {
    row.nights += 1;
  } else if (start !== null && start < 13 * 60) {
    row.mornings += 1;
  } else if (start !== null) {
    row.afternoons += 1;
  }
}

function buildAlerts(rows: AnalysisRow[]): AnalysisAlert[] {
  const activeRows = rows.filter((row) => row.worked_days > 0 || row.total_hours > 0 || row.nights > 0 || row.splits > 0);
  if (activeRows.length <= 1) return [];

  const avgHours = activeRows.reduce((sum, row) => sum + row.total_hours, 0) / activeRows.length;
  const avgNights = activeRows.reduce((sum, row) => sum + row.nights, 0) / activeRows.length;
  const avgSplits = activeRows.reduce((sum, row) => sum + row.splits, 0) / activeRows.length;

  const alerts: AnalysisAlert[] = [];

  for (const row of activeRows) {
    if (row.nights >= avgNights + 2 && row.nights >= 2) {
      alerts.push({
        level: "warning",
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        message: `${row.employee_name} ha ${row.nights} notti, sopra la media del PV (${formatHours(avgNights)}).`,
      });
    }

    if (row.total_hours >= avgHours + 12) {
      alerts.push({
        level: "warning",
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        message: `${row.employee_name} ha ${formatHours(row.total_hours)} ore, almeno 12 ore sopra la media (${formatHours(avgHours)}).`,
      });
    }

    if (row.total_hours <= avgHours - 12 && row.total_hours > 0) {
      alerts.push({
        level: "info",
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        message: `${row.employee_name} ha ${formatHours(row.total_hours)} ore, almeno 12 ore sotto la media (${formatHours(avgHours)}).`,
      });
    }

    if (row.splits >= avgSplits + 2 && row.splits >= 2) {
      alerts.push({
        level: "warning",
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        message: `${row.employee_name} ha ${row.splits} turni spezzati, sopra la media del PV (${formatHours(avgSplits)}).`,
      });
    }
  }

  if (alerts.length === 0) {
    alerts.push({ level: "info", message: "Non sono stati rilevati squilibri evidenti nel periodo selezionato." });
  }

  return alerts;
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);
    const month = String(url.searchParams.get("month") ?? "").trim();
    const pvId = String(url.searchParams.get("pv_id") ?? "").trim();

    if (!isMonth(month)) {
      return NextResponse.json({ ok: false, error: "Mese non valido" }, { status: 400 });
    }

    if (!isUuid(pvId)) {
      return NextResponse.json({ ok: false, error: "Seleziona un punto vendita valido" }, { status: 400 });
    }

    const bounds = monthBounds(month);

    const { data: employeesData, error: employeesError } = await supabaseAdmin
      .from("employees")
      .select(employeeSelect())
      .eq("pv_id", pvId)
      .order("name", { ascending: true });

    if (employeesError) {
      return NextResponse.json({ ok: false, error: employeesError.message }, { status: 500 });
    }

    const employees = ((employeesData ?? []) as unknown[])
      .map((row) => normalizeEmployee(row as EmployeeDbRow))
      .filter((employee) => employee.id);

    const { data: shiftsData, error: shiftsError } = await supabaseAdmin
      .from("work_shifts")
      .select("id, pv_id, employee_id, shift_date, start_time, end_time, second_start_time, second_end_time, status, note")
      .eq("pv_id", pvId)
      .gte("shift_date", bounds.month_start)
      .lte("shift_date", bounds.month_end)
      .order("shift_date", { ascending: true });

    if (shiftsError) {
      return NextResponse.json({ ok: false, error: shiftsError.message }, { status: 500 });
    }

    const rowsByEmployee = new Map<string, AnalysisRow>();

    for (const employee of employees) {
      rowsByEmployee.set(employee.id, {
        employee_id: employee.id,
        employee_name: employee.name,
        employee_active: employee.active,
        pv_id: employee.pv_id,
        pv_code: employee.pv_code,
        pv_name: employee.pv_name,
        total_hours: 0,
        total_hours_label: "0",
        worked_days: 0,
        mornings: 0,
        afternoons: 0,
        nights: 0,
        sunday_worked: 0,
        sunday_free: 0,
        splits: 0,
        rest_days: 0,
        vacation_days: 0,
        sick_days: 0,
        change_days: 0,
      });
    }

    for (const rawShift of (shiftsData ?? []) as unknown[]) {
      const shift = normalizeShift(rawShift as ShiftDbRow);
      if (!shift.employee_id) continue;

      let row = rowsByEmployee.get(shift.employee_id);
      if (!row) {
        row = {
          employee_id: shift.employee_id,
          employee_name: "Dipendente non trovato",
          employee_active: false,
          pv_id: shift.pv_id,
          pv_code: null,
          pv_name: null,
          total_hours: 0,
          total_hours_label: "0",
          worked_days: 0,
          mornings: 0,
          afternoons: 0,
          nights: 0,
          splits: 0,
          rest_days: 0,
          vacation_days: 0,
          sick_days: 0,
          sunday_worked: 0,
          sunday_free: 0,
          change_days: 0,
        };
        rowsByEmployee.set(shift.employee_id, row);
      }

      addShiftClassification(row, shift);
    }

    const rows = Array.from(rowsByEmployee.values())
      .map((row) => ({
        ...row,
        total_hours: Math.round(row.total_hours * 100) / 100,
        total_hours_label: formatHours(row.total_hours),
      }))
      .sort((a, b) => b.total_hours - a.total_hours || b.nights - a.nights || a.employee_name.localeCompare(b.employee_name, "it"));

    const activeRows = rows.filter((row) => row.worked_days > 0 || row.total_hours > 0 || row.nights > 0 || row.splits > 0);
    const totalHours = rows.reduce((sum, row) => sum + row.total_hours, 0);
    const totalNights = rows.reduce((sum, row) => sum + row.nights, 0);
    const totalSplits = rows.reduce((sum, row) => sum + row.splits, 0);

    return NextResponse.json({
      ok: true,
      month,
      month_start: bounds.month_start,
      month_end: bounds.month_end,
      rows,
      alerts: buildAlerts(rows),
      totals: {
        employees_count: rows.length,
        active_employees_count: activeRows.length,
        total_hours: Math.round(totalHours * 100) / 100,
        total_hours_label: formatHours(totalHours),
        avg_hours: activeRows.length ? Math.round((totalHours / activeRows.length) * 100) / 100 : 0,
        avg_hours_label: activeRows.length ? formatHours(totalHours / activeRows.length) : "0",
        total_nights: totalNights,
        avg_nights: activeRows.length ? Math.round((totalNights / activeRows.length) * 100) / 100 : 0,
        total_splits: totalSplits,
        avg_splits: activeRows.length ? Math.round((totalSplits / activeRows.length) * 100) / 100 : 0,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Errore analisi turni" },
      { status: 500 }
    );
  }
}