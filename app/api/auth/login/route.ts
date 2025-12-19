import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, makeSessionValue } from "@/lib/auth";

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
  if (!data || data.length === 0) return NextResponse.json({ ok: false, error: "Utente non trovato" }, { status: 401 });

  const user = data[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return NextResponse.json({ ok: false, error: "Password errata" }, { status: 401 });

  const sessionValue = makeSessionValue({ username: user.username, role: user.role });

  const res = NextResponse.json({ ok: true, role: user.role });
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
