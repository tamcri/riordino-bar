import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { getAppUserIdByUsername } from "@/lib/appUsers";
import { getPvIdForSession } from "@/lib/pvLookup";
import { requireShiftManagerAccess } from "@/lib/work-shifts-manager";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord, clampText, getErrorMessage, isUuid } from "@/lib/work-shifts";

export const runtime = "nodejs";

type EmployeeDbRow = {
  id?: unknown;
  pv_id?: unknown;
  name?: unknown;
  active?: unknown;
  counts_in_staff?: unknown;
  contract_type?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  pvs?: { code?: unknown; name?: unknown } | null;
};

type EmployeeContractType = "full_time" | "part_time";

function normalizeContractType(value: unknown): EmployeeContractType {
  return value === "part_time" ? "part_time" : "full_time";
}

function isValidContractType(value: unknown): value is EmployeeContractType {
  return value === "full_time" || value === "part_time";
}

function employeeSelect() {
  return `
    id,
    pv_id,
    name,
    active,
    counts_in_staff,
    contract_type,
    created_at,
    updated_at,
    pvs:pvs(code, name)
  `;
}

function normalizeEmployee(row: EmployeeDbRow) {
  return {
    id: String(row?.id ?? ""),
    pv_id: String(row?.pv_id ?? ""),
    name: String(row?.name ?? ""),
    active: row?.active !== false,
    counts_in_staff: row?.counts_in_staff !== false,
    contract_type: normalizeContractType(row?.contract_type),
    created_at: row?.created_at ? String(row.created_at) : null,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
    pv_code: row?.pvs?.code ? String(row.pvs.code) : null,
    pv_name: row?.pvs?.name ? String(row.pvs.name) : null,
  };
}

async function getSessionFromCookie() {
  return parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
}

export async function GET(req: Request) {
  try {
    const session = await getSessionFromCookie();
    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    if (session.role === "punto_vendita") {
      const manager = await requireShiftManagerAccess(session);
      if (!manager.ok) {
        return NextResponse.json({ ok: false, error: manager.error }, { status: manager.httpStatus });
      }
    }

    const url = new URL(req.url);
    const pvIdParam = String(url.searchParams.get("pv_id") ?? "").trim();
    const includeInactive = String(url.searchParams.get("include_inactive") ?? "") === "1";

    let pv_id: string | null = null;

    if (session.role === "punto_vendita") {
      const r = await getPvIdForSession(session);
      pv_id = r.pv_id;
      if (!pv_id) {
        return NextResponse.json({ ok: false, error: "Utente PV senza pv_id" }, { status: 400 });
      }
    } else if (pvIdParam) {
      if (!isUuid(pvIdParam)) {
        return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
      }
      pv_id = pvIdParam;
    }

    let q = supabaseAdmin
      .from("employees")
      .select(employeeSelect())
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(1000);

    if (pv_id) q = q.eq("pv_id", pv_id);
    if (!includeInactive) q = q.eq("active", true);

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, rows: (data ?? []).map((row) => normalizeEmployee(row as unknown as EmployeeDbRow)) });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSessionFromCookie();
    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const body = asRecord(await req.json().catch(() => null));
    const name = clampText(body.name, 120);
    const contractType = normalizeContractType(body.contract_type);

    if (!name) {
      return NextResponse.json({ ok: false, error: "Nome dipendente obbligatorio" }, { status: 400 });
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "contract_type") &&
      !isValidContractType(body.contract_type)
    ) {
      return NextResponse.json({ ok: false, error: "Tipo contratto non valido" }, { status: 400 });
    }

    let pv_id: string | null = null;
    let warning: string | null = null;

    if (session.role === "punto_vendita") {
      const manager = await requireShiftManagerAccess(session);
      if (!manager.ok) {
        return NextResponse.json({ ok: false, error: manager.error }, { status: manager.httpStatus });
      }

      const pvLookup = await getPvIdForSession(session);
      pv_id = pvLookup.pv_id;
      warning = pvLookup.warning ?? null;

      if (!pv_id) {
        return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
      }
    } else {
      const pvIdParam = String(body.pv_id ?? "").trim();
      if (!isUuid(pvIdParam)) {
        return NextResponse.json({ ok: false, error: "Seleziona un punto vendita valido" }, { status: 400 });
      }
      pv_id = pvIdParam;
    }

    const userId = await getAppUserIdByUsername(session.username);

    const { data, error } = await supabaseAdmin
      .from("employees")
      .insert({
       pv_id,
       name,
       active: true,
       counts_in_staff: body.counts_in_staff !== false,
       contract_type: contractType,
       created_by: userId,
       updated_by: userId,
      })
      .select(employeeSelect())
      .single();

    if (error) {
      const msg = error.code === "23505" ? "Dipendente già presente per questo PV" : error.message;
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    return NextResponse.json({ ok: true, row: normalizeEmployee(data as unknown as EmployeeDbRow), warning });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSessionFromCookie();
    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const body = asRecord(await req.json().catch(() => null));
    const id = String(body.id ?? "").trim();
    if (!isUuid(id)) {
      return NextResponse.json({ ok: false, error: "employee_id non valido" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const name = clampText(body.name, 120);
      if (!name) {
        return NextResponse.json({ ok: false, error: "Nome dipendente obbligatorio" }, { status: 400 });
      }
      update.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(body, "active")) {
      update.active = body.active !== false;
    }

        if (Object.prototype.hasOwnProperty.call(body, "counts_in_staff")) {
      update.counts_in_staff = body.counts_in_staff !== false;
    }

    if (Object.prototype.hasOwnProperty.call(body, "contract_type")) {
      if (!isValidContractType(body.contract_type)) {
        return NextResponse.json({ ok: false, error: "Tipo contratto non valido" }, { status: 400 });
      }

      update.contract_type = body.contract_type;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: false, error: "Nessuna modifica da salvare" }, { status: 400 });
    }

    let pv_id: string | null = null;
    let warning: string | null = null;

    if (session.role === "punto_vendita") {
      const manager = await requireShiftManagerAccess(session);
      if (!manager.ok) {
        return NextResponse.json({ ok: false, error: manager.error }, { status: manager.httpStatus });
      }

      const pvLookup = await getPvIdForSession(session);
      pv_id = pvLookup.pv_id;
      warning = pvLookup.warning ?? null;

      if (!pv_id) {
        return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
      }
    } else {
      const pvIdParam = String(body.pv_id ?? "").trim();
      if (!isUuid(pvIdParam)) {
        return NextResponse.json({ ok: false, error: "Seleziona un punto vendita valido" }, { status: 400 });
      }
      pv_id = pvIdParam;
    }

    update.updated_by = await getAppUserIdByUsername(session.username);

    const { data, error } = await supabaseAdmin
      .from("employees")
      .update(update)
      .eq("id", id)
      .eq("pv_id", pv_id)
      .select(employeeSelect())
      .maybeSingle();

    if (error) {
      const msg = error.code === "23505" ? "Dipendente già presente per questo PV" : error.message;
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "Dipendente non trovato" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, row: normalizeEmployee(data as unknown as EmployeeDbRow), warning });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}
