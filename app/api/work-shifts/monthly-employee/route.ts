import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  asRecord,
  formatHours,
  getErrorMessage,
  hoursBetween,
  isDateOnly,
  isUuid,
  normalizeShiftStatus,
  normalizeTime,
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
  pvs?: { code?: unknown; name?: unknown } | null;
};

type ShiftDbRow = {
  id?: unknown;
  pv_id?: unknown;
  employee_id?: unknown;
  shift_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
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

function normalizeEmployee(row: EmployeeDbRow) {
  return {
    id: String(row?.id ?? ""),
    pv_id: String(row?.pv_id ?? ""),
    name: String(row?.name ?? ""),
    active: row?.active !== false,
    pv_code: row?.pvs?.code ? String(row.pvs.code) : null,
    pv_name: row?.pvs?.name ? String(row.pvs.name) : null,
  };
}

function normalizeShift(row: ShiftDbRow) {
  const status = normalizeShiftStatus(row?.status) ?? "rest";
  const startTime = normalizeTime(row?.start_time ?? "") ?? null;
  const endTime = normalizeTime(row?.end_time ?? "") ?? null;
  const hours = status === "rest" ? 0 : hoursBetween(startTime, endTime);

  return {
    id: String(row?.id ?? ""),
    pv_id: String(row?.pv_id ?? ""),
    employee_id: String(row?.employee_id ?? ""),
    shift_date: String(row?.shift_date ?? ""),
    status,
    status_label: shiftStatusLabel(status),
    start_time: startTime,
    end_time: endTime,
    note: row?.note ? String(row.note) : "",
    hours,
  };
}

async function getSessionFromCookie() {
  return parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
}

export async function GET(req: Request) {
  try {
    const session = await getSessionFromCookie();
    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);
    const month = String(url.searchParams.get("month") ?? "").trim();
    const pvId = String(url.searchParams.get("pv_id") ?? "").trim();
    const employeeId = String(url.searchParams.get("employee_id") ?? "").trim();

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

    if (pvId) employeeQuery = employeeQuery.eq("pv_id", pvId);

    const { data: employeeData, error: employeeError } = await employeeQuery.maybeSingle();
    if (employeeError) {
      return NextResponse.json({ ok: false, error: employeeError.message }, { status: 500 });
    }

    if (!employeeData) {
      return NextResponse.json({ ok: false, error: "Dipendente non trovato" }, { status: 404 });
    }

    const employee = normalizeEmployee(employeeData as unknown as EmployeeDbRow);
    const { month_start, month_end, days } = monthBounds(month);

    const { data: shiftData, error: shiftError } = await supabaseAdmin
      .from("work_shifts")
      .select("id, pv_id, employee_id, shift_date, start_time, end_time, status, note")
      .eq("employee_id", employeeId)
      .eq("pv_id", employee.pv_id)
      .gte("shift_date", month_start)
      .lte("shift_date", month_end)
      .order("shift_date", { ascending: true });

    if (shiftError) {
      return NextResponse.json({ ok: false, error: shiftError.message }, { status: 500 });
    }

    const shiftsByDate = new Map(
      (shiftData ?? []).map((row) => {
        const normalized = normalizeShift(row as unknown as ShiftDbRow);
        return [normalized.shift_date, normalized] as const;
      })
    );

    const rows = days.map((date) => {
      const shift = shiftsByDate.get(date) ?? null;
      const status = shift?.status ?? null;

      return {
        shift_date: date,
        weekday: weekdayLabel(date),
        has_shift: Boolean(shift),
        status,
        status_label: status ? shiftStatusLabel(status as ShiftStatus) : "Nessun turno",
        start_time: shift?.start_time ?? null,
        end_time: shift?.end_time ?? null,
        note: shift?.note ?? "",
        hours: shift?.hours ?? 0,
      };
    });

    const total_hours = rows.reduce((sum, row) => sum + row.hours, 0);
    const total_work_days = rows.filter((row) => row.status === "work").length;
    const total_rest_days = rows.filter((row) => row.status === "rest").length;
    const total_change_days = rows.filter((row) => row.status === "change").length;

    return NextResponse.json({
      ok: true,
      month,
      month_start,
      month_end,
      employee,
      rows,
      totals: {
        total_hours,
        total_hours_label: `${formatHours(total_hours)} h`,
        total_work_days,
        total_rest_days,
        total_change_days,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}
