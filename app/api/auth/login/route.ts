import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, makeSessionValue } from "@/lib/auth";

type AppRole = "admin" | "amministrativo" | "punto_vendita";

function normalizeRole(role: unknown): AppRole | null {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "admin") return "admin";
  if (r === "amministrativo") return "amministrativo";
  if (r === "punto_vendita") return "punto_vendita";
  return null;
}

function roleHome(role: AppRole): string {
  if (role === "admin") return "/admin";
  if (role === "amministrativo") return "/user"; // riordino
  return "/pv"; // punto vendita (inventario) - lo faremo dopo
}

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "Credenziali mancanti" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("username, password_hash, role")
    .eq("username", username)
    .limit(1);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ ok: false, error: "Utente non trovato" }, { status: 401 });

  const user = data[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return NextResponse.json({ ok: false, error: "Password errata" }, { status: 401 });

  const role = normalizeRole(user.role);
  if (!role) {
    return NextResponse.json(
      { ok: false, error: "Ruolo utente non valido. Contatta l'amministratore." },
      { status: 500 }
    );
  }

  const sessionValue = makeSessionValue({ username: user.username, role });

  const res = NextResponse.json({
    ok: true,
    role,
    redirectTo: roleHome(role), // ✅ utile per il client
  });

  res.cookies.set({
    name: COOKIE_NAME,
    value: sessionValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return res;
}

