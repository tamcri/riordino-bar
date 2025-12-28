import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

export async function GET(req: Request) {
  // stesso controllo "admin" che usi nelle altre route admin
  const cookie = req.headers.get("cookie") || "";
  const sessionCookie = cookie
    .split("; ")
    .find((c) => c.startsWith(COOKIE_NAME + "="))
    ?.split("=")[1];

  const session = parseSessionValue(sessionCookie);

  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("id, code, name")
    .order("code", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pvs: data ?? [] });
}
