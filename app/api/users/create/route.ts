import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

type CreateUserBody = {
  username?: string;
  password?: string;
  role?: "amministrativo" | "punto_vendita";
  pv_id?: string | null; // ✅ nuovo
};

function normalizeRole(role?: string): "amministrativo" | "punto_vendita" | null {
  if (!role) return null;
  const r = String(role).trim().toLowerCase();
  if (r === "amministrativo") return "amministrativo";
  if (r === "punto_vendita") return "punto_vendita";
  return null;
}

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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

  // pv_id: opzionale, ma se presente deve essere uuid valido
  const pv_id_raw = body.pv_id ?? null;
  const pv_id = pv_id_raw === null || pv_id_raw === "" ? null : pv_id_raw;

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

  // Se role è punto_vendita e pv_id è valorizzato, lo validiamo contro pvs
  if (role === "punto_vendita" && pv_id !== null) {
    if (!isUuid(pv_id)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }

    const { data: pvRow, error: pvErr } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("id", pv_id)
      .maybeSingle();

    if (pvErr) {
      return NextResponse.json({ ok: false, error: pvErr.message }, { status: 500 });
    }
    if (!pvRow) {
      return NextResponse.json({ ok: false, error: "PV non trovato" }, { status: 400 });
    }
  }

  const password_hash = await bcrypt.hash(password, 10);

  const insertPayload: any = {
    username,
    password_hash,
    role, // ✅ già lo salvavi
  };

  // pv_id si salva solo se role = punto_vendita (altrimenti lo lasciamo null)
  if (role === "punto_vendita") {
    insertPayload.pv_id = pv_id; // può essere null
  }

  const { error } = await supabaseAdmin.from("app_users").insert(insertPayload);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}


