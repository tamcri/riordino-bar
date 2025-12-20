import { NextResponse } from "next/server";
import crypto from "crypto";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { processReorderExcel } from "@/lib/excel/reorder";
import { uploadResult } from "@/lib/storage";

function sanitizeWeeks(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 4;
  const wi = Math.trunc(n);
  if (wi < 1) return 1;
  if (wi > 4) return 4;
  return wi;
}

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

  // ✅ NEW: weeks da dropdown (default 4)
  const weeks = sanitizeWeeks(formData.get("weeks"));

  const input = await file.arrayBuffer();
  const { xlsx, rows } = await processReorderExcel(input, weeks);

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

    // opzionale ma utile: ti torna indietro il periodo usato (così lo mostri in UI senza dubbi)
    weeks,
  });
}


