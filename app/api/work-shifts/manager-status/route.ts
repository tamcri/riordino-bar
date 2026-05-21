import { NextResponse } from "next/server";
import { getCurrentSessionFromCookie, getShiftManagerStatusForSession } from "@/lib/work-shifts-manager";
import { getErrorMessage } from "@/lib/work-shifts";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getCurrentSessionFromCookie();
    if (!session || session.role !== "punto_vendita") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const status = await getShiftManagerStatusForSession(session);
    return NextResponse.json(status);
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e, "Errore server") }, { status: 500 });
  }
}
