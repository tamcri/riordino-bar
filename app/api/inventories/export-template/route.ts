import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[àá]/g, "a")
    .replace(/[èé]/g, "e")
    .replace(/[ìí]/g, "i")
    .replace(/[òó]/g, "o")
    .replace(/[ùú]/g, "u")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function todayFileDate() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}_${mm}_${yyyy}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const label = String(url.searchParams.get("label") || "").trim();

    if (!label) {
      return NextResponse.json(
        { ok: false, error: "label mancante" },
        { status: 400 }
      );
    }

    const slug = slugify(label);

    const { data: preset, error: presetError } = await supabaseAdmin
      .from("inventory_excel_presets")
      .select("id, name, slug")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (presetError) {
      return NextResponse.json(
        { ok: false, error: presetError.message },
        { status: 500 }
      );
    }

    if (!preset?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: `Preset Excel non trovato per "${label}".`,
        },
        { status: 404 }
      );
    }

    const { data: rows, error: rowsError } = await supabaseAdmin
      .from("inventory_excel_preset_items")
      .select(`
        item_id,
        items:item_id (
          id,
          code,
          description,
          is_active,
          um,
          volume_ml_per_unit
        )
      `)
      .eq("preset_id", preset.id);

    if (rowsError) {
      return NextResponse.json(
        { ok: false, error: rowsError.message },
        { status: 500 }
      );
    }

    const items = (rows || [])
      .map((r: any) => r.items)
      .filter((it: any) => it && it.is_active)
      .sort((a: any, b: any) =>
        String(a.code || "").localeCompare(String(b.code || ""), "it")
      );

    if (items.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Nessun articolo attivo associato al preset "${label}".`,
        },
        { status: 404 }
      );
    }

    const excelRows = items.map((it: any) => ({
      Codice: String(it.code || ""),
      Descrizione: String(it.description || ""),
      PZ: "",
      ML: "",
      GR: "",
    }));

    const ws = XLSX.utils.json_to_sheet(excelRows, {
      header: ["Codice", "Descrizione", "PZ", "ML", "GR"],
    });

    ws["!cols"] = [
      { wch: 18 },
      { wch: 60 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");

    const buffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    });

    const fileName = `inventario_${slug}_${todayFileDate()}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore export modello inventario" },
      { status: 500 }
    );
  }
}