import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue, type SessionData } from "@/lib/auth";
import { getAppUserIdByUsername } from "@/lib/appUsers";
import { getPvIdForSession } from "@/lib/pvLookup";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  addDaysISO,
  asRecord,
  clampText,
  currentWeekMondayISO,
  getErrorMessage,
  getWeekDates,
  getMondayISO,
  isDateOnly,
  isUuid,
  minutesBetween,
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
  status?: unknown;
  note?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  employees?: unknown;
  pvs?: unknown;
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
    created_at,
    updated_at,
    employees:employees(id, name, active),
    pvs:pvs(code, name)
  `;
}

function normalizeShift(row: ShiftDbRow) {
  const startTime = normalizeTime(row?.start_time ?? "") ?? null;
  const endTime = normalizeTime(row?.end_time ?? "") ?? null;
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
    start_time: startTime,
    end_time: endTime,
    note: row?.note ? String(row.note) : "",
    hours: minutesBetween(startTime, endTime) / 60,
    created_at: row?.created_at ? String(row.created_at) : null,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
}

async function getSessionFromCookie() {
  return parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
}

async function resolvePvIdForRequest(session: SessionData, pvIdParam: string) {
  if (session.role === "punto_vendita") {
    const r = await getPvIdForSession(session);
    if (!r.pv_id) return { ok: false as const, error: "Utente PV senza pv_id", pv_id: null };
    return { ok: true as const, pv_id: r.pv_id, warning: r.warning ?? null };
  }

  if (pvIdParam) {
    if (!isUuid(pvIdParam)) return { ok: false as const, error: "pv_id non valido", pv_id: null };
    return { ok: true as const, pv_id: pvIdParam, warning: null };
  }

  return { ok: true as const, pv_id: null, warning: null };
}

function validateWeekStart(value: unknown) {
  const raw = String(value ?? "").trim();
  const base = isDateOnly(raw) ? raw : currentWeekMondayISO();
  return getMondayISO(base);
}

export async function GET(req: Request) {
  try {
    const session = await getSessionFromCookie();
    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const url = new URL(req.url);
    const week_start = validateWeekStart(url.searchParams.get("week_start"));
    const weekDates = getWeekDates(week_start);
    const week_end = weekDates[6];
    const pvIdParam = String(url.searchParams.get("pv_id") ?? "").trim();

    const pvResolved = await resolvePvIdForRequest(session, pvIdParam);
    if (!pvResolved.ok) {
      return NextResponse.json({ ok: false, error: pvResolved.error }, { status: 400 });
    }

    let q = supabaseAdmin
      .from("work_shifts")
      .select(shiftSelect())
      .gte("shift_date", week_start)
      .lte("shift_date", week_end)
      .order("shift_date", { ascending: true })
      .order("employee_id", { ascending: true })
      .limit(5000);

    if (pvResolved.pv_id) q = q.eq("pv_id", pvResolved.pv_id);

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      week_start,
      week_end,
      week_dates: weekDates,
      pv_id: pvResolved.pv_id,
      rows: (data ?? []).map((row) => normalizeShift(row as unknown as ShiftDbRow)),
      warning: pvResolved.warning ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSessionFromCookie();
    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const body = asRecord(await req.json().catch(() => null));
    const week_start = validateWeekStart(body.week_start);
    const weekDates = getWeekDates(week_start);
    const weekDateSet = new Set(weekDates);
    const shifts = Array.isArray(body.shifts) ? body.shifts.map(asRecord) : [];

    if (shifts.length > 1000) {
      return NextResponse.json({ ok: false, error: "Troppe righe turno in una sola richiesta" }, { status: 400 });
    }

    const pvLookup = await getPvIdForSession(session);
    const pv_id = pvLookup.pv_id;
    if (!pv_id) {
      return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    }

    const employeeIds = Array.from(
      new Set(shifts.map((row) => String(row.employee_id ?? "").trim()).filter(isUuid))
    );

    if (employeeIds.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessun dipendente valido da salvare" }, { status: 400 });
    }

    const { data: employeeRows, error: employeesError } = await supabaseAdmin
      .from("employees")
      .select("id, pv_id, active")
      .eq("pv_id", pv_id)
      .in("id", employeeIds);

    if (employeesError) {
      return NextResponse.json({ ok: false, error: employeesError.message }, { status: 500 });
    }

    const allowedEmployeeIds = new Set<string>();
    for (const row of employeeRows ?? []) {
      const rec = asRecord(row);
      if (rec.id) allowedEmployeeIds.add(String(rec.id));
    }

    if (allowedEmployeeIds.size !== employeeIds.length) {
      return NextResponse.json(
        { ok: false, error: "Uno o più dipendenti non appartengono al PV corrente" },
        { status: 400 }
      );
    }

    const userId = await getAppUserIdByUsername(session.username);
    const seen = new Set<string>();
    const payload: Array<Record<string, unknown>> = [];

    for (const row of shifts) {
      const employee_id = String(row.employee_id ?? "").trim();
      const shift_date = String(row.shift_date ?? "").trim();
      const status = normalizeShiftStatus(row.status);

      if (!isUuid(employee_id)) {
        return NextResponse.json({ ok: false, error: "employee_id non valido" }, { status: 400 });
      }
      if (!allowedEmployeeIds.has(employee_id)) {
        return NextResponse.json({ ok: false, error: "Dipendente non valido per questo PV" }, { status: 400 });
      }
      if (!isDateOnly(shift_date) || !weekDateSet.has(shift_date)) {
        return NextResponse.json({ ok: false, error: "Data turno fuori dalla settimana selezionata" }, { status: 400 });
      }
      if (!status) {
        return NextResponse.json({ ok: false, error: "Stato turno non valido" }, { status: 400 });
      }

      const key = `${employee_id}:${shift_date}`;
      if (seen.has(key)) {
        return NextResponse.json({ ok: false, error: "Turno duplicato per dipendente/giorno" }, { status: 400 });
      }
      seen.add(key);

      let start_time: string | null = null;
      let end_time: string | null = null;
      const note = clampText(row.note, 500) || null;

      if (status !== "rest") {
        start_time = normalizeTime(row.start_time ?? "");
        end_time = normalizeTime(row.end_time ?? "");

        if (!start_time || !end_time) {
          return NextResponse.json(
            { ok: false, error: "Ora inizio e ora fine sono obbligatorie per Turno e Cambio turno" },
            { status: 400 }
          );
        }

        if (minutesBetween(start_time, end_time) <= 0) {
          return NextResponse.json(
            { ok: false, error: "Ora fine deve essere successiva a ora inizio" },
            { status: 400 }
          );
        }
      }

      payload.push({
        pv_id,
        employee_id,
        shift_date,
        status,
        start_time,
        end_time,
        note,
        created_by: userId,
        updated_by: userId,
      });
    }

    const { data, error } = await supabaseAdmin
      .from("work_shifts")
      .upsert(payload, { onConflict: "pv_id,employee_id,shift_date" })
      .select(shiftSelect());

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      week_start,
      week_end: addDaysISO(week_start, 6),
      saved: payload.length,
      rows: (data ?? []).map((row) => normalizeShift(row as unknown as ShiftDbRow)),
      warning: pvLookup.warning ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}
