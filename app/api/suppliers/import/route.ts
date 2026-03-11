import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

export async function POST(req: Request) {

  try {

    const session = parseSessionValue(
      cookies().get(COOKIE_NAME)?.value ?? null
    );

    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Solo admin può importare fornitori" },
        { status: 401 }
      );
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "File mancante" },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const ws = wb.worksheets[0];

    if (!ws) {
      return NextResponse.json(
        { ok: false, error: "Foglio Excel non trovato" },
        { status: 400 }
      );
    }

    let inserted = 0;
    let updated = 0;

    for (let r = 2; r <= ws.rowCount; r++) {

      const row = ws.getRow(r);

      const code = String(row.getCell(1).text ?? "").trim();
      const name = String(row.getCell(2).text ?? "").trim();

      if (!code || !name) continue;

      const { data: existing } = await supabaseAdmin
        .from("suppliers")
        .select("id")
        .eq("code", code)
        .maybeSingle();

      if (!existing) {

        const { error } = await supabaseAdmin
          .from("suppliers")
          .insert({
            code,
            name
          });

        if (error) throw error;

        inserted++;

      } else {

        const { error } = await supabaseAdmin
          .from("suppliers")
          .update({
            name
          })
          .eq("id", existing.id);

        if (error) throw error;

        updated++;

      }

    }

    return NextResponse.json({
      ok: true,
      inserted,
      updated
    });

  } catch (e: any) {

    console.error("[suppliers/import]", e);

    return NextResponse.json(
      { ok: false, error: e?.message || "Errore import fornitori" },
      { status: 500 }
    );

  }

}