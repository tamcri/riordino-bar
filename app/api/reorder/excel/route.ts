import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Endpoint deprecato. Usa lo storico: /api/reorder/history/{reorderId}/excel (downloadUrl).",
    },
    { status: 410 }
  );
}

