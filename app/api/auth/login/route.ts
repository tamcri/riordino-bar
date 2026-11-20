import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, makeSessionValue } from "@/lib/auth";

type AppRole = "admin" | "amministrativo" | "punto_vendita";
type AccessProfile = "standard" | "cash_readonly" | "cash_operator";

function normalizeRole(role: unknown): AppRole | null {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "admin" || r === "amministrativo" || r === "punto_vendita") return r;
  return null;
}

function normalizeProfile(profile: unknown): AccessProfile | null {
  if (profile === "standard" || profile === "cash_readonly" || profile === "cash_operator") {
    return profile;
  }
  return null;
}

function roleHome(role: AppRole, profile: AccessProfile): string {
  if (profile === "cash_operator") return "/pv/riepilogo-incassato";
  // Pagina dedicata da realizzare e proteggere prima di attivare il profilo.
  if (profile === "cash_readonly") return "/reserved-cash";
  if (role === "admin") return "/admin";
  if (role === "amministrativo") return "/user";
  return "/pv/inventario";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const username = String(body?.username ?? "").trim();
    const password = body?.password;
    if (!username || typeof password !== "string" || !password) {
      return NextResponse.json({ ok: false, error: "Credenziali mancanti" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("app_users")
      .select("id, username, password_hash, role, access_profile")
      .eq("username", username)
      .limit(1);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data?.length) {
      return NextResponse.json({ ok: false, error: "Utente non trovato" }, { status: 401 });
    }

    const user = data[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return NextResponse.json({ ok: false, error: "Password errata" }, { status: 401 });

    const role = normalizeRole(user.role);
    const profile = normalizeProfile(user.access_profile);
    if (!role || !profile) {
      return NextResponse.json(
        { ok: false, error: "Profilo utente non valido. Contatta l'amministratore." },
        { status: 403 }
      );
    }
    if (
      (profile === "cash_operator" && role !== "punto_vendita") ||
      (profile === "cash_readonly" && role !== "admin")
    ) {
      return NextResponse.json(
        { ok: false, error: "Profilo e ruolo non compatibili." },
        { status: 403 }
      );
    }

    const sessionValue = makeSessionValue({ username: user.username, role, userId: user.id, accessProfile: profile });
    const res = NextResponse.json({ ok: true, role, redirectTo: roleHome(role, profile) });
    res.cookies.set({
      name: COOKIE_NAME,
      value: sessionValue,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "Errore durante l'accesso" }, { status: 500 });
  }
}
