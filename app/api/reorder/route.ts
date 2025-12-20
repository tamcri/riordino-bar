import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { processReorderExcel } from "@/lib/excel/reorder";
import { Buffer } from "buffer";

function sanitizeWeeks(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 4;
  const wi = Math.trunc(n);
  if (wi < 1) return 1;
  if (wi > 4) return 4;
  return wi;
}

export async function POST(req: Request) {
  // --- AUTH (come avevi già) ---
  const cookieHeader = req.headers.get("cookie") || "";
  const sessionCookie = cookieHeader
    .split("; ")
    .find((c) => c.startsWith(COOKIE_NAME + "="))
    ?.split("=")[1];

  const session = parseSessionValue(sessionCookie);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  // --- FORM DATA ---
  const formData = await req.formData();

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "File Excel mancante" }, { status: 400 });
  }

  const weeks = sanitizeWeeks(formData.get("weeks"));

  const input = await file.arrayBuffer();

  // ✅ ora weeks guida il calcolo (default 4)
  const { xlsx } = await processReorderExcel(input);


  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="riordino.xlsx"`,
    },
  });
}


