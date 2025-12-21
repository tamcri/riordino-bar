export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // ✅ solo admin + amministrativo
    await requireRole(["admin", "amministrativo"]);

    const { data: reorder, error: rErr } = await supabaseAdmin
      .from("reorders")
      .select("id, type, export_path, pv_code")
      .eq("id", params.id)
      .single();

    if (rErr || !reorder) {
      return NextResponse.json(
        { error: "Storico non trovato" },
        { status: 404 }
      );
    }

    const { data: file, error: dErr } = await supabaseAdmin.storage
      .from("reorders")
      .download(reorder.export_path);

    if (dErr || !file) {
      return NextResponse.json(
        { error: "File non disponibile" },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safePv = (reorder.pv_code || "PV")
      .toString()
      .replace(/[^A-Za-z0-9_-]+/g, "_");

    const filename = `RIORDINO_${reorder.type}_${safePv}_${reorder.id}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Non autenticato" },
        { status: 401 }
      );
    }

    if (e?.message === "FORBIDDEN") {
      return NextResponse.json(
        { error: "Non autorizzato" },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "Errore interno" },
      { status: 500 }
    );
  }
}

