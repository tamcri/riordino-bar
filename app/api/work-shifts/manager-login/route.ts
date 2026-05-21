import { NextResponse } from "next/server";
import {
  compareManagerCode,
  getCurrentSessionFromCookie,
  makeShiftManagerCookieValue,
  shiftManagerCookieOptions,
  validateManagerCode,
} from "@/lib/work-shifts-manager";
import { asRecord, getErrorMessage } from "@/lib/work-shifts";
import { getPvIdForSession } from "@/lib/pvLookup";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await getCurrentSessionFromCookie();
    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const body = asRecord(await req.json().catch(() => null));
    const validation = validateManagerCode(body.code);
    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }

    const pvLookup = await getPvIdForSession(session);
    const pv_id = pvLookup.pv_id;
    if (!pv_id) {
      return NextResponse.json({ ok: false, error: "Utente PV senza pv_id assegnato" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("pv_shift_settings")
      .select("pin_hash, enabled")
      .eq("pv_id", pv_id)
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data?.pin_hash) {
      return NextResponse.json(
        { ok: false, error: "Codice responsabile non configurato. Contatta l'amministratore." },
        { status: 403 }
      );
    }
    if (data.enabled === false) {
      return NextResponse.json(
        { ok: false, error: "Accesso turni momentaneamente bloccato. Contatta l'amministratore." },
        { status: 403 }
      );
    }

    const matches = await compareManagerCode(validation.code, String(data.pin_hash));
    if (!matches) {
      return NextResponse.json({ ok: false, error: "Codice responsabile non corretto." }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true, unlocked: true, pv_id, warning: pvLookup.warning ?? null });
    res.cookies.set(
      "rb_shift_manager",
      makeShiftManagerCookieValue({ username: session.username, pv_id }),
      shiftManagerCookieOptions()
    );

    return res;
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}
