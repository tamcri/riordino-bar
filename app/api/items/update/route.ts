import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Solo admin può modificare articoli" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "").trim();
  const description = body?.description;
  const is_active = body?.is_active;

  if (!id) return NextResponse.json({ ok: false, error: "ID mancante" }, { status: 400 });

  const patch: any = { updated_at: new Date().toISOString() };
  if (typeof description === "string") patch.description = description.trim();
  if (typeof is_active === "boolean") patch.is_active = is_active;

  const { error } = await supabaseAdmin.from("items").update(patch).eq("id", id);
  if (error) {
    console.error("[items/update] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
