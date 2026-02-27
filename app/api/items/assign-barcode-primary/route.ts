// app/api/items/assign-barcode-primary/route.ts
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

/**
 * ✅ Assegna un BARCODE come "principale" (items.barcode) ad un articolo esistente.
 * - Accesso: qualsiasi utente loggato (admin / amministrativo / punto_vendita)
 * - Anti-duplicato:
 *   - se esiste tabella item_barcodes: blocca se barcode già associato ad un item diverso
 *   - fallback legacy: blocca se items.barcode è già uguale su un item diverso
 * - Scrive SEMPRE items.barcode = barcode (overwrite) e, se possibile, mantiene coerente item_barcodes.
 */
export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const item_id = String(body?.item_id ?? "").trim();
    const barcode = String(body?.barcode ?? "").trim();

    if (!isUuid(item_id)) {
      return NextResponse.json({ ok: false, error: "Articolo non valido" }, { status: 400 });
    }

    if (!isBarcodeLike(barcode)) {
      return NextResponse.json({ ok: false, error: "Barcode non valido" }, { status: 400 });
    }

    // 1) Leggi item
    const { data: itemRow, error: itemErr } = await supabaseAdmin
      .from("items")
      .select(
        "id, code, description, barcode, is_active, category_id, subcategory_id, um, peso_kg, prezzo_vendita_eur, volume_ml_per_unit"
      )
      .eq("id", item_id)
      .maybeSingle();

    if (itemErr) {
      return NextResponse.json({ ok: false, error: itemErr.message }, { status: 500 });
    }

    if (!itemRow) {
      return NextResponse.json({ ok: false, error: "Articolo non trovato" }, { status: 404 });
    }

    // 2) Anti-duplicato su item_barcodes (se tabella esiste)
    let itemBarcodesAvailable = true;
    {
      const { data: existingInMap, error: exMapErr } = await supabaseAdmin
        .from("item_barcodes")
        .select("item_id")
        .eq("barcode", barcode)
        .maybeSingle();

      if (exMapErr) {
        if (isMissingRelationError(exMapErr)) {
          itemBarcodesAvailable = false;
        } else {
          return NextResponse.json({ ok: false, error: exMapErr.message }, { status: 500 });
        }
      } else if (existingInMap?.item_id) {
        const ownerId = String(existingInMap.item_id || "").trim();
        if (ownerId && ownerId !== item_id) {
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
    }

    // 2b) Fallback legacy: items.barcode (se già assegnato ad un altro item)
    {
      const { data: existingLegacy, error: exLegacyErr } = await supabaseAdmin
        .from("items")
        .select("id, code, description")
        .eq("barcode", barcode)
        .neq("id", item_id)
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

    // 3) Se tabella item_barcodes esiste, inserisco mapping (se non già presente per questo item)
    if (itemBarcodesAvailable) {
      const { data: sameMap, error: sameMapErr } = await supabaseAdmin
        .from("item_barcodes")
        .select("item_id")
        .eq("barcode", barcode)
        .eq("item_id", item_id)
        .maybeSingle();

      if (sameMapErr && !isMissingRelationError(sameMapErr)) {
        return NextResponse.json({ ok: false, error: sameMapErr.message }, { status: 500 });
      }

      if (!sameMap?.item_id) {
        const { error: insErr } = await supabaseAdmin.from("item_barcodes").insert({
          item_id,
          barcode,
        });

        if (insErr) {
          const msg = String(insErr.message || "").toLowerCase();
          if (msg.includes("duplicate") || msg.includes("unique")) {
            // ok: già presente
          } else {
            return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
          }
        }
      }
    }

    // 4) Aggiorno SEMPRE il barcode principale
    const { error: updErr } = await supabaseAdmin
      .from("items")
      .update({ barcode, updated_at: new Date().toISOString() })
      .eq("id", item_id);

    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    const updated = { ...itemRow, barcode };
    return NextResponse.json({ ok: true, row: updated });
  } catch (e: any) {
    console.error("[items/assign-barcode-primary] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore assegnazione barcode" },
      { status: 500 }
    );
  }
}