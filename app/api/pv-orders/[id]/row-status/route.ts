import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isPvOrderRowStatus, isUuid } from "@/lib/pv-orders";

export const runtime = "nodejs";

type RouteContext = {
  params: {
    id: string;
  };
};

type Body = {
  row_id?: string;
  row_status?: string;
};

export async function POST(req: Request, context: RouteContext) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const orderId = String(context.params?.id ?? "").trim();
    if (!isUuid(orderId)) {
      return NextResponse.json({ ok: false, error: "ID ordine non valido" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });
    }

    const row_id = String(body.row_id ?? "").trim();
    if (!isUuid(row_id)) {
      return NextResponse.json({ ok: false, error: "row_id non valido" }, { status: 400 });
    }

    const row_status = String(body.row_status ?? "").trim().toUpperCase();
    if (!isPvOrderRowStatus(row_status)) {
      return NextResponse.json({ ok: false, error: "Stato riga non valido" }, { status: 400 });
    }

    const { data: row, error: rowError } = await supabaseAdmin
      .from("pv_order_rows")
      .select("id, order_id")
      .eq("id", row_id)
      .maybeSingle();

    if (rowError) {
      return NextResponse.json({ ok: false, error: rowError.message }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json({ ok: false, error: "Riga non trovata" }, { status: 404 });
    }

    if (String((row as any).order_id) !== orderId) {
      return NextResponse.json(
        { ok: false, error: "La riga non appartiene all'ordine indicato" },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("pv_order_rows")
      .update({
        row_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row_id);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    const { error: touchHeaderError } = await supabaseAdmin
      .from("pv_order_headers")
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (touchHeaderError) {
      return NextResponse.json(
        { ok: false, error: touchHeaderError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row_id,
      order_id: orderId,
      row_status,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}