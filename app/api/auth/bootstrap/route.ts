import { NextResponse } from "next/server";

// Endpoint disabilitato in produzione: non esporre operazioni privilegiate o di debug.
export async function POST() {
  return NextResponse.json({ ok: false, error: "Endpoint non disponibile" }, { status: 404 });
}
