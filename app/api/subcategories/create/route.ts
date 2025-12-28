import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

  const body = await req.json().catch(() => null);
  const category_id = String(body?.category_id ?? "").trim();
  const name = String(body?.name ?? "").trim();
  if (!category_id) return NextResponse.json({ ok: false, error: "category_id obbligatorio" }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, error: "Nome obbligatorio" }, { status: 400 });

  const slug = slugify(name);

  const { data, error } = await supabaseAdmin
    .from("subcategories")
    .insert({ category_id, name, slug })
    .select("id, category_id, name, slug, is_active")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, row: data });
}
