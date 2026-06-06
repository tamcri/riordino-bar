import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

function clampText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function getAppUserIdByUsername(username: string) {
  const { data } = await supabaseAdmin
    .from("app_users")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  return typeof data?.id === "string" ? data.id : null;
}

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await requireRole(["admin"]);
    const body = await req.json().catch(() => null);
    const pvId = String(body?.pv_id ?? "").trim();
    const minEmployees = Number.parseInt(String(body?.min_employees ?? "0"), 10);
    const note = clampText(body?.note, 500) || null;

    if (!isUuid(pvId)) {
      return NextResponse.json({ ok: false, error: "Seleziona un punto vendita valido." }, { status: 400 });
    }

    if (!Number.isFinite(minEmployees) || minEmployees < 0 || minEmployees > 999) {
      return NextResponse.json({ ok: false, error: "Organico minimo non valido." }, { status: 400 });
    }

    const userId = await getAppUserIdByUsername(session.username);

    const { data, error } = await supabaseAdmin
      .from("pv_staff_settings")
      .upsert(
        {
          pv_id: pvId,
          min_employees: minEmployees,
          note,
          updated_by: userId,
        },
        { onConflict: "pv_id" }
      )
      .select("id, pv_id, min_employees, note, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore salvataggio impostazione organico.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
