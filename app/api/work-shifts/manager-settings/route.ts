import { NextResponse } from "next/server";
import { getCurrentSessionFromCookie, hashManagerCode, validateManagerCode } from "@/lib/work-shifts-manager";
import { getAppUserIdByUsername } from "@/lib/appUsers";
import { asRecord, getErrorMessage, isUuid } from "@/lib/work-shifts";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type SettingDbRow = {
  id?: unknown;
  pv_id?: unknown;
  pin_hash?: unknown;
  enabled?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  pvs?: { code?: unknown; name?: unknown } | null;
};

function settingSelect() {
  return `
    id,
    pv_id,
    pin_hash,
    enabled,
    created_at,
    updated_at,
    pvs:pvs(code, name)
  `;
}

function normalizeSetting(row: SettingDbRow) {
  return {
    id: String(row?.id ?? ""),
    pv_id: String(row?.pv_id ?? ""),
    configured: Boolean(row?.pin_hash),
    enabled: row?.enabled !== false,
    created_at: row?.created_at ? String(row.created_at) : null,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
    pv_code: row?.pvs?.code ? String(row.pvs.code) : null,
    pv_name: row?.pvs?.name ? String(row.pvs.name) : null,
  };
}

async function requireAdmin() {
  const session = await getCurrentSessionFromCookie();
  if (!session || !["admin", "amministrativo"].includes(session.role)) return null;
  return session;
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });

    const url = new URL(req.url);
    const pvIdParam = String(url.searchParams.get("pv_id") ?? "").trim();

    let q = supabaseAdmin
      .from("pv_shift_settings")
      .select(settingSelect())
      .order("updated_at", { ascending: false })
      .limit(1000);

    if (pvIdParam) {
      if (!isUuid(pvIdParam)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
      q = q.eq("pv_id", pvIdParam);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, rows: (data ?? []).map((row) => normalizeSetting(row as unknown as SettingDbRow)) });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });

    const body = asRecord(await req.json().catch(() => null));
    const pv_id = String(body.pv_id ?? "").trim();
    if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });

    const update: Record<string, unknown> = {
      pv_id,
      updated_by: await getAppUserIdByUsername(session.username),
    };

    if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
      update.enabled = body.enabled !== false;
    }

    if (Object.prototype.hasOwnProperty.call(body, "code")) {
      const rawCode = String(body.code ?? "");
      if (rawCode.trim()) {
        const validation = validateManagerCode(rawCode);
        if (!validation.ok) return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
        update.pin_hash = await hashManagerCode(validation.code);
      }
    }

    if (!Object.prototype.hasOwnProperty.call(update, "enabled") && !Object.prototype.hasOwnProperty.call(update, "pin_hash")) {
      return NextResponse.json({ ok: false, error: "Inserisci un codice o modifica lo stato accesso." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("pv_shift_settings")
      .upsert(update, { onConflict: "pv_id" })
      .select(settingSelect())
      .single();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, row: normalizeSetting(data as unknown as SettingDbRow) });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}
