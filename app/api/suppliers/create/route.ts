import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(
      cookies().get(COOKIE_NAME)?.value ?? null
    );

    if (!session || session.role !== "admin") {
      return NextResponse.json(
        {
          ok: false,
          error: "Solo admin può inserire fornitori",
        },
        { status: 401 }
      );
    }

    const body = await req.json();

    const code = String(body?.code ?? "").trim();
    const name = String(body?.name ?? "").trim();

    if (!code) {
      return NextResponse.json(
        {
          ok: false,
          error: "Inserisci il codice del fornitore",
        },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        {
          ok: false,
          error: "Inserisci la ragione sociale",
        },
        { status: 400 }
      );
    }

    const { data: existing, error: existingError } =
      await supabaseAdmin
        .from("suppliers")
        .select("id, code, name, is_active")
        .eq("code", code)
        .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          error: `Esiste già un fornitore con il codice ${code}`,
        },
        { status: 409 }
      );
    }

    const { data: supplier, error } = await supabaseAdmin
      .from("suppliers")
      .insert({
        code,
        name,
      })
      .select("id, code, name, is_active")
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      supplier,
    });
  } catch (e: any) {
    console.error("[suppliers/create]", e);

    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Errore inserimento fornitore",
      },
      { status: 500 }
    );
  }
}