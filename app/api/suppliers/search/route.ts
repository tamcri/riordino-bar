import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const c = cookies();
    const sessionRaw = c.get(COOKIE_NAME)?.value || "";
    const session = parseSessionValue(sessionRaw);

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Non autenticato" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();

    let query = supabaseAdmin
      .from("suppliers")
      .select("id, code, name, is_active")
      .order("name", { ascending: true })
      .limit(20);

    if (q) {
      query = query.or(`code.ilike.%${q}%,name.ilike.%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      rows: data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore interno" },
      { status: 500 }
    );
  }
}