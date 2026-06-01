import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  asRecord,
  formatHours,
  formatShiftTimeRange,
  getErrorMessage,
  isDateOnly,
  isUuid,
  normalizeShiftStatus,
  normalizeTime,
  shiftHoursTotal,
  shiftStatusLabel,
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

function employeeSelect() {
  return `
    id,
    pv_id,
    name,
    active,
    pvs:pvs(code, name)
  `;
}

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
    days: Array.from({ length: end.getUTCDate() }, (_, index) => {
      const d = new Date(Date.UTC(yyyy, mm - 1, index + 1));
      return toDateOnlyUTC(d);
    }),
  };
}

function weekdayLabel(dateISO: string) {
  if (!isDateOnly(dateISO)) return "";
  const [yyyy, mm, dd] = dateISO.split("-").map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  const labels = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  return labels[d.getUTCDay()] ?? "";
}

function normalizeName(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("it-IT");
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
  const hours = shiftHoursTotal({
    status,
    start_time: startTime,
    end_time: endTime,
    second_start_time: secondStartTime,
    second_end_time: secondEndTime,
  });
  const shiftLabel = formatShiftTimeRange({
    status,
    start_time: startTime,
    end_time: endTime,
    second_start_time: secondStartTime,
    second_end_time: secondEndTime,
  });

  return {
    id: String(row?.id ?? ""),
    pv_id: String(row?.pv_id ?? ""),
    employee_id: String(row?.employee_id ?? ""),
    shift_date: String(row?.shift_date ?? ""),
    status,
    status_label: shiftStatusLabel(status),
    start_time: startTime,
    end_time: endTime,
    second_start_time: secondStartTime,
    second_end_time: secondEndTime,
    shift_label: shiftLabel,
    note: row?.note ? String(row.note) : "",
    hours,
  };
}

function emptyMonthlyRow(date: string) {
  return {
    shift_date: date,
    weekday: weekdayLabel(date),
    has_shift: false,
    employee_id: null,
    employee_name: null,
    pv_id: null,
    pv_code: null,
    pv_name: null,
    status: null,
    status_label: "Nessun turno",
    start_time: null,
    end_time: null,
    second_start_time: null,
    second_end_time: null,
    shift_label: "—",
    note: "",
    hours: 0,
  };
}

async function getMatchingEmployees(employee: ReturnType<typeof normalizeEmployee>, includeSameName: boolean) {
  if (!includeSameName) return [employee];

  const targetName = normalizeName(employee.name);
  if (!targetName) return [employee];

  const { data, error } = await supabaseAdmin
    .from("employees")
    .select(employeeSelect())
    .limit(2000);

  if (error) throw new Error(error.message);

  const matches = ((data ?? []) as unknown[])
    .map((row) => normalizeEmployee(row as EmployeeDbRow))
    .filter((row) => row.id && normalizeName(row.name) === targetName);

  return matches.length > 0 ? matches : [employee];
}

function computeTotals(rows: Array<{ status: ShiftStatus | null; hours: number; has_shift?: boolean }>) {
  const visibleRows = rows.filter((row) => row.has_shift !== false);

  return {
    total_hours: visibleRows.reduce((sum, row) => sum + Number(row.hours || 0), 0),
    total_hours_label: formatHours(visibleRows.reduce((sum, row) => sum + Number(row.hours || 0), 0)),
    total_work_days: visibleRows.filter((row) => row.status === "work" || row.status === "split" || row.status === "change").length,
    total_split_days: visibleRows.filter((row) => row.status === "split").length,
    total_rest_days: visibleRows.filter((row) => row.status === "rest").length,
    total_vacation_days: visibleRows.filter((row) => row.status === "vacation").length,
    total_sick_days: visibleRows.filter((row) => row.status === "sick").length,
    total_change_days: visibleRows.filter((row) => row.status === "change").length,
  };
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
    const employeeId = String(url.searchParams.get("employee_id") ?? "").trim();
    const includeSameName = String(url.searchParams.get("include_same_name") ?? "") === "1";

    if (!isMonth(month)) {
      return NextResponse.json({ ok: false, error: "Mese non valido" }, { status: 400 });
    }

    if (pvId && !isUuid(pvId)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }

    if (!isUuid(employeeId)) {
      return NextResponse.json({ ok: false, error: "employee_id non valido" }, { status: 400 });
    }

    let employeeQuery = supabaseAdmin
      .from("employees")
      .select(employeeSelect())
      .eq("id", employeeId);

    if (pvId && !includeSameName) employeeQuery = employeeQuery.eq("pv_id", pvId);

    const { data: employeeData, error: employeeError } = await employeeQuery.maybeSingle();
    if (employeeError) {
      return NextResponse.json({ ok: false, error: employeeError.message }, { status: 500 });
    }

    if (!employeeData) {
      return NextResponse.json({ ok: false, error: "Dipendente non trovato" }, { status: 404 });
    }

    const employee = normalizeEmployee(employeeData as EmployeeDbRow);
    const matchedEmployees = await getMatchingEmployees(employee, includeSameName);
    const employeeById = new Map(matchedEmployees.map((row) => [row.id, row]));
    const employeeIds = matchedEmployees.map((row) => row.id).filter(isUuid);
    const { month_start, month_end, days } = monthBounds(month);

    const { data: shiftData, error: shiftError } = await supabaseAdmin
      .from("work_shifts")
      .select("id, pv_id, employee_id, shift_date, start_time, end_time, second_start_time, second_end_time, status, note")
      .in("employee_id", employeeIds)
      .gte("shift_date", month_start)
      .lte("shift_date", month_end)
      .order("shift_date", { ascending: true });

    if (shiftError) {
      return NextResponse.json({ ok: false, error: shiftError.message }, { status: 500 });
    }

    const normalizedShifts = ((shiftData ?? []) as unknown[])
      .map((row) => normalizeShift(row as ShiftDbRow))
      .filter((row) => employeeById.has(row.employee_id));

    const rows = includeSameName
      ? normalizedShifts.map((shift) => {
          const emp = employeeById.get(shift.employee_id) ?? employee;
          return {
            shift_date: shift.shift_date,
            weekday: weekdayLabel(shift.shift_date),
            has_shift: true,
            employee_id: emp.id,
            employee_name: emp.name,
            pv_id: emp.pv_id,
            pv_code: emp.pv_code,
            pv_name: emp.pv_name,
            status: shift.status,
            status_label: shift.status_label,
            start_time: shift.start_time,
            end_time: shift.end_time,
            second_start_time: shift.second_start_time,
            second_end_time: shift.second_end_time,
            shift_label: shift.shift_label,
            note: shift.note,
            hours: shift.hours,
          };
        })
      : days.map((date) => {
          const shift = normalizedShifts.find((row) => row.shift_date === date) ?? null;
          return shift
            ? {
                shift_date: date,
                weekday: weekdayLabel(date),
                has_shift: true,
                employee_id: employee.id,
                employee_name: employee.name,
                pv_id: employee.pv_id,
                pv_code: employee.pv_code,
                pv_name: employee.pv_name,
                status: shift.status,
                status_label: shift.status_label,
                start_time: shift.start_time,
                end_time: shift.end_time,
                second_start_time: shift.second_start_time,
                second_end_time: shift.second_end_time,
                shift_label: shift.shift_label,
                note: shift.note,
                hours: shift.hours,
              }
            : emptyMonthlyRow(date);
        });

    const sortedRows = rows.sort((a, b) => {
      const dateCompare = a.shift_date.localeCompare(b.shift_date);
      if (dateCompare !== 0) return dateCompare;
      const pvCompare = `${a.pv_code ?? ""} ${a.pv_name ?? ""}`.localeCompare(`${b.pv_code ?? ""} ${b.pv_name ?? ""}`, "it");
      if (pvCompare !== 0) return pvCompare;
      return `${a.employee_name ?? ""}`.localeCompare(`${b.employee_name ?? ""}`, "it");
    });

    const totals = computeTotals(sortedRows);

    return NextResponse.json({
      ok: true,
      month,
      month_start,
      month_end,
      grouped_by_name: includeSameName,
      matched_employees_count: matchedEmployees.length,
      employee: includeSameName
        ? {
            ...employee,
            pv_code: null,
            pv_name: `Aggregato su ${matchedEmployees.length} record dipendente`,
          }
        : employee,
      rows: sortedRows,
      totals,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}
