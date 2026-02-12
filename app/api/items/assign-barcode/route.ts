// app/api/items/assign-barcode/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function isBarcodeLike(v: string) {
  return /^\d{6,14}$/.test(v.trim());
}

function isMissingRelationError(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("relation") && msg.includes("does not exist");
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Solo admin può assegnare barcode" },
        { status: 401 }
      );
    }

    const body = await req.json();

    const category_id = String(body?.category_id ?? "").trim();
    const code = String(body?.code ?? "").trim();
    const barcode = String(body?.barcode ?? "").trim();

    if (!isUuid(category_id)) {
      return NextResponse.json({ ok: false, error: "Categoria non valida" }, { status: 400 });
    }

    if (!code) {
      return NextResponse.json({ ok: false, error: "Codice articolo obbligatorio" }, { status: 400 });
    }

    if (!isBarcodeLike(barcode)) {
      return NextResponse.json({ ok: false, error: "Barcode non valido" }, { status: 400 });
    }

    // 1) Trova articolo per codice nella categoria selezionata
    const { data: itemRow, error: itemErr } = await supabaseAdmin
      .from("items")
      .select("id, code, description, barcode, category_id")
      .eq("category_id", category_id)
      .eq("code", code)
      .maybeSingle();

    if (itemErr) {
      return NextResponse.json({ ok: false, error: itemErr.message }, { status: 500 });
    }

    if (!itemRow) {
      return NextResponse.json(
        { ok: false, error: "Articolo non trovato nella categoria selezionata" },
        { status: 404 }
      );
    }

    // 2) Anti-duplicato principale: item_barcodes (se esiste)
    let itemBarcodesAvailable = true;

    {
      const { data: existingInMap, error: exMapErr } = await supabaseAdmin
        .from("item_barcodes")
        .select("item_id")
        .eq("barcode", barcode)
        .maybeSingle();

      if (exMapErr) {
        if (isMissingRelationError(exMapErr)) {
          itemBarcodesAvailable = false; // fallback a legacy
        } else {
          return NextResponse.json({ ok: false, error: exMapErr.message }, { status: 500 });
        }
      } else if (existingInMap?.item_id) {
        const ownerId = String(existingInMap.item_id || "").trim();

        // Se è già assegnato a questo stesso articolo → messaggio “soft”
        if (ownerId && ownerId === String(itemRow.id)) {
          return NextResponse.json(
            { ok: false, error: "Questo barcode è già associato a questo articolo." },
            { status: 400 }
          );
        }

        // Recupero info articolo “owner” per messaggio utile
        const { data: ownerItem } = await supabaseAdmin
          .from("items")
          .select("code, description")
          .eq("id", ownerId)
          .maybeSingle();

        const ownerLabel = ownerItem
          ? `${ownerItem.code}${ownerItem.description ? " - " + ownerItem.description : ""}`
          : "un altro articolo";

        return NextResponse.json(
          { ok: false, error: `Barcode già assegnato all'articolo ${ownerLabel}` },
          { status: 400 }
        );
      }
    }

    // 2b) Fallback legacy SOLO se item_barcodes non esiste
    if (!itemBarcodesAvailable) {
      const { data: existingLegacy, error: exLegacyErr } = await supabaseAdmin
        .from("items")
        .select("id, code, description")
        .eq("barcode", barcode)
        .maybeSingle();

      if (exLegacyErr) {
        return NextResponse.json({ ok: false, error: exLegacyErr.message }, { status: 500 });
      }

      if (existingLegacy) {
        return NextResponse.json(
          {
            ok: false,
            error: `Barcode già assegnato all'articolo ${existingLegacy.code}${
              existingLegacy.description ? " - " + existingLegacy.description : ""
            }`,
          },
          { status: 400 }
        );
      }
    }

    // 3) Inserisci mapping (barcode multipli per articolo) se tabella esiste
    if (itemBarcodesAvailable) {
      const { error: insErr } = await supabaseAdmin.from("item_barcodes").insert({
        item_id: itemRow.id,
        barcode,
      });

      if (insErr) {
        const msg = String(insErr.message || "").toLowerCase();
        if (msg.includes("duplicate") || msg.includes("unique")) {
          return NextResponse.json({ ok: false, error: "Barcode già presente (duplicato)." }, { status: 400 });
        }
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      }
    } else {
      // Se item_barcodes non esiste ancora, uso solo il campo legacy
      const { error: updLegacyErr } = await supabaseAdmin
        .from("items")
        .update({ barcode, updated_at: new Date().toISOString() })
        .eq("id", itemRow.id);

      if (updLegacyErr) {
        return NextResponse.json({ ok: false, error: updLegacyErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    // 4) Retro-compat: se items.barcode è vuoto, lo imposto col primo barcode
    const currentLegacy = String(itemRow.barcode || "").trim();
    if (!currentLegacy) {
      const { error: updErr } = await supabaseAdmin
        .from("items")
        .update({ barcode, updated_at: new Date().toISOString() })
        .eq("id", itemRow.id);

      if (updErr) {
        return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[items/assign-barcode] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore assegnazione barcode" },
      { status: 500 }
    );
  }
}



