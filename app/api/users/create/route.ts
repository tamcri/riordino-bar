import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireRole } from "@/lib/auth";
import { resolvePvAccess } from "@/lib/pvAccess";

type CreateUserBody = {
  username?: string;
  password?: string;
  role?: "amministrativo" | "punto_vendita";
  pv_id?: string | null;
  access_profile?: string;
};

function normalizeRole(role: unknown): "amministrativo" | "punto_vendita" | null {
  const value = String(role ?? "").trim().toLowerCase();
  return value === "amministrativo" || value === "punto_vendita" ? value : null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const session = await requireRole(["admin"]);
    const access = await resolvePvAccess(session);
    if (access.profile !== "standard") throw new Error("FORBIDDEN");
    const body = (await req.json().catch(() => null)) as CreateUserBody | null;
    if (!body) return NextResponse.json({ ok: false, error: "Dati non validi" }, { status: 400 });
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = body.password;
    const role = normalizeRole(body.role);
    const pvId = body.pv_id === "" || body.pv_id == null ? null : body.pv_id;

    if (!username || typeof password !== "string" || !password) {
      return NextResponse.json({ ok: false, error: "Username e password obbligatori" }, { status: 400 });
    }
    if (!role) {
      return NextResponse.json({ ok: false, error: "Ruolo non valido. Usa: amministrativo o punto_vendita." }, { status: 400 });
    }
    // Questa API crea solo account standard. Gli account riservati richiedono
    // una procedura dedicata con assegnazione dei permessi.
    if (body.access_profile !== undefined && body.access_profile !== "standard") {
      throw new Error("FORBIDDEN");
    }
    if (role === "punto_vendita" && pvId !== null) {
      if (typeof pvId !== "string" || !UUID.test(pvId)) {
        return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
      }
      const { data: pv, error } = await supabaseAdmin
        .from("pvs")
        .select("id, is_reserved")
        .eq("id", pvId)
        .maybeSingle();
      if (error) throw error;
      if (!pv) return NextResponse.json({ ok: false, error: "PV non trovato" }, { status: 400 });
      if (pv.is_reserved) throw new Error("FORBIDDEN");
    }

    const password_hash = await bcrypt.hash(password, 10);
    const payload: { username: string; password_hash: string; role: string; access_profile: string; pv_id?: string | null } = {
      username, password_hash, role, access_profile: "standard",
    };
    if (role === "punto_vendita") payload.pv_id = pvId;
    const { error } = await supabaseAdmin.from("app_users").insert(payload);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore interno";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
