import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Body = {
  pv_id?: string;
  fondo_cassa_iniziale?: number | null;
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
    const fondo_cassa_iniziale = toNumber(body.fondo_cassa_iniziale);

    if (!isUuid(pv_id)) {
      return NextResponse.json(
        { ok: false, error: "PV non valido" },
        { status: 400 }
      );
    }

    if (fondo_cassa_iniziale === null) {
      return NextResponse.json(
        { ok: false, error: "Fondo cassa iniziale obbligatorio" },
        { status: 400 }
      );
    }

    const payload = {
      pv_id,
      fondo_cassa_iniziale,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("pv_cash_fondo_iniziale")
      .upsert(payload, { onConflict: "pv_id" })
      .select("id, pv_id, fondo_cassa_iniziale, created_at, updated_at")
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
      { ok: false, error: e?.message || "Errore salvataggio fondo cassa iniziale" },
      { status: 500 }
    );
  }
}