import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST() {
  const adminUsername = process.env.ADMIN_USERNAME!;
  const adminPassword = process.env.ADMIN_PASSWORD!;

  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("id")
    .eq("role", "admin")
    .limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (data && data.length > 0) {
    return NextResponse.json({ ok: true, created: false });
  }

  const password_hash = await bcrypt.hash(adminPassword, 10);

  const { error: insertError } = await supabaseAdmin.from("app_users").insert({
    username: adminUsername,
    password_hash,
    role: "admin",
  });

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created: true });
}
