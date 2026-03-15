import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { syncPvStockFromInventory } from "@/lib/deposits/syncPvStockFromInventory";
import { mergePartialRecount } from "@/lib/progressivi/mergePartialRecount";

export const runtime = "nodejs";

type MlMode = "fixed" | "mixed";

type Row = {
  item_id: string;
  qty: number;
  qty_ml?: number;
  qty_gr?: number;
  ml_mode?: MlMode;
};

type Body = {
  pv_id?: string;
  category_id?: string;
  subcategory_id?: string | null;
  inventory_date?: string;
  operatore?: string;
  label?: string;
  rapid_session_id?: string;
  rows?: Row[];
  force_overwrite?: boolean;
  mode?: "close" | "continue";
  recount_mode?: boolean;
};

type NormalizedInventoryRow = {
  item_id: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
  um: string | null;
  peso_kg: number | null;
  volume_ml_per_unit: number | null;
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function clampInt(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.trunc(x));
}

const MAX_GR = 1_000_000_000;
function clampGr(n: any) {
  return Math.min(MAX_GR, clampInt(n));
}

function normMlMode(v: any): MlMode | null {
  return v === "fixed" || v === "mixed" ? v : null;
}

function normalizeUm(value: unknown): "PZ" | "KG" | "ML" | "ALTRO" {
  const um = String(value ?? "").trim().toUpperCase();
  if (um === "PZ") return "PZ";
  if (um === "KG") return "KG";
  if (um === "ML" || um === "LT" || um === "L") return "ML";
  return "ALTRO";
}

function computeEffectiveInventoryValue(
  row: NormalizedInventoryRow | null | undefined
): number {
  if (!row) return 0;

  const qty = Number(row.qty ?? 0);
  const qtyGr = Number(row.qty_gr ?? 0);
  const qtyMl = Number(row.qty_ml ?? 0);
  const pesoKg = Number(row.peso_kg ?? 0);
  const um = normalizeUm(row.um);

  if (um === "ML") {
    return qtyMl;
  }

  if (um === "KG") {
    if (pesoKg > 0) {
      return qty * pesoKg * 1000 + qtyGr;
    }
    return qtyGr;
  }

  return qty;
}

function rowChanged(
  oldRow: NormalizedInventoryRow | null | undefined,
  newRow: NormalizedInventoryRow | null | undefined
) {
  const oldEffective = computeEffectiveInventoryValue(oldRow);
  const newEffective = computeEffectiveInventoryValue(newRow);
  return oldEffective !== newEffective;
}

const USER_TABLE_CANDIDATES = ["app_user", "app_users", "utenti", "users"];

async function lookupPvIdFromUserTables(username: string): Promise<string | null> {
  for (const table of USER_TABLE_CANDIDATES) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("pv_id")
      .eq("username", username)
      .maybeSingle();
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

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("id")
    .eq("is_active", true)
    .eq("code", code)
    .maybeSingle();

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

function normalizeCategoryForServer(raw: any): { isRapid: boolean; category_id: string | null } {
  const s = String(raw ?? "").trim();
  const isRapid = s === "" || s.toLowerCase() === "null";
  if (isRapid) return { isRapid: true, category_id: null };
  return { isRapid: false, category_id: s };
}

function normalizeSubcategoryForServer(raw: any, isRapid: boolean): string | null {
  if (isRapid) return null;

  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;

  return s;
}

function normalizeRapidSessionIdForServer(raw: any, isRapid: boolean): string | null {
  if (!isRapid) return null;

  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;

  return isUuid(s) ? s : null;
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });

  const recountMode = body.recount_mode === true;

  const { isRapid, category_id } = normalizeCategoryForServer(body.category_id);
  const subcategory_id = normalizeSubcategoryForServer(body.subcategory_id, isRapid);

  const rapid_session_id = normalizeRapidSessionIdForServer(body.rapid_session_id, isRapid);
  if (isRapid && !rapid_session_id) {
    return NextResponse.json(
      { ok: false, error: "Rapido: rapid_session_id mancante o non valido (UUID)." },
      { status: 400 }
    );
  }

  const inventory_date = (body.inventory_date || "").trim();

  const operatore = (body.operatore || "").trim();
  if (!operatore) {
    return NextResponse.json({ ok: false, error: "Operatore mancante" }, { status: 400 });
  }
  if (operatore.length > 80) {
    return NextResponse.json(
      { ok: false, error: "Operatore troppo lungo (max 80)" },
      { status: 400 }
    );
  }

  const label_norm = String(body.label ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!label_norm) {
    return NextResponse.json(
      {
        ok: false,
        code: "LABEL_REQUIRED",
        error: "Nome Categoria (nota) obbligatorio per salvare l’inventario.",
      },
      { status: 400 }
    );
  }
  if (label_norm.length > 80) {
    return NextResponse.json(
      { ok: false, error: "Etichetta troppo lunga (max 80)" },
      { status: 400 }
    );
  }

  if (category_id !== null && !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json(
      { ok: false, error: "subcategory_id non valido" },
      { status: 400 }
    );
  }

  if (subcategory_id) {
    const { data: subRow, error: subErr } = await supabaseAdmin
      .from("subcategories")
      .select("id")
      .eq("id", subcategory_id)
      .maybeSingle();

    if (subErr) {
      return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });
    }
    if (!subRow?.id) {
      return NextResponse.json(
        { ok: false, error: "subcategory_id non esiste (FK)" },
        { status: 400 }
      );
    }
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga da salvare" }, { status: 400 });
  }
  if (rows.length > 3000) {
    return NextResponse.json(
      { ok: false, error: "Troppe righe in un colpo (max 3000)" },
      { status: 400 }
    );
  }

  const dateOrNull =
    inventory_date && /^\d{4}-\d{2}-\d{2}$/.test(inventory_date) ? inventory_date : null;
  if (!dateOrNull) {
    return NextResponse.json(
      { ok: false, error: "inventory_date non valida (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  let pv_id: string | null = (body.pv_id || "").trim() || null;

  if (session.role === "punto_vendita") {
    try {
      pv_id = await requirePvIdForPuntoVendita(session.username);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message || "Non autorizzato" },
        { status: 401 }
      );
    }
  } else {
    if (!isUuid(pv_id)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }
  }

  if (!pv_id) {
    return NextResponse.json({ ok: false, error: "pv_id mancante" }, { status: 400 });
  }

  let existsQ = supabaseAdmin
    .from("inventories_headers")
    .select("id, created_by_username")
    .eq("pv_id", pv_id)
    .eq("inventory_date", dateOrNull);

  if (category_id) existsQ = existsQ.eq("category_id", category_id);
  else existsQ = existsQ.is("category_id", null);

  if (subcategory_id) existsQ = existsQ.eq("subcategory_id", subcategory_id);
  else existsQ = existsQ.is("subcategory_id", null);

  if (isRapid) existsQ = existsQ.eq("rapid_session_id", rapid_session_id);
  else existsQ = existsQ.is("rapid_session_id", null);

  const { data: existing, error: existsErr } = await existsQ.limit(1);
  if (existsErr) return NextResponse.json({ ok: false, error: existsErr.message }, { status: 500 });

  const existingRow = Array.isArray(existing) && existing.length > 0 ? (existing[0] as any) : null;
  const existingId = existingRow?.id ?? null;
  const existingCreatedBy = (existingRow?.created_by_username ?? null) as string | null;

  const alreadyExists = !!existingId;

  if (
    alreadyExists &&
    existingCreatedBy &&
    existingCreatedBy !== session.username &&
    session.role !== "admin"
  ) {
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

  {
    let dupeQ = supabaseAdmin
      .from("inventories_headers")
      .select("id")
      .eq("pv_id", pv_id)
      .eq("inventory_date", dateOrNull)
      .eq("label", label_norm);

    if (alreadyExists && existingId) {
      dupeQ = dupeQ.neq("id", existingId);
    }

    const { data: dupes, error: dupeErr } = await dupeQ.limit(1);
    if (dupeErr) return NextResponse.json({ ok: false, error: dupeErr.message }, { status: 500 });

    if (Array.isArray(dupes) && dupes.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "LABEL_ALREADY_EXISTS",
          error:
            "Esiste già un inventario con la stessa nota per questo PV e questa data. Cambia la nota e riprova.",
        },
        { status: 409 }
      );
    }
  }

  if (!alreadyExists) {
    const headerPayload = {
      pv_id,
      category_id,
      subcategory_id,
      inventory_date: dateOrNull,
      operatore,
      label: label_norm,
      created_by_username: session.username,
      updated_at: new Date().toISOString(),
      rapid_session_id,
    };

    const { error: insErr } = await supabaseAdmin
      .from("inventories_headers")
      .insert(headerPayload as any);

    if (insErr) {
      console.error("[inventories/save] header insert error:", insErr);

      const msg = String(insErr.message || "");
      if (msg.toLowerCase().includes("duplicate") || msg.includes("23505")) {
        return NextResponse.json(
          {
            ok: false,
            code: "LABEL_ALREADY_EXISTS",
            error:
              "Esiste già un inventario con la stessa nota per questo PV e questa data. Cambia la nota e riprova.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }
  } else {
    if (!body.force_overwrite) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVENTORY_ALREADY_EXISTS",
          error:
            "Esiste già un inventario per questa combinazione (PV/Categoria/Sottocategoria/Data). Per sovrascriverlo devi confermare esplicitamente.",
          existing_id: existingId,
        },
        { status: 409 }
      );
    }

    const { error: updErr } = await supabaseAdmin
      .from("inventories_headers")
      .update({ operatore, label: label_norm, updated_at: new Date().toISOString() } as any)
      .eq("id", existingId);

    if (updErr) {
      console.error("[inventories/save] header update error:", updErr);
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }
  }

  const validItemIds = Array.from(
    new Set(
      rows
        .map((r) => (typeof r?.item_id === "string" ? r.item_id.trim() : ""))
        .filter((id) => isUuid(id))
    )
  );

  const volumeByItemId = new Map<string, number>();
  const itemsMeta: {
    id: string;
    code: string;
    volume_ml_per_unit: number | null;
    peso_kg: number | null;
    um: string | null;
  }[] = [];

  if (validItemIds.length > 0) {
    const { data: itemsData, error: itemsErr } = await supabaseAdmin
      .from("items")
      .select("id, code, volume_ml_per_unit, peso_kg, um")
      .in("id", validItemIds);

    if (itemsErr) {
      console.error("[inventories/save] items volume fetch error:", itemsErr);
      return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
    }

    for (const it of itemsData || []) {
      const id = (it as any)?.id as string | undefined;
      const code = String((it as any)?.code ?? "").trim();
      const v = Number((it as any)?.volume_ml_per_unit ?? 0);
      const pk = Number(String((it as any)?.peso_kg ?? "0").replace(",", "."));
      const um = String((it as any)?.um ?? "").trim() || null;

      if (id && isUuid(id)) {
        if (Number.isFinite(v) && v > 0) volumeByItemId.set(id, v);

        itemsMeta.push({
          id,
          code,
          volume_ml_per_unit: Number.isFinite(v) && v > 0 ? v : null,
          peso_kg: Number.isFinite(pk) && pk > 0 ? pk : null,
          um,
        });
      }
    }
  }

  const codeByItemId = new Map<string, string>();
  for (const item of itemsMeta) {
    codeByItemId.set(item.id, item.code || item.id);
  }

  const metaByItemId = new Map<
    string,
    {
      um: string | null;
      peso_kg: number | null;
      volume_ml_per_unit: number | null;
    }
  >();

  for (const item of itemsMeta) {
    metaByItemId.set(item.id, {
      um: item.um ?? null,
      peso_kg: item.peso_kg ?? null,
      volume_ml_per_unit: item.volume_ml_per_unit ?? null,
    });
  }

  let existingRowsForPreserveByItemId = new Map<
    string,
    { qty: number; qty_ml: number; qty_gr: number }
  >();

  if (alreadyExists) {
    let existingRowsPreserveQ = supabaseAdmin
      .from("inventories")
      .select("item_id, qty, qty_ml, qty_gr")
      .eq("pv_id", pv_id)
      .eq("inventory_date", dateOrNull);

    if (isRapid) existingRowsPreserveQ = existingRowsPreserveQ.eq("rapid_session_id", rapid_session_id);
    else existingRowsPreserveQ = existingRowsPreserveQ.is("rapid_session_id", null);

    if (category_id) existingRowsPreserveQ = existingRowsPreserveQ.eq("category_id", category_id);
    else existingRowsPreserveQ = existingRowsPreserveQ.is("category_id", null);

    if (subcategory_id) existingRowsPreserveQ = existingRowsPreserveQ.eq("subcategory_id", subcategory_id);
    else existingRowsPreserveQ = existingRowsPreserveQ.is("subcategory_id", null);

    const { data: existingRowsPreserveData, error: existingRowsPreserveErr } =
      await existingRowsPreserveQ;

    if (existingRowsPreserveErr) {
      console.error("[inventories/save] existing rows preserve read error:", existingRowsPreserveErr);
      return NextResponse.json(
        { ok: false, error: existingRowsPreserveErr.message },
        { status: 500 }
      );
    }

    existingRowsForPreserveByItemId = new Map(
      (existingRowsPreserveData || []).map((row: any) => [
        String(row?.item_id ?? "").trim(),
        {
          qty: Number(row?.qty ?? 0),
          qty_ml: Number(row?.qty_ml ?? 0),
          qty_gr: Number(row?.qty_gr ?? 0),
        },
      ])
    );
  }

  const byItem = new Map<string, any>();

  for (const r of rows) {
    if (!isUuid(r?.item_id)) continue;

    const itemId = r.item_id.trim();
    const volume = volumeByItemId.get(itemId) ?? 0;

    const qtyIn = clampInt((r as any).qty ?? 0);
    const qtyGrIn = clampGr((r as any).qty_gr ?? 0);

    const qtyMlInRaw = (r as any).qty_ml;
    const hasQtyMl =
      qtyMlInRaw !== undefined &&
      qtyMlInRaw !== null &&
      Number.isFinite(Number(qtyMlInRaw));
    const qtyMlIn = hasQtyMl ? clampInt(qtyMlInRaw) : null;

    const ml_mode = normMlMode((r as any).ml_mode);

    let rowToSave: any;

    if (volume > 0) {
      if (ml_mode === "mixed") {
        const qty_ml = qtyMlIn ?? 0;
        rowToSave = {
          pv_id,
          category_id,
          subcategory_id,
          rapid_session_id: isRapid ? rapid_session_id : null,
          item_id: itemId,
          qty: 0,
          qty_ml,
          qty_gr: 0,
          inventory_date: dateOrNull,
          created_by_username: session.username,
        };
      } else if (qtyMlIn !== null) {
        const qty_ml = qtyMlIn;
        const qty = clampInt(qtyIn);
        rowToSave = {
          pv_id,
          category_id,
          subcategory_id,
          rapid_session_id: isRapid ? rapid_session_id : null,
          item_id: itemId,
          qty,
          qty_ml,
          qty_gr: 0,
          inventory_date: dateOrNull,
          created_by_username: session.username,
        };
      } else {
        const existingPreserve = existingRowsForPreserveByItemId.get(itemId);

        if (existingPreserve) {
          rowToSave = {
            pv_id,
            category_id,
            subcategory_id,
            rapid_session_id: isRapid ? rapid_session_id : null,
            item_id: itemId,
            qty: clampInt(qtyIn),
            qty_ml: clampInt(existingPreserve.qty_ml ?? 0),
            qty_gr: 0,
            inventory_date: dateOrNull,
            created_by_username: session.username,
          };
        } else {
          const totalMl = clampInt(qtyIn);
          const qty = Math.floor(totalMl / volume);
          rowToSave = {
            pv_id,
            category_id,
            subcategory_id,
            rapid_session_id: isRapid ? rapid_session_id : null,
            item_id: itemId,
            qty: clampInt(qty),
            qty_ml: clampInt(totalMl),
            qty_gr: 0,
            inventory_date: dateOrNull,
            created_by_username: session.username,
          };
        }
      }
    } else {
      rowToSave = {
        pv_id,
        category_id,
        subcategory_id,
        rapid_session_id: isRapid ? rapid_session_id : null,
        item_id: itemId,
        qty: clampInt(qtyIn),
        qty_ml: 0,
        qty_gr: qtyGrIn,
        inventory_date: dateOrNull,
        created_by_username: session.username,
      };
    }

    byItem.set(itemId, rowToSave);
  }

  const incomingPreparedRows = Array.from(byItem.values());

  let payload = incomingPreparedRows.filter(
    (r: any) =>
      (Number(r.qty) || 0) > 0 ||
      (Number(r.qty_ml) || 0) > 0 ||
      (Number(r.qty_gr) || 0) > 0
  );

  let recountEventsPayload: any[] = [];
  let recountEventsUpsertPayload: any[] = [];

  if (alreadyExists) {
    let existingRowsQ = supabaseAdmin
      .from("inventories")
      .select("item_id, qty, qty_ml, qty_gr")
      .eq("pv_id", pv_id)
      .eq("inventory_date", dateOrNull);

    if (isRapid) existingRowsQ = existingRowsQ.eq("rapid_session_id", rapid_session_id);
    else existingRowsQ = existingRowsQ.is("rapid_session_id", null);

    if (category_id) existingRowsQ = existingRowsQ.eq("category_id", category_id);
    else existingRowsQ = existingRowsQ.is("category_id", null);

    if (subcategory_id) existingRowsQ = existingRowsQ.eq("subcategory_id", subcategory_id);
    else existingRowsQ = existingRowsQ.is("subcategory_id", null);

    const { data: existingRowsData, error: existingRowsErr } = await existingRowsQ;

    if (existingRowsErr) {
      console.error("[inventories/save] existing rows read error:", existingRowsErr);
      return NextResponse.json({ ok: false, error: existingRowsErr.message }, { status: 500 });
    }

    const existingRowsNormalized: NormalizedInventoryRow[] = (existingRowsData || []).map((r: any) => {
      const itemId = String(r?.item_id ?? "").trim();
      const meta = metaByItemId.get(itemId);

      return {
        item_id: itemId,
        qty: Number(r?.qty ?? 0),
        qty_gr: Number(r?.qty_gr ?? 0),
        qty_ml: Number(r?.qty_ml ?? 0),
        um: meta?.um ?? null,
        peso_kg: meta?.peso_kg ?? null,
        volume_ml_per_unit: meta?.volume_ml_per_unit ?? null,
      };
    });

    const existingByItemId = new Map<string, NormalizedInventoryRow>();
    for (const row of existingRowsNormalized) {
      if (!row.item_id) continue;
      existingByItemId.set(row.item_id, row);
    }

    if (recountMode) {
      recountEventsPayload = incomingPreparedRows
        .map((r: any) => {
          const itemId = String(r?.item_id ?? "").trim();
          const meta = metaByItemId.get(itemId);

          const normalizedIncoming: NormalizedInventoryRow = {
            item_id: itemId,
            qty: Number(r?.qty ?? 0),
            qty_gr: Number(r?.qty_gr ?? 0),
            qty_ml: Number(r?.qty_ml ?? 0),
            um: meta?.um ?? null,
            peso_kg: meta?.peso_kg ?? null,
            volume_ml_per_unit: meta?.volume_ml_per_unit ?? null,
          };
          const oldRow = existingByItemId.get(normalizedIncoming.item_id) ?? null;
          if (!rowChanged(oldRow, normalizedIncoming)) return null;

          const itemCode =
            codeByItemId.get(normalizedIncoming.item_id) || normalizedIncoming.item_id;

          return {
            inventory_header_id: existingId,
            pv_id,
            inventory_date: dateOrNull,
            category_id,
            subcategory_id,
            rapid_session_id: isRapid ? rapid_session_id : null,
            label: label_norm,
            item_id: normalizedIncoming.item_id,
            item_code: itemCode,

            // base iniziale: per ora parto dal valore precedente all’attuale modifica
            // poi sotto, se esiste già una riga recount, manterrò il suo old_* originale
            old_qty: Number(oldRow?.qty ?? 0),
            old_qty_gr: Number(oldRow?.qty_gr ?? 0),
            old_qty_ml: Number(oldRow?.qty_ml ?? 0),

            new_qty: Number(normalizedIncoming.qty ?? 0),
            new_qty_gr: Number(normalizedIncoming.qty_gr ?? 0),
            new_qty_ml: Number(normalizedIncoming.qty_ml ?? 0),

            created_by_username: session.username,
          };
        })
        .filter(Boolean) as any[];

      if (recountEventsPayload.length > 0) {
        const recountItemIds = Array.from(
          new Set(
            recountEventsPayload
              .map((r: any) => String(r?.item_id ?? "").trim())
              .filter((id: string) => !!id)
          )
        );

        const { data: existingRecountRows, error: existingRecountErr } = await supabaseAdmin
          .from("inventory_recount_events")
          .select("inventory_header_id, item_id, old_qty, old_qty_gr, old_qty_ml")
          .eq("inventory_header_id", existingId)
          .in("item_id", recountItemIds);

        if (existingRecountErr) {
          console.error("[inventories/save] existing recount rows read error:", existingRecountErr);
          return NextResponse.json({ ok: false, error: existingRecountErr.message }, { status: 500 });
        }

        const existingRecountByItemId = new Map<string, any>();
        for (const row of existingRecountRows || []) {
          const itemId = String((row as any)?.item_id ?? "").trim();
          if (!itemId) continue;
          existingRecountByItemId.set(itemId, row);
        }

        recountEventsUpsertPayload = recountEventsPayload.map((eventRow: any) => {
          const existingRecount = existingRecountByItemId.get(String(eventRow.item_id).trim());

          if (!existingRecount) {
            return eventRow;
          }

          return {
            ...eventRow,
            // ✅ OPZIONE B:
            // mantengo sempre il vecchio valore originale del primo recount
            old_qty: Number((existingRecount as any)?.old_qty ?? eventRow.old_qty ?? 0),
            old_qty_gr: Number((existingRecount as any)?.old_qty_gr ?? eventRow.old_qty_gr ?? 0),
            old_qty_ml: Number((existingRecount as any)?.old_qty_ml ?? eventRow.old_qty_ml ?? 0),
          };
        });
      }
    }

    const mergedRows = mergePartialRecount({
      existingRows: existingRowsNormalized,
      incomingRows: incomingPreparedRows.map((r: any) => ({
        item_id: String(r?.item_id ?? "").trim(),
        qty: Number(r?.qty ?? 0),
        qty_gr: Number(r?.qty_gr ?? 0),
        qty_ml: Number(r?.qty_ml ?? 0),
        um: null,
        peso_kg: null,
        volume_ml_per_unit: null,
      })),
    });

    payload = mergedRows.map((r) => ({
      pv_id,
      category_id,
      subcategory_id,
      rapid_session_id: isRapid ? rapid_session_id : null,
      item_id: r.item_id,
      qty: r.qty,
      qty_ml: r.qty_ml,
      qty_gr: r.qty_gr,
      inventory_date: dateOrNull,
      created_by_username: session.username,
    }));

    let delQ = supabaseAdmin
      .from("inventories")
      .delete()
      .eq("pv_id", pv_id)
      .eq("inventory_date", dateOrNull);

    if (isRapid) delQ = delQ.eq("rapid_session_id", rapid_session_id);
    else delQ = delQ.is("rapid_session_id", null);

    if (category_id) delQ = delQ.eq("category_id", category_id);
    else delQ = delQ.is("category_id", null);

    if (subcategory_id) delQ = delQ.eq("subcategory_id", subcategory_id);
    else delQ = delQ.is("subcategory_id", null);

    const { error: delErr } = await delQ;
    if (delErr) {
      console.error("[inventories/save] rows delete error:", delErr);
      return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }
  }

  if (payload.length === 0) {
    if (alreadyExists && recountMode && recountEventsUpsertPayload.length > 0) {
      const { error: recountErr } = await supabaseAdmin
        .from("inventory_recount_events")
        .upsert(recountEventsUpsertPayload, {
          onConflict: "inventory_header_id,item_id",
        });

      if (recountErr) {
        console.error("[inventories/save] recount events upsert error:", recountErr);
        return NextResponse.json({ ok: false, error: recountErr.message }, { status: 500 });
      }
    }

    if (!alreadyExists) {
      return NextResponse.json(
        { ok: false, error: "Nessuna riga valida (tutte a 0)" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      saved: 0,
      pv_id,
      operatore,
      enforced_pv: session.role === "punto_vendita",
      overwritten: alreadyExists,
      partial_merge: true,
      recount_mode: recountMode,
      recount_events_saved: recountMode ? recountEventsUpsertPayload.length : 0,
      label: label_norm,
    });
  }

  const { error: insRowsErr } = await supabaseAdmin
    .from("inventories")
    .insert(payload as any);

  if (insRowsErr) {
    console.error("[inventories/save] rows insert error:", insRowsErr);
    return NextResponse.json({ ok: false, error: insRowsErr.message }, { status: 500 });
  }

  if (alreadyExists && recountMode && recountEventsUpsertPayload.length > 0) {
    const { error: recountErr } = await supabaseAdmin
      .from("inventory_recount_events")
      .upsert(recountEventsUpsertPayload, {
        onConflict: "inventory_header_id,item_id",
      });

    if (recountErr) {
      console.error("[inventories/save] recount events upsert error:", recountErr);
      return NextResponse.json({ ok: false, error: recountErr.message }, { status: 500 });
    }
  }

  let deposit_sync: any = null;
  let warning: string | null = null;

  try {
    deposit_sync = await syncPvStockFromInventory({
      pv_id,
      items_meta: itemsMeta,
      inventory_rows: payload.map((r: any) => ({
        item_id: String(r.item_id),
        qty: Number(r.qty) || 0,
        qty_ml: Number(r.qty_ml) || 0,
        qty_gr: Number(r.qty_gr) || 0,
      })),
    });
  } catch (e: any) {
    console.error("[inventories/save] PV-STOCK sync error:", e);
    warning = `Inventario salvato, ma aggiornamento deposito PV-STOCK fallito: ${
      e?.message || "errore"
    }`;
  }

  return NextResponse.json({
    ok: true,
    saved: payload.length,
    pv_id,
    operatore,
    enforced_pv: session.role === "punto_vendita",
    overwritten: alreadyExists,
    partial_merge: alreadyExists || undefined,
    recount_mode: recountMode,
    recount_events_saved: recountMode ? recountEventsUpsertPayload.length : 0,
    label: label_norm,
    ...(deposit_sync ? { deposit_sync } : {}),
    ...(warning ? { warning } : {}),
  });
}



















