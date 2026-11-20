import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolvePvAccess, requirePvAccess } from "@/lib/pvAccess";

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

    // Il profilo effettivo viene letto dal DB, non soltanto dal cookie.
    const access = await resolvePvAccess(session);
    if (access.profile === "cash_readonly") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
    }

    if (access.profile === "cash_operator") {
      // Gli operatori riservati possono consultare solo i fornitori attivi;
      // la ricerca non concede mai accesso a dati legati ad altri PV.
      if (session.role !== "punto_vendita" ||
          !session.userId || session.userId !== access.userId ||
          !access.assignedPvId) {
        return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
      }
      try {
        await requirePvAccess(access, access.assignedPvId, "read");
      } catch (error: any) {
        if (error?.message === "FORBIDDEN") {
          return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 403 });
        }
        throw error;
      }
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();

    // Per il profilo riservato limitiamo le ricerche e non accettiamo
    // caratteri che potrebbero alterare la sintassi del filtro PostgREST.
    if (access.profile === "cash_operator" &&
        (q.length < 2 || q.length > 80 || /[,()%*]/.test(q))) {
      return NextResponse.json(
        { ok: false, error: "Ricerca fornitore non valida" },
        { status: 400 }
      );
    }

    let query = supabaseAdmin
      .from("suppliers")
      .select("id, code, name, is_active")
      .order("name", { ascending: true })
      .limit(20);

    if (access.profile === "cash_operator") {
      query = query.eq("is_active", true);
    }

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