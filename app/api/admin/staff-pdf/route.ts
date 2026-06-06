import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PdfReport, safePdfFilePart } from "@/lib/work-shifts-pdf";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

function todayIT() {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireRole(["admin"]);

    const url = new URL(req.url);
    const pvId = String(url.searchParams.get("pv_id") ?? "").trim();
    if (!isUuid(pvId)) {
      return NextResponse.json({ ok: false, error: "Seleziona un punto vendita valido." }, { status: 400 });
    }

    const [{ data: pv, error: pvError }, { data: employees, error: employeesError }, { data: setting, error: settingError }] =
      await Promise.all([
        supabaseAdmin.from("pvs").select("id, code, name").eq("id", pvId).maybeSingle(),
        supabaseAdmin
          .from("employees")
          .select("id, name, active")
          .eq("pv_id", pvId)
          .eq("active", true)
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("pv_staff_settings")
          .select("pv_id, min_employees, note")
          .eq("pv_id", pvId)
          .maybeSingle(),
      ]);

    if (pvError) throw new Error(pvError.message);
    if (employeesError) throw new Error(employeesError.message);
    if (settingError) throw new Error(settingError.message);
    if (!pv) {
      return NextResponse.json({ ok: false, error: "Punto vendita non trovato." }, { status: 404 });
    }

    const activeEmployees = ((employees ?? []) as { id: string; name: string | null; active: boolean | null }[]).map((employee) => ({
      id: employee.id,
      name: employee.name ?? "",
    }));
    const minEmployees = typeof setting?.min_employees === "number" ? setting.min_employees : null;
    const activeCount = activeEmployees.length;
    const shortage = minEmployees !== null && minEmployees > activeCount ? minEmployees - activeCount : 0;
    const statusLabel = minEmployees === null ? "Non configurato" : shortage > 0 ? `CARENZA DI ${shortage}` : "OK";
    const pvLabel = `${pv.code ?? ""} - ${pv.name ?? ""}`.trim();

    const report = await PdfReport.create({
      title: "Organico Punto Vendita",
      subtitleLines: [`PV: ${pvLabel}`, `Data stampa: ${todayIT()}`],
      landscape: false,
    });

    report.text(`Dipendenti attivi: ${activeCount}`, { font: "bold" });
    report.text(`Organico minimo: ${minEmployees ?? "non configurato"}`, { font: "bold" });
    report.text(`Stato: ${statusLabel}`, { font: "bold" });
    if (setting?.note) {
      report.spacer(4);
      report.text(`Nota: ${setting.note}`);
    }

    report.spacer(10);
    report.rule();
    report.text("Elenco dipendenti attivi", { font: "bold" });
    report.spacer(4);

    report.tableRow(["#", "Dipendente"], [45, report.contentWidth - 45], { header: true, fontSize: 9 });
    if (activeEmployees.length === 0) {
      report.tableRow(["-", "Nessun dipendente attivo"], [45, report.contentWidth - 45], { fontSize: 9 });
    } else {
      activeEmployees.forEach((employee, index) => {
        report.tableRow([String(index + 1), employee.name], [45, report.contentWidth - 45], { fontSize: 9 });
      });
    }

    const bytes = await report.save();
    const filename = `organico-${safePdfFilePart(pv.code ?? "PV")}-${safePdfFilePart(pv.name ?? "")}.pdf`;

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore generazione PDF organico.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
