import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { getAppUserIdByUsername } from "@/lib/appUsers";
import { getPvIdForSession } from "@/lib/pvLookup";
import { requireShiftManagerAccess } from "@/lib/work-shifts-manager";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  addDaysISO,
  asRecord,
  currentWeekMondayISO,
  getErrorMessage,
  getMondayISO,
  getWeekDates,
  isDateOnly,
  normalizeShiftStatus,
  normalizeTime,
} from "@/lib/work-shifts";

export const runtime = "nodejs";

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
  created_at?: unknown;
  updated_at?: unknown;
  employees?: unknown;
  pvs?: unknown;
};

function validateWeekStart(value: unknown) {
  const raw = String(value ?? "").trim();
  const base = isDateOnly(raw) ? raw : currentWeekMondayISO();
  return getMondayISO(base);
}

function shiftSelect() {
  return `
    id,
    pv_id,
    employee_id,
    shift_date,
    start_time,
    end_time,
    second_start_time,
    second_end_time,
    status,
    note,
    created_at,
    updated_at,
    employees:employees(id, name, active),
    pvs:pvs(code, name)
  `;
}

function normalizeShift(row: ShiftDbRow) {
  const employee = asRecord(row?.employees);
  const pv = asRecord(row?.pvs);

  return {
    id: String(row?.id ?? ""),
    pv_id: String(row?.pv_id ?? ""),
    employee_id: String(row?.employee_id ?? ""),
    employee_name: employee.name ? String(employee.name) : "",
    employee_active: employee.active !== false,
    pv_code: pv.code ? String(pv.code) : null,
    pv_name: pv.name ? String(pv.name) : null,
    shift_date: String(row?.shift_date ?? ""),
    status: normalizeShiftStatus(row?.status) ?? "rest",
    start_time: normalizeTime(row?.start_time ?? "") ?? null,
    end_time: normalizeTime(row?.end_time ?? "") ?? null,
    second_start_time: normalizeTime(row?.second_start_time ?? "") ?? null,
    second_end_time: normalizeTime(row?.second_end_time ?? "") ?? null,
    note: row?.note ? String(row.note) : "",
    created_at: row?.created_at ? String(row.created_at) : null,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const manager = await requireShiftManagerAccess(session);
    if (!manager.ok) {
      return NextResponse.json({ ok: false, error: manager.error }, { status: manager.httpStatus });
    }

    const body = asRecord(await req.json().catch(() => null));
    const week_start = validateWeekStart(body.week_start);
    const weekDates = getWeekDates(week_start);
    const previous_start = addDaysISO(week_start, -7);
    const previous_end = addDaysISO(previous_start, 6);

    const pvLookup = await getPvIdForSession(session);
    const pv_id = pvLookup.pv_id;
    if (!pv_id) {
      return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    }

    const { data: previousRows, error: previousError } = await supabaseAdmin
      .from("work_shifts")
      .select("employee_id, shift_date, start_time, end_time, second_start_time, second_end_time, status, note")
      .eq("pv_id", pv_id)
      .gte("shift_date", previous_start)
      .lte("shift_date", previous_end)
      .order("shift_date", { ascending: true });

    if (previousError) {
      return NextResponse.json({ ok: false, error: previousError.message }, { status: 500 });
    }

    const rows: Record<string, unknown>[] = Array.isArray(previousRows) ? previousRows.map(asRecord) : [];
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessun turno trovato nella settimana precedente" }, { status: 404 });
    }

    const employeeIds = Array.from(new Set(rows.map((row) => String(row.employee_id ?? "")).filter(Boolean)));
    const { data: employees, error: employeesError } = await supabaseAdmin
      .from("employees")
      .select("id, active")
      .eq("pv_id", pv_id)
      .eq("active", true)
      .in("id", employeeIds);

    if (employeesError) {
      return NextResponse.json({ ok: false, error: employeesError.message }, { status: 500 });
    }

    const activeEmployeeIds = new Set<string>();
    for (const row of employees ?? []) {
      const rec = asRecord(row);
      if (rec.id) activeEmployeeIds.add(String(rec.id));
    }

    const userId = await getAppUserIdByUsername(session.username);

    const payload = rows
      .filter((row) => activeEmployeeIds.has(String(row.employee_id ?? "")))
      .map((row) => ({
        pv_id,
        employee_id: String(row.employee_id ?? ""),
        shift_date: addDaysISO(String(row.shift_date ?? ""), 7),
        status: normalizeShiftStatus(row.status) ?? "rest",
        start_time: normalizeTime(row.start_time ?? ""),
        end_time: normalizeTime(row.end_time ?? ""),
        second_start_time: normalizeTime(row.second_start_time ?? ""),
        second_end_time: normalizeTime(row.second_end_time ?? ""),
        note: row.note ? String(row.note).slice(0, 500) : null,
        created_by: userId,
        updated_by: userId,
      }))
      .filter((row) => weekDates.includes(row.shift_date));

    if (payload.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessun turno copiabile per dipendenti attivi" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("work_shifts")
      .upsert(payload, { onConflict: "pv_id,employee_id,shift_date" })
      .select(shiftSelect());

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      copied: payload.length,
      week_start,
      previous_start,
      rows: (data ?? []).map((row) => normalizeShift(row as unknown as ShiftDbRow)),
      warning: pvLookup.warning ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}
