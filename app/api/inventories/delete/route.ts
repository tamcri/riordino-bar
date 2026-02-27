// app/api/inventories/delete/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function isIsoDate(v: string | null) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

// ✅ interpreta "" / "null" come NULL (Rapido: categoria = Nessuna/Tutte)
function normNullParam(v: string | null): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
}

export async function DELETE(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  // ✅ per sicurezza: elimina SOLO admin
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  // ✅ NUOVO: elimina per header_id (consigliato)
  const header_id = (url.searchParams.get("header_id") || url.searchParams.get("id") || "").trim();

  // ✅ legacy params (vecchia UI)
  const pv_id = (url.searchParams.get("pv_id") || "").trim();
  const category_id = normNullParam(url.searchParams.get("category_id"));
  const subcategory_id = normNullParam(url.searchParams.get("subcategory_id"));
  const inventory_date = (url.searchParams.get("inventory_date") || "").trim();

  // =======================
  // PATH 1 (NUOVO): header_id
  // =======================
  if (header_id) {
    if (!isUuid(header_id)) {
      return NextResponse.json({ ok: false, error: "header_id non valido" }, { status: 400 });
    }

    // 1) leggo header per sapere come cancellare anche le righe
    const { data: head, error: headErr } = await supabaseAdmin
      .from("inventories_headers")
      .select("id, pv_id, category_id, subcategory_id, inventory_date, rapid_session_id, label")
      .eq("id", header_id)
      .maybeSingle();

    if (headErr) return NextResponse.json({ ok: false, error: headErr.message }, { status: 500 });

    // ✅ IDempotente: se non esiste, per noi è già stato eliminato
    if (!head?.id) {
      return NextResponse.json({
        ok: true,
        already_deleted: true,
        deleted: { inventories: 0, inventories_headers: 0 },
        deleted_header: { id: header_id, label: null },
      });
    }

    const hpv = String((head as any).pv_id || "").trim();
    const hdate = String((head as any).inventory_date || "").trim();
    const hcat = (head as any).category_id as string | null;
    const hsub = (head as any).subcategory_id as string | null;
    const hrapid = (head as any).rapid_session_id as string | null;

    if (!isUuid(hpv) || !isIsoDate(hdate)) {
      return NextResponse.json({ ok: false, error: "Header corrotto: pv_id/inventory_date non validi" }, { status: 500 });
    }

    // 2) elimina righe inventario (coerente con l’header trovato)
    let delRowsQ = supabaseAdmin.from("inventories").delete().eq("pv_id", hpv).eq("inventory_date", hdate);

    if (hcat) delRowsQ = delRowsQ.eq("category_id", hcat);
    else delRowsQ = delRowsQ.is("category_id", null);

    if (hsub) delRowsQ = delRowsQ.eq("subcategory_id", hsub);
    else delRowsQ = delRowsQ.is("subcategory_id", null);

    // Rapido: se c’è rapid_session_id lo uso, altrimenti deve essere NULL
    if (hrapid) delRowsQ = delRowsQ.eq("rapid_session_id", hrapid);
    else delRowsQ = delRowsQ.is("rapid_session_id", null);

    // ✅ compat supabase: niente count/head
    const { data: delRowsData, error: delRowsErr } = await delRowsQ.select("id");
    if (delRowsErr) return NextResponse.json({ ok: false, error: delRowsErr.message }, { status: 500 });
    const rowsDeleted = Array.isArray(delRowsData) ? delRowsData.length : 0;

    // 3) elimina header (per id)
    const { data: delHeadData, error: delHeadErr } = await supabaseAdmin
      .from("inventories_headers")
      .delete()
      .eq("id", header_id)
      .select("id");

    if (delHeadErr) return NextResponse.json({ ok: false, error: delHeadErr.message }, { status: 500 });
    const headersDeleted = Array.isArray(delHeadData) ? delHeadData.length : 0;

    // ✅ idempotente anche qui: se per race headersDeleted = 0, non è un errore “bloccante”
    const alreadyDeletedByRace = headersDeleted === 0;

    const warning =
      rowsDeleted === 0
        ? "Header eliminato, ma non risultano righe inventario eliminate (dati storici/filtri non allineati)."
        : null;

    return NextResponse.json({
      ok: true,
      ...(alreadyDeletedByRace ? { already_deleted: true } : {}),
      deleted: {
        inventories: rowsDeleted,
        inventories_headers: headersDeleted,
      },
      deleted_header: {
        id: head.id,
        label: (head as any).label ?? null,
      },
      ...(warning ? { warning } : {}),
    });
  }

  // =======================
  // PATH 2 (LEGACY): vecchi parametri
  // =======================
  // SAFETY CHECK: se col vecchio filtro trovo >1 header, BLOCCO.
  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });

  if (category_id !== null && !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }

  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }

  if (!isIsoDate(inventory_date)) {
    return NextResponse.json({ ok: false, error: "inventory_date non valida (YYYY-MM-DD)" }, { status: 400 });
  }

  const baseFilter = (q: any) => {
    q = q.eq("pv_id", pv_id).eq("inventory_date", inventory_date);

    if (category_id) q = q.eq("category_id", category_id);
    else q = q.is("category_id", null);

    if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
    else q = q.is("subcategory_id", null);

    return q;
  };

  const { data: heads, error: headsErr } = await baseFilter(
    supabaseAdmin.from("inventories_headers").select("id, label, rapid_session_id")
  ).limit(5);

  if (headsErr) return NextResponse.json({ ok: false, error: headsErr.message }, { status: 500 });

  const countHeads = Array.isArray(heads) ? heads.length : 0;

  if (countHeads === 0) {
    // ✅ anche qui: idempotente (non trovato = già eliminato)
    return NextResponse.json({
      ok: true,
      already_deleted: true,
      deleted: { inventories: 0, inventories_headers: 0 },
    });
  }

  if (countHeads > 1) {
    return NextResponse.json(
      {
        ok: false,
        code: "DELETE_AMBIGUOUS",
        error:
          "Eliminazione bloccata: esistono più inventari per PV/Data/Categoria. Aggiorna la UI per passare header_id (eliminazione per inventario singolo).",
        hint: "Invia header_id nella query string: /api/inventories/delete?header_id=...",
      },
      { status: 409 }
    );
  }

  // ✅ se legacy becca un inventario rapido “moderno”, usa rapid_session_id per cancellare bene le righe
  const rapid_session_id = (heads?.[0] as any)?.rapid_session_id ? String((heads?.[0] as any)?.rapid_session_id).trim() : "";

  let delRowsQ: any = baseFilter(supabaseAdmin.from("inventories").delete());
  if (rapid_session_id && isUuid(rapid_session_id)) {
    delRowsQ = delRowsQ.eq("rapid_session_id", rapid_session_id);
  } else {
    delRowsQ = delRowsQ.is("rapid_session_id", null);
  }

  const { data: delRowsData, error: delRowsErr } = await delRowsQ.select("id");
  if (delRowsErr) return NextResponse.json({ ok: false, error: delRowsErr.message }, { status: 500 });
  const rowsDeleted = Array.isArray(delRowsData) ? delRowsData.length : 0;

  const delHeadQ = baseFilter(supabaseAdmin.from("inventories_headers").delete());
  const { data: delHeadData, error: delHeadErr } = await delHeadQ.select("id");
  if (delHeadErr) return NextResponse.json({ ok: false, error: delHeadErr.message }, { status: 500 });
  const headersDeleted = Array.isArray(delHeadData) ? delHeadData.length : 0;

  return NextResponse.json({
    ok: true,
    deleted: {
      inventories: rowsDeleted,
      inventories_headers: headersDeleted,
    },
  });
}

