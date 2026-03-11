import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Body = {
  pv_id?: string;
  start_date?: string;
  saldo_iniziale?: number | null;
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json(
        { ok: false, error: "Non autorizzato" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as Body | null;

    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Body non valido" },
        { status: 400 }
      );
    }

    const pv_id = String(body.pv_id ?? "").trim();
    const start_date = String(body.start_date ?? "").trim();
    const saldo_iniziale = toNumber(body.saldo_iniziale);

    if (!isUuid(pv_id)) {
      return NextResponse.json(
        { ok: false, error: "PV non valido" },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      return NextResponse.json(
        { ok: false, error: "Data non valida (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    if (saldo_iniziale === null) {
      return NextResponse.json(
        { ok: false, error: "Saldo iniziale obbligatorio" },
        { status: 400 }
      );
    }

    const payload = {
      pv_id,
      start_date,
      saldo_iniziale,
    };

    const { data, error } = await supabaseAdmin
      .from("pv_cash_balance_start")
      .upsert(payload, { onConflict: "pv_id" })
      .select("id, pv_id, start_date, saldo_iniziale")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: data ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore salvataggio saldo iniziale" },
      { status: 500 }
    );
  }
}