import { NextResponse } from "next/server";
import crypto from "crypto";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { processReorderExcel } from "@/lib/excel/reorder";
import { uploadResult } from "@/lib/storage";

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
  const { xlsx, rows } = await processReorderExcel(input);

  const jobId = crypto.randomUUID();
  const basePath = `${session.username}/${jobId}`;

  await uploadResult(
    `${basePath}/riordino.xlsx`,
    xlsx,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  return NextResponse.json({
    ok: true,
    jobId,
    preview: rows.slice(0, 20),
    totalRows: rows.length,
  });
}

