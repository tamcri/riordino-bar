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
  getMondayISO,
  getWeekDates,
  hoursBetween,
  isDateOnly,
  isUuid,
  normalizeShiftStatus,
  normalizeTime,
  shiftStatusLabel,
  type ShiftStatus,
} from "@/lib/work-shifts";

export const runtime = "nodejs";

type ShiftDbRow = {
  id?: unknown;
  pv_id?: unknown;
  employee_id?: unknown;
  shift_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  status?: unknown;
  note?: unknown;
  employees?: unknown;
  pvs?: unknown;
};

type NormalizedShift = {
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
  note: string;
  hours: number;
};

type GroupedRow = {
  key: string;
  pv_code: string;
  pv_name: string;
  employee_name: string;
  employee_active: boolean;
  shiftsByDate: Record<string, NormalizedShift>;
  totalHours: number;
};

function shiftSelect() {
  return `
    id,
    pv_id,
    employee_id,
    shift_date,
    start_time,
    end_time,
    status,
    note,
    employees:employees(id, name, active),
    pvs:pvs(code, name)
  `;
}

function normalizeShift(row: ShiftDbRow): NormalizedShift {
  const startTime = normalizeTime(row?.start_time ?? "") ?? null;
  const endTime = normalizeTime(row?.end_time ?? "") ?? null;
  const employee = asRecord(row?.employees);
  const pv = asRecord(row?.pvs);
  const status = normalizeShiftStatus(row?.status) ?? "rest";

  return {
    pv_id: String(row?.pv_id ?? ""),
    employee_id: String(row?.employee_id ?? ""),
    employee_name: employee.name ? String(employee.name) : "",
    employee_active: employee.active !== false,
    pv_code: pv.code ? String(pv.code) : null,
    pv_name: pv.name ? String(pv.name) : null,
    shift_date: String(row?.shift_date ?? ""),
    status,
    start_time: startTime,
    end_time: endTime,
    note: row?.note ? String(row.note) : "",
    hours: status === "rest" ? 0 : hoursBetween(startTime, endTime),
  };
}

function groupRows(rows: NormalizedShift[]) {
  const map = new Map<string, GroupedRow>();

  for (const row of rows) {
    const key = `${row.pv_id}:${row.employee_id}`;
    const current =
      map.get(key) ??
      ({
        key,
        pv_code: row.pv_code ?? "",
        pv_name: row.pv_name ?? "",
        employee_name: row.employee_name,
        employee_active: row.employee_active,
        shiftsByDate: {},
        totalHours: 0,
      } satisfies GroupedRow);

    current.shiftsByDate[row.shift_date] = row;
    current.totalHours += row.hours;
    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => {
    const pv = `${a.pv_code} ${a.pv_name}`.localeCompare(`${b.pv_code} ${b.pv_name}`, "it");
    if (pv !== 0) return pv;
    return a.employee_name.localeCompare(b.employee_name, "it");
  });
}

async function getPvLabel(pvId: string | null) {
  if (!pvId) return "Tutti";

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("code, name")
    .eq("id", pvId)
    .maybeSingle();

  if (error || !data) return pvId;

  const code = data.code ? String(data.code) : "";
  const name = data.name ? String(data.name) : "";
  return [code, name].filter(Boolean).join(" - ") || pvId;
}

function shiftCell(shift: NormalizedShift | undefined) {
  if (!shift) return "-";

  const lines = [shiftStatusLabel(shift.status)];

  if (shift.status !== "rest") {
    lines.push(`${shift.start_time || "--:--"} - ${shift.end_time || "--:--"}`);
  }

  if (shift.note) lines.push(`Nota: ${shift.note}`);

  return lines.join("\n");
}

function validateWeekStart(value: unknown) {
  const raw = String(value ?? "").trim();
  const base = isDateOnly(raw) ? raw : "";
  if (!base) return null;
  return getMondayISO(base);
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);
    const weekStart = validateWeekStart(url.searchParams.get("week_start"));
    const pvIdParam = String(url.searchParams.get("pv_id") ?? "").trim();

    if (!weekStart) {
      return NextResponse.json({ ok: false, error: "Settimana non valida" }, { status: 400 });
    }

    if (pvIdParam && !isUuid(pvIdParam)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }

    const weekDates = getWeekDates(weekStart);
    const weekEnd = weekDates[6];

    let query = supabaseAdmin
      .from("work_shifts")
      .select(shiftSelect())
      .gte("shift_date", weekStart)
      .lte("shift_date", weekEnd)
      .order("shift_date", { ascending: true })
      .order("employee_id", { ascending: true })
      .limit(5000);

    if (pvIdParam) query = query.eq("pv_id", pvIdParam);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).map((row) => normalizeShift(row as unknown as ShiftDbRow));
    const grouped = groupRows(rows);
    const pvLabel = await getPvLabel(pvIdParam || null);
    const totalHours = grouped.reduce((sum, row) => sum + row.totalHours, 0);

    const report = await PdfReport.create({
      title: "Report turni settimanale",
      subtitleLines: [
        `Periodo: ${formatDateIT(weekDates[0])} - ${formatDateIT(weekEnd)}`,
        `Punto vendita: ${pvLabel}`,
        `Dipendenti: ${grouped.length} - Ore totali: ${formatHours(totalHours)} h`,
      ],
      landscape: true,
    });

    const widths = [72, 118, 68, 68, 68, 68, 68, 68, 68, 52];

    report.tableRow(
      ["PV", "Dipendente", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom", "Tot."],
      widths,
      { header: true, fontSize: 7.5, lineHeight: 9 }
    );

    if (grouped.length === 0) {
      report.tableRow(["Nessun turno da visualizzare", "", "", "", "", "", "", "", "", ""], widths, {
        fontSize: 8,
        lineHeight: 10,
      });
    } else {
      for (const group of grouped) {
        report.tableRow(
          [
            [group.pv_code || "-", group.pv_name || ""].filter(Boolean).join("\n"),
            `${group.employee_name}${group.employee_active ? "" : "\nNon attivo"}`,
            ...weekDates.map((date) => shiftCell(group.shiftsByDate[date])),
            `${formatHours(group.totalHours)} h`,
          ],
          widths,
          { fontSize: 7.2, lineHeight: 8.6 }
        );
      }
    }

    const pdfBytes = await report.save();
    const fileName = `turni-settimanali-${weekStart}-${safePdfFilePart(pvLabel)}.pdf`;

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
