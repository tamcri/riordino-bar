import { NextResponse } from "next/server";
import crypto from "crypto";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { processReorderGVExcel } from "@/lib/excel/reorder_gv";
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
  try {
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

    const weeks = sanitizeWeeks(formData.get("weeks"));
    const input = await file.arrayBuffer();

    const { xlsx, rows } = await processReorderGVExcel(input, weeks);

    const jobId = crypto.randomUUID();
    const basePath = `${session.username}/${jobId}`;

    await uploadResult(
      `${basePath}/riordino_gv.xlsx`,
      xlsx,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return NextResponse.json({
      ok: true,
      jobId,
      preview: rows.slice(0, 20),
      totalRows: rows.length,
      weeks,
    });
  } catch (err: any) {
    console.error("[GV start] ERROR:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Errore interno" },
      { status: 500 }
    );
  }
}


