import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { processReorderExcel } from "@/lib/excel/reorder";
import { Buffer } from "buffer";

export async function POST(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const sessionCookie = cookieHeader
    .split("; ")
    .find((c) => c.startsWith(COOKIE_NAME + "="))
    ?.split("=")[1];

  const session = parseSessionValue(sessionCookie);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });
  }

  const input = await file.arrayBuffer();

  // ⚠️ QUI la differenza: processReorderExcel ritorna { xlsx, rows }
  const { xlsx } = await processReorderExcel(input);

  // ✅ invio binario corretto (Buffer)
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="riordino.xlsx"`,
    },
  });
}

