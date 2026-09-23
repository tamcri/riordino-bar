import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Body = {
  summary_id?: string;
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(
      cookies().get(COOKIE_NAME)?.value ?? null
    );

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Non autorizzato",
        },
        {
          status: 401,
        }
      );
    }

    const body = (await req.json().catch(() => null)) as Body | null;

    if (!body) {
      return NextResponse.json(
        {
          ok: false,
          error: "Body non valido",
        },
        {
          status: 400,
        }
      );
    }

    const summaryId = String(body.summary_id ?? "").trim();

    if (!isUuid(summaryId)) {
      return NextResponse.json(
        {
          ok: false,
          error: "ID riepilogo non valido",
        },
        {
          status: 400,
        }
      );
    }

    const { data: summary, error: summaryErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select("id, pv_id, data")
      .eq("id", summaryId)
      .maybeSingle();

    if (summaryErr) {
      return NextResponse.json(
        {
          ok: false,
          error: summaryErr.message,
        },
        {
          status: 500,
        }
      );
    }

    if (!summary) {
      return NextResponse.json(
        {
          ok: false,
          error: "Riepilogo non trovato",
        },
        {
          status: 404,
        }
      );
    }

    const { error: deleteErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .delete()
      .eq("id", summaryId);

    if (deleteErr) {
      return NextResponse.json(
        {
          ok: false,
          error: deleteErr.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      ok: true,
      id: summaryId,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Errore eliminazione riepilogo",
      },
      {
        status: 500,
      }
    );
  }
}