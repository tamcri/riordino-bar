import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isPvOrderShippingStatus, isUuid } from "@/lib/pv-orders";

export const runtime = "nodejs";

type RouteContext = {
  params: {
    id: string;
  };
};

type Body = {
  shipping_status?: string;
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

    const shipping_status = String(body.shipping_status ?? "").trim().toUpperCase();
    if (!isPvOrderShippingStatus(shipping_status)) {
      return NextResponse.json(
        { ok: false, error: "Stato spedizione non valido" },
        { status: 400 }
      );
    }

    const { data: header, error: headerError } = await supabaseAdmin
      .from("pv_order_headers")
      .select("id")
      .eq("id", orderId)
      .maybeSingle();

    if (headerError) {
      return NextResponse.json({ ok: false, error: headerError.message }, { status: 500 });
    }

    if (!header) {
      return NextResponse.json({ ok: false, error: "Ordine non trovato" }, { status: 404 });
    }

    const { error: updateError } = await supabaseAdmin
      .from("pv_order_headers")
      .update({
        shipping_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      shipping_status,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore server" },
      { status: 500 }
    );
  }
}