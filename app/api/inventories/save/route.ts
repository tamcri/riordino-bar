import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Row = {
  item_id: string;
  qty: number;
};

type Body = {
  pv_id?: string;
  category_id?: string;
  subcategory_id?: string | null;
  inventory_date?: string; // YYYY-MM-DD
  operatore?: string;
  rows?: Row[];
  force_overwrite?: boolean; // (compat)
  mode?: "close" | "continue"; // (UI) non cambia la logica server
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function clampInt(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.trunc(x));
}

const USER_TABLE_CANDIDATES = ["app_user", "app_users", "utenti", "users"];

async function lookupPvIdFromUserTables(username: string): Promise<string | null> {
  for (const table of USER_TABLE_CANDIDATES) {
    const { data, error } = await supabaseAdmin.from(table).select("pv_id").eq("username", username).maybeSingle();
    if (error) continue;

    const pv_id = (data as any)?.pv_id ?? null;
    if (pv_id && isUuid(pv_id)) return pv_id;

    return null;
  }
  return null;
}

async function lookupPvIdFromUsernameCode(username: string): Promise<string | null> {
  const code = (username || "").trim().split(/\s+/)[0]?.toUpperCase();
  if (!code || code.length > 5) return null;

  const { data, error } = await supabaseAdmin.from("pvs").select("id").eq("is_active", true).eq("code", code).maybeSingle();
  if (error) return null;
  return data?.id ?? null;
}

async function requirePvIdForPuntoVendita(username: string): Promise<string> {
  const pvFromUsers = await lookupPvIdFromUserTables(username);
  if (pvFromUsers) return pvFromUsers;

  const pvFromCode = await lookupPvIdFromUsernameCode(username);
  if (pvFromCode) return pvFromCode;

  throw new Error("Utente punto vendita senza PV assegnato (pv_id mancante).");
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });

  const category_id = body.category_id?.trim();
  const subcategory_id = (body.subcategory_id ?? null)?.toString().trim() || null;
  const inventory_date = (body.inventory_date || "").trim();

  const operatore = (body.operatore || "").trim();
  if (!operatore) return NextResponse.json({ ok: false, error: "Operatore mancante" }, { status: 400 });
  if (operatore.length > 80) return NextResponse.json({ ok: false, error: "Operatore troppo lungo (max 80)" }, { status: 400 });

  if (!isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga da salvare" }, { status: 400 });
  }
  if (rows.length > 3000) {
    return NextResponse.json({ ok: false, error: "Troppe righe in un colpo (max 3000)" }, { status: 400 });
  }

  const dateOrNull = inventory_date && /^\d{4}-\d{2}-\d{2}$/.test(inventory_date) ? inventory_date : null;
  if (!dateOrNull) {
    return NextResponse.json({ ok: false, error: "inventory_date non valida (YYYY-MM-DD)" }, { status: 400 });
  }

  // ✅ pv_id effettivo
  let pv_id: string | null = (body.pv_id || "").trim() || null;

  if (session.role === "punto_vendita") {
    try {
      pv_id = await requirePvIdForPuntoVendita(session.username);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || "Non autorizzato" }, { status: 401 });
    }
  } else {
    if (!isUuid(pv_id)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }
  }

  if (!pv_id) {
    return NextResponse.json({ ok: false, error: "pv_id mancante" }, { status: 400 });
  }

  // ✅ 0) verifica header esistente (chiave logica)
  let existsQ = supabaseAdmin
    .from("inventories_headers")
    .select("id, created_by_username")
    .eq("pv_id", pv_id)
    .eq("category_id", category_id)
    .eq("inventory_date", dateOrNull);

  if (subcategory_id) existsQ = existsQ.eq("subcategory_id", subcategory_id);
  else existsQ = existsQ.is("subcategory_id", null);

  const { data: existing, error: existsErr } = await existsQ.limit(1);
  if (existsErr) return NextResponse.json({ ok: false, error: existsErr.message }, { status: 500 });

  const existingRow = Array.isArray(existing) && existing.length > 0 ? (existing[0] as any) : null;
  const existingId = existingRow?.id ?? null;
  const existingCreatedBy = (existingRow?.created_by_username ?? null) as string | null;

  const alreadyExists = !!existingId;

  // ✅ REGOLA: inventario unico al giorno.
  // - se esiste e creato da ALTRO utente => 409
  // - se esiste e creato dallo STESSO utente => aggiornamento progressivo (NO force_overwrite)
  if (alreadyExists && existingCreatedBy && existingCreatedBy !== session.username) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Esiste già un inventario per questa combinazione (PV/Categoria/Sottocategoria/Data) creato da un altro utente. Non puoi modificarlo.",
        code: "INVENTORY_ALREADY_EXISTS",
      },
      { status: 409 }
    );
  }

  // ✅ 1) header: insert se non esiste, update se esiste (stesso utente)
  if (!alreadyExists) {
    const headerPayload = {
      pv_id,
      category_id,
      subcategory_id,
      inventory_date: dateOrNull,
      operatore,
      created_by_username: session.username,
      updated_at: new Date().toISOString(),
    };

    const { error: insErr } = await supabaseAdmin.from("inventories_headers").insert(headerPayload as any);
    if (insErr) {
      console.error("[inventories/save] header insert error:", insErr);
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }
  } else {
    const { error: updErr } = await supabaseAdmin
      .from("inventories_headers")
      .update({ operatore, updated_at: new Date().toISOString() } as any)
      .eq("id", existingId);

    if (updErr) {
      console.error("[inventories/save] header update error:", updErr);
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    // ✅ aggiornamento progressivo: sostituisco le righe della stessa chiave logica
    let delQ = supabaseAdmin
      .from("inventories")
      .delete()
      .eq("pv_id", pv_id)
      .eq("category_id", category_id)
      .eq("inventory_date", dateOrNull);

    if (subcategory_id) delQ = delQ.eq("subcategory_id", subcategory_id);
    else delQ = delQ.is("subcategory_id", null);

    const { error: delErr } = await delQ;
    if (delErr) {
      console.error("[inventories/save] rows delete error:", delErr);
      return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }
  }

  // ✅ 2) prepara righe
  const payload = rows
    .filter((r) => isUuid(r.item_id))
    .map((r) => ({
      pv_id,
      category_id,
      subcategory_id,
      item_id: r.item_id,
      qty: clampInt(r.qty),
      inventory_date: dateOrNull,
      created_by_username: session.username,
    }));

  if (payload.length === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga valida" }, { status: 400 });
  }

  // ✅ 3) insert righe
  const { error: insRowsErr } = await supabaseAdmin.from("inventories").insert(payload as any);

  if (insRowsErr) {
    console.error("[inventories/save] rows insert error:", insRowsErr);
    return NextResponse.json({ ok: false, error: insRowsErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    saved: payload.length,
    pv_id,
    operatore,
    enforced_pv: session.role === "punto_vendita",
    overwritten: alreadyExists, // true se update progressivo
  });
}













