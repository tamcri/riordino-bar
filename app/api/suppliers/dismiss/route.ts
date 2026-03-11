import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Solo admin può dismettere fornitori" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const id = String(body?.id ?? "").trim();

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "ID fornitore mancante" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("suppliers")
      .update({ is_active: false })
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore dismissione fornitore" },
      { status: 500 }
    );
  }
}