import { NextResponse } from "next/server";
import { SHIFT_MANAGER_COOKIE_NAME } from "@/lib/work-shifts-manager";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SHIFT_MANAGER_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
