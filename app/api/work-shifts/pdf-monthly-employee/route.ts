import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PdfReport, safePdfFilePart } from "@/lib/work-shifts-pdf";
import {
  asRecord,
  formatDateIT,
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

type MonthlyRow = {
  shift_date: string;
  weekday: string;
  has_shift: boolean;
  employee_id: string | null;
  employee_name: string | null;
  pv_id: string | null;
  pv_code: string | null;
  pv_name: string | null;
  status: ShiftStatus | null;
  start_time: string | null;
  end_time: string | null;
  second_start_time: string | null;
  second_end_time: string | null;
  shift_label: string;
  note: string;
  hours: number;
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
    monthStart: toDateOnlyUTC(start),
    monthEnd: toDateOnlyUTC(end),
    days: Array.from({ length: end.getUTCDate() }, (_, index) => {
      const d = new Date(Date.UTC(yyyy, mm - 1, index + 1));
      return toDateOnlyUTC(d);
    }),
  };
}

function formatMonthIT(value: string) {
  const [yyyy, mm] = value.split("-").map(Number);
  const d = new Date(Number(yyyy), Number(mm) - 1, 1);
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(d);
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
    start_time: startTime,
    end_time: endTime,
    second_start_time: secondStartTime,
    second_end_time: secondEndTime,
    shift_label: shiftLabel,
    note: row?.note ? String(row.note) : "",
    hours,
  };
}

function emptyMonthlyRow(date: string): MonthlyRow {
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

function rowShiftTime(row: MonthlyRow) {
  return row.shift_label || "—";
}

function countRows(rows: MonthlyRow[], status: ShiftStatus) {
  return rows.filter((row) => row.has_shift && row.status === status).length;
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
    const { monthStart, monthEnd, days } = monthBounds(month);

    const { data: shiftsData, error: shiftsError } = await supabaseAdmin
      .from("work_shifts")
      .select("id, pv_id, employee_id, shift_date, start_time, end_time, second_start_time, second_end_time, status, note")
      .in("employee_id", employeeIds)
      .gte("shift_date", monthStart)
      .lte("shift_date", monthEnd)
      .order("shift_date", { ascending: true });

    if (shiftsError) {
      return NextResponse.json({ ok: false, error: shiftsError.message }, { status: 500 });
    }

    const normalizedShifts = ((shiftsData ?? []) as unknown[])
      .map((row) => normalizeShift(row as ShiftDbRow))
      .filter((row) => employeeById.has(row.employee_id));

    const rows: MonthlyRow[] = includeSameName
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
          if (!shift) return emptyMonthlyRow(date);
          return {
            shift_date: date,
            weekday: weekdayLabel(date),
            has_shift: true,
            employee_id: employee.id,
            employee_name: employee.name,
            pv_id: employee.pv_id,
            pv_code: employee.pv_code,
            pv_name: employee.pv_name,
            status: shift.status,
            start_time: shift.start_time,
            end_time: shift.end_time,
            second_start_time: shift.second_start_time,
            second_end_time: shift.second_end_time,
            shift_label: shift.shift_label,
            note: shift.note,
            hours: shift.hours,
          };
        });

    rows.sort((a, b) => {
      const dateCompare = a.shift_date.localeCompare(b.shift_date);
      if (dateCompare !== 0) return dateCompare;
      const pvCompare = `${a.pv_code ?? ""} ${a.pv_name ?? ""}`.localeCompare(`${b.pv_code ?? ""} ${b.pv_name ?? ""}`, "it");
      if (pvCompare !== 0) return pvCompare;
      return `${a.employee_name ?? ""}`.localeCompare(`${b.employee_name ?? ""}`, "it");
    });

    const visibleRows = rows.filter((row) => row.has_shift);
    const totalHours = visibleRows.reduce((sum, row) => sum + row.hours, 0);
    const totalWorkDays = visibleRows.filter((row) => row.status === "work" || row.status === "split" || row.status === "change").length;
    const totalSplitDays = countRows(visibleRows, "split");
    const totalRestDays = countRows(visibleRows, "rest");
    const totalVacationDays = countRows(visibleRows, "vacation");
    const totalSickDays = countRows(visibleRows, "sick");
    const totalChangeDays = countRows(visibleRows, "change");
    const pvLabel = includeSameName
      ? `Aggregato su ${matchedEmployees.length} record dipendente`
      : [employee.pv_code, employee.pv_name].filter(Boolean).join(" - ") || "PV non indicato";

    const report = await PdfReport.create({
      title: "Scheda mensile turni",
      subtitleLines: [
        `Mese: ${formatMonthIT(month)}`,
        `Punto vendita: ${pvLabel}`,
        `Dipendente: ${employee.name}`,
        `Totale ore: ${formatHours(totalHours)} h - Lavorati: ${totalWorkDays} - Spezzati: ${totalSplitDays} - Riposi: ${totalRestDays} - Ferie: ${totalVacationDays} - Malattia: ${totalSickDays} - Cambi: ${totalChangeDays}`,
      ],
    });

    const widths = includeSameName ? [54, 58, 36, 72, 72, 42, 178] : [62, 42, 78, 78, 45, 218];

    report.tableRow(
      includeSameName
        ? ["Data", "PV", "Giorno", "Stato", "Turno", "Ore", "Note"]
        : ["Data", "Giorno", "Stato", "Turno", "Ore", "Note"],
      widths,
      { header: true, fontSize: 8, lineHeight: 10 }
    );

    for (const row of rows) {
      const values = includeSameName
        ? [
            formatDateIT(row.shift_date),
            [row.pv_code || "-", row.pv_name || ""].filter(Boolean).join("\n"),
            row.weekday,
            row.status ? shiftStatusLabel(row.status) : "Nessun turno",
            rowShiftTime(row),
            `${formatHours(row.hours)} h`,
            row.note || "-",
          ]
        : [
            formatDateIT(row.shift_date),
            row.weekday,
            row.status ? shiftStatusLabel(row.status) : "Nessun turno",
            rowShiftTime(row),
            `${formatHours(row.hours)} h`,
            row.note || "-",
          ];

      report.tableRow(values, widths, { fontSize: 8, lineHeight: 10 });
    }

    report.tableRow(
      includeSameName
        ? ["Totale mese", "", "", "", "", `${formatHours(totalHours)} h`, `Lavorati: ${totalWorkDays} - Riposi: ${totalRestDays} - Ferie: ${totalVacationDays} - Malattia: ${totalSickDays} - Cambi: ${totalChangeDays}`]
        : ["Totale mese", "", "", "", `${formatHours(totalHours)} h`, `Lavorati: ${totalWorkDays} - Riposi: ${totalRestDays} - Ferie: ${totalVacationDays} - Malattia: ${totalSickDays} - Cambi: ${totalChangeDays}`],
      widths,
      { header: true, fontSize: 8, lineHeight: 10 }
    );

    const pdfBytes = await report.save();
    const fileName = includeSameName
      ? `scheda-turni-aggregata-${safePdfFilePart(employee.name)}-${month}.pdf`
      : `scheda-turni-${safePdfFilePart(employee.name)}-${month}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore generazione PDF") }, { status: 500 });
  }
}
