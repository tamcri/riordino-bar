import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PvRow = { id: string; code: string | null; name: string | null };
type EmployeeRow = {
  id: string;
  pv_id: string;
  name: string | null;
  active: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};
type SettingRow = { pv_id: string; min_employees: number | null; note: string | null };

function employeeNameSort(a: EmployeeRow, b: EmployeeRow) {
  return String(a.name ?? "").localeCompare(String(b.name ?? ""), "it", { sensitivity: "base" });
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole(["admin"]);

    const [{ data: pvs, error: pvsError }, { data: employees, error: employeesError }, { data: settings, error: settingsError }] =
      await Promise.all([
        supabaseAdmin.from("pvs").select("id, code, name").order("code", { ascending: true }),
        supabaseAdmin
          .from("employees")
          .select("id, pv_id, name, active, created_at, updated_at")
          .order("name", { ascending: true }),
        supabaseAdmin.from("pv_staff_settings").select("pv_id, min_employees, note"),
      ]);

    if (pvsError) throw new Error(pvsError.message);
    if (employeesError) throw new Error(employeesError.message);
    if (settingsError) throw new Error(settingsError.message);

    const employeeRows = ((employees ?? []) as EmployeeRow[]).filter((row) => row.pv_id);
    const settingMap = new Map<string, SettingRow>();
    for (const setting of (settings ?? []) as SettingRow[]) {
      settingMap.set(setting.pv_id, setting);
    }

    const rows = ((pvs ?? []) as PvRow[]).map((pv) => {
      const pvEmployees = employeeRows.filter((employee) => employee.pv_id === pv.id);
      const activeEmployees = pvEmployees.filter((employee) => employee.active !== false).sort(employeeNameSort);
      const inactiveEmployees = pvEmployees.filter((employee) => employee.active === false).sort(employeeNameSort);
      const setting = settingMap.get(pv.id) ?? null;
      const minEmployees = setting?.min_employees ?? null;
      const activeCount = activeEmployees.length;
      const shortage = minEmployees !== null && minEmployees > activeCount ? minEmployees - activeCount : 0;
      const status = minEmployees === null ? "not_configured" : shortage > 0 ? "shortage" : "ok";

      return {
        pv_id: pv.id,
        pv_code: pv.code ?? "",
        pv_name: pv.name ?? "",
        min_employees: minEmployees,
        note: setting?.note ?? null,
        active_count: activeCount,
        shortage,
        status,
        active_employees: activeEmployees.map((employee) => ({
          id: employee.id,
          name: employee.name ?? "",
          active: employee.active !== false,
          created_at: employee.created_at ?? null,
          updated_at: employee.updated_at ?? null,
        })),
        inactive_employees: inactiveEmployees.map((employee) => ({
          id: employee.id,
          name: employee.name ?? "",
          active: false,
          created_at: employee.created_at ?? null,
          updated_at: employee.updated_at ?? null,
        })),
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore caricamento organico PV";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
