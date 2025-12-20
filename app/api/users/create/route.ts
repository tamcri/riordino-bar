import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

type CreateUserBody = {
  username?: string;
  password?: string;
  role?: "amministrativo" | "punto_vendita";
};

function normalizeRole(role?: string): "amministrativo" | "punto_vendita" | null {
  if (!role) return null;
  const r = String(role).trim().toLowerCase();
  if (r === "amministrativo") return "amministrativo";
  if (r === "punto_vendita") return "punto_vendita";
  return null;
}

export async function POST(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const sessionCookie = cookie
    .split("; ")
    .find((c) => c.startsWith(COOKIE_NAME + "="))
    ?.split("=")[1];

  const session = parseSessionValue(sessionCookie);

  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = (await req.json()) as CreateUserBody;
  const username = body.username?.trim();
  const password = body.password;
  const role = normalizeRole(body.role);

  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "Username e password obbligatori" },
      { status: 400 }
    );
  }

  if (!role) {
    return NextResponse.json(
      { ok: false, error: "Ruolo non valido. Usa: amministrativo o punto_vendita." },
      { status: 400 }
    );
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { error } = await supabaseAdmin.from("app_users").insert({
    username,
    password_hash,
    role, // ✅ ora lo salviamo davvero
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

