import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PdfReport, safePdfFilePart } from "@/lib/work-shifts-pdf";
import {
  asRecord,
  formatDateIT,
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
  pvs?: unknown;
};

type ShiftDbRow = {
  shift_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  status?: unknown;
  note?: unknown;
};

type MonthlyRow = {
  shift_date: string;
  weekday: string;
  status: ShiftStatus | null;
  start_time: string | null;
  end_time: string | null;
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

  return {
    shift_date: String(row?.shift_date ?? ""),
    status,
    start_time: startTime,
    end_time: endTime,
    note: row?.note ? String(row.note) : "",
    hours: status === "rest" ? 0 : hoursBetween(startTime, endTime),
  };
}

function shiftTime(row: MonthlyRow) {
  if (!row.status || row.status === "rest") return "-";
  return `${row.start_time || "--:--"} - ${row.end_time || "--:--"}`;
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
    const { monthStart, monthEnd, days } = monthBounds(month);

    const { data: shiftsData, error: shiftsError } = await supabaseAdmin
      .from("work_shifts")
      .select("shift_date, start_time, end_time, status, note")
      .eq("employee_id", employeeId)
      .eq("pv_id", employee.pv_id)
      .gte("shift_date", monthStart)
      .lte("shift_date", monthEnd)
      .order("shift_date", { ascending: true });

    if (shiftsError) {
      return NextResponse.json({ ok: false, error: shiftsError.message }, { status: 500 });
    }

    const shiftsByDate = new Map(
      (shiftsData ?? []).map((row) => {
        const shift = normalizeShift(row as unknown as ShiftDbRow);
        return [shift.shift_date, shift] as const;
      })
    );

    const rows: MonthlyRow[] = days.map((date) => {
      const shift = shiftsByDate.get(date) ?? null;

      return {
        shift_date: date,
        weekday: weekdayLabel(date),
        status: shift?.status ?? null,
        start_time: shift?.start_time ?? null,
        end_time: shift?.end_time ?? null,
        note: shift?.note ?? "",
        hours: shift?.hours ?? 0,
      };
    });

    const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
    const totalWorkDays = rows.filter((row) => row.status === "work").length;
    const totalRestDays = rows.filter((row) => row.status === "rest").length;
    const totalChangeDays = rows.filter((row) => row.status === "change").length;
    const pvLabel = [employee.pv_code, employee.pv_name].filter(Boolean).join(" - ") || "PV non indicato";

    const report = await PdfReport.create({
      title: "Scheda mensile turni",
      subtitleLines: [
        `Mese: ${formatMonthIT(month)}`,
        `Punto vendita: ${pvLabel}`,
        `Dipendente: ${employee.name}`,
        `Totale ore: ${formatHours(totalHours)} h - Lavorati: ${totalWorkDays} - Riposi: ${totalRestDays} - Cambi: ${totalChangeDays}`,
      ],
    });

    const widths = [62, 42, 78, 78, 45, 218];

    report.tableRow(["Data", "Giorno", "Stato", "Turno", "Ore", "Note"], widths, {
      header: true,
      fontSize: 8,
      lineHeight: 10,
    });

    for (const row of rows) {
      report.tableRow(
        [
          formatDateIT(row.shift_date),
          row.weekday,
          row.status ? shiftStatusLabel(row.status) : "Nessun turno",
          shiftTime(row),
          `${formatHours(row.hours)} h`,
          row.note || "-",
        ],
        widths,
        { fontSize: 8, lineHeight: 10 }
      );
    }

    report.tableRow(
      ["Totale mese", "", "", "", `${formatHours(totalHours)} h`, `Lavorati: ${totalWorkDays} - Riposi: ${totalRestDays} - Cambi: ${totalChangeDays}`],
      widths,
      { header: true, fontSize: 8, lineHeight: 10 }
    );

    const pdfBytes = await report.save();
    const fileName = `scheda-turni-${safePdfFilePart(employee.name)}-${month}.pdf`;

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
