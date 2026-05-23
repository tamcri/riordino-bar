import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const itemId = (url.searchParams.get("item_id") || "").trim();

    if (itemId && !isUuid(itemId)) {
      return NextResponse.json(
        { ok: false, error: "item_id non valido" },
        { status: 400 }
      );
    }

    const { data: presets, error: presetsError } = await supabaseAdmin
      .from("inventory_excel_presets")
      .select("id, name, slug, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (presetsError) {
      return NextResponse.json(
        { ok: false, error: presetsError.message },
        { status: 500 }
      );
    }

    let selectedPresetIds: string[] = [];

    if (itemId) {
      const { data: links, error: linksError } = await supabaseAdmin
        .from("inventory_excel_preset_items")
        .select("preset_id")
        .eq("item_id", itemId);

      if (linksError) {
        return NextResponse.json(
          { ok: false, error: linksError.message },
          { status: 500 }
        );
      }

      selectedPresetIds = (links || [])
        .map((r: any) => String(r.preset_id || "").trim())
        .filter(Boolean);
    }

    const selectedSet = new Set(selectedPresetIds);

    return NextResponse.json({
      ok: true,
      rows: (presets || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        is_active: p.is_active,
        selected: selectedSet.has(p.id),
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore caricamento preset Excel" },
      { status: 500 }
    );
  }
}