import {
  getCategoryItemsUniverse,
  type CategoryUniverseItem,
} from "@/lib/shared/getCategoryItemsUniverse";
import {
  resolveLogicalCategory,
  type LogicalCategory,
  normalizeLogicalCategoryLabel,
} from "@/lib/shared/resolveLogicalCategory";
import {
  createProgressiviSnapshot,
  findExistingProgressiviSnapshot,
  loadProgressiviSnapshot,
  replaceProgressiviSnapshotRows,
  type ProgressiviSnapshotRow,
} from "@/lib/progressivi/snapshot";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ProgressiviReportParams = {
  header_id?: string | null;
  pv_id?: string | null;
  inventory_date?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
};

export type ProgressiviBlockRow = {
  item_id: string | null;
  item_code: string;
  description: string;
  um: string | null;
  prezzo_vendita_eur: number;
  is_recounted?: boolean;
  previous: {
    inventario: number;
    giacenza_da_gestionale: number;
    carico_non_registrato: number;
    giacenza: number;
    valore_giacenza: number;
  };
  current: {
    inventario: number;
    giacenza_da_gestionale: number;
    carico_non_registrato: number;
    giacenza: number;
    valore_giacenza: number;
  };
  riscontro: {
    differenza: number;
    valore_differenza: number;
  };
};

export type ProgressiviReportData = {
  current_header: {
    id: string;
    pv_id: string;
    inventory_date: string;
    label: string | null;
    category_id: string | null;
    subcategory_id: string | null;
    operatore: string | null;
  };
  previous_header: {
    id: string;
    inventory_date: string;
    label: string | null;
  } | null;
  pv: {
    id: string;
    code: string;
    name: string;
    label: string;
  };
  rows: ProgressiviBlockRow[];
  totals: {
    previous: {
      inventario: number;
      giacenza_da_gestionale: number;
      carico_non_registrato: number;
      giacenza: number;
      valore_giacenza: number;
    };
    current: {
      inventario: number;
      giacenza_da_gestionale: number;
      carico_non_registrato: number;
      giacenza: number;
      valore_giacenza: number;
    };
    riscontro: {
      differenza: number;
      valore_differenza: number;
    };
  };
  assumptions: {
    carico_non_registrato: string;
  };
};

type HeaderRow = {
  id: string;
  pv_id: string;
  inventory_date: string;
  label: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  operatore: string | null;
};

type InventoryRowRaw = {
  item_id: string | null;
  qty: number | null;
  qty_ml: number | null;
  qty_gr: number | null;
  items: {
    id: string;
    code: string | null;
    description: string | null;
    um: string | null;
    peso_kg: number | null;
    prezzo_vendita_eur: number | null;
  } | null;
};

type ProgressivoRowRaw = {
  item_code: string | null;
  giacenza_qta1_fiscale: string | number | null;
};

type ProgressivoNormalizedRow = {
  raw_code: string;
  normalized_code_legacy: string;
  normalized_code_compact: string;
  giacenza_qta1_fiscale: number;
};

type PvRow = {
  id: string;
  code: string | null;
  name: string | null;
};

type PreviousHeaderCandidate = {
  id: string;
  inventory_date: string;
  label: string | null;
  category_id: string | null;
};

type LiveProgressiviComputed = {
  currentHeader: HeaderRow;
  previousHeader: {
    id: string;
    inventory_date: string;
    label: string | null;
  } | null;
  pv: {
    id: string;
    code: string;
    name: string;
    label: string;
  };
  logicalCategory: {
    resolvedCategoryId: string | null;
    resolvedCategoryName: string | null;
    normalizedLabel: string | null;
    status: "by_category_id" | "by_label_match" | "unresolved";
  };
  rows: ProgressiviBlockRow[];
};

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v).trim()
  );
}

function isIsoDate(v: string | null | undefined) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
}

function normNullParam(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
}

function normCode(v: unknown) {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const firstToken = raw.split(/\s+/)[0] || "";
  return firstToken.trim().toUpperCase().replace(/\s+/g, "");
}

function normCodeCompact(v: unknown) {
  const raw = String(v ?? "").trim().toUpperCase();
  if (!raw) return "";
  return raw.replace(/\s+/g, "");
}

function normUm(um: unknown): "PZ" | "KG" | "LT" | "ALTRO" {
  const u = String(um ?? "").trim().toUpperCase();
  if (u === "PZ") return "PZ";
  if (u === "KG") return "KG";
  if (u === "LT" || u === "L" || u === "ML") return "LT";
  return "ALTRO";
}

function toNum(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toExactDecimal(v: unknown) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  let s = String(v).trim();
  if (!s) return 0;

  s = s.replace(/\s+/g, "");

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeQty(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(6));
}

function calcInventario(row: InventoryRowRaw | null | undefined) {
  if (!row) return 0;

  const um = normUm(row.items?.um ?? null);
  const qty = toNum(row.qty);
  const qtyMl = toNum(row.qty_ml);
  const qtyGr = toNum(row.qty_gr);
  const pesoKg = toNum(row.items?.peso_kg);

  if (um === "LT") return normalizeQty(qtyMl / 1000);
  if (um === "KG") return normalizeQty(qty * pesoKg + qtyGr / 1000);
  return normalizeQty(qty);
}

async function loadCategories(): Promise<LogicalCategory[]> {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id, name, slug, is_active")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as LogicalCategory[];
}

async function loadAllItems(): Promise<CategoryUniverseItem[]> {
  const { data, error } = await supabaseAdmin
    .from("items")
    .select(`
      id,
      code,
      description,
      barcode,
      prezzo_vendita_eur,
      is_active,
      um,
      peso_kg,
      volume_ml_per_unit,
      category_id,
      subcategory_id
    `)
    .order("code", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CategoryUniverseItem[];
}

function buildLogicalCategoryKey(input: {
  categoryId: string | null;
  label: string | null;
}) {
  if (input.categoryId) {
    return `category:${input.categoryId}`;
  }

  const normalizedLabel = normalizeLogicalCategoryLabel(input.label);
  return normalizedLabel ? `label:${normalizedLabel}` : null;
}

async function resolveCurrentHeader(
  params: ProgressiviReportParams
): Promise<HeaderRow> {
  const headerId = String(params.header_id ?? "").trim();

  if (headerId) {
    if (!isUuid(headerId)) throw new Error("header_id non valido");

    const { data, error } = await supabaseAdmin
      .from("inventories_headers")
      .select(
        "id, pv_id, inventory_date, label, category_id, subcategory_id, operatore"
      )
      .eq("id", headerId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Inventario non trovato");

    return data as HeaderRow;
  }

  const pvId = String(params.pv_id ?? "").trim();
  const inventoryDate = String(params.inventory_date ?? "").trim();
  const categoryId = normNullParam(params.category_id);
  const subcategoryId = normNullParam(params.subcategory_id);

  if (!isUuid(pvId)) throw new Error("pv_id non valido");
  if (!isIsoDate(inventoryDate)) {
    throw new Error("inventory_date non valida (YYYY-MM-DD)");
  }
  if (categoryId !== null && !isUuid(categoryId)) {
    throw new Error("category_id non valido");
  }
  if (subcategoryId !== null && !isUuid(subcategoryId)) {
    throw new Error("subcategory_id non valido");
  }

  let q = supabaseAdmin
    .from("inventories_headers")
    .select("id, pv_id, inventory_date, label, category_id, subcategory_id, operatore")
    .eq("pv_id", pvId)
    .eq("inventory_date", inventoryDate);

  if (categoryId) q = q.eq("category_id", categoryId);
  else q = q.is("category_id", null);

  if (subcategoryId) q = q.eq("subcategory_id", subcategoryId);
  else q = q.is("subcategory_id", null);

  const { data, error } = await q.order("updated_at", { ascending: false }).limit(1);

  if (error) throw error;

  const row = (data?.[0] ?? null) as HeaderRow | null;
  if (!row) throw new Error("Inventario non trovato");

  return row;
}

async function loadInventoryRows(headerId: string): Promise<InventoryRowRaw[]> {
  const { data: header, error: headerError } = await supabaseAdmin
    .from("inventories_headers")
    .select("pv_id, inventory_date, category_id, subcategory_id, rapid_session_id")
    .eq("id", headerId)
    .maybeSingle();

  if (headerError) {
    throw new Error(`Errore caricamento header inventario: ${headerError.message}`);
  }

  if (!header) {
    throw new Error("Header inventario non trovato");
  }

  let q = supabaseAdmin
    .from("inventories")
    .select(`
      item_id,
      qty,
      qty_ml,
      qty_gr,
      items:items!left(
        id,
        code,
        description,
        um,
        peso_kg,
        prezzo_vendita_eur
      )
    `)
    .eq("pv_id", header.pv_id)
    .eq("inventory_date", header.inventory_date);

  const categoryId = (header as any).category_id ?? null;
  const subcategoryId = (header as any).subcategory_id ?? null;
  const rapidSessionId = (header as any).rapid_session_id ?? null;

  if (categoryId === null) {
    q = q.is("category_id", null);

    if (rapidSessionId) {
      q = q.or(`rapid_session_id.eq.${rapidSessionId},rapid_session_id.is.null`);
    } else {
      q = q.is("rapid_session_id", null);
    }
  } else {
    q = q.eq("category_id", categoryId);

    if (subcategoryId) q = q.eq("subcategory_id", subcategoryId);
    else q = q.is("subcategory_id", null);

    q = q.is("rapid_session_id", null);
  }

  const { data, error } = await q;

  if (error) {
    throw new Error(`Errore caricamento righe inventario: ${error.message}`);
  }

  return (data ?? []) as unknown as InventoryRowRaw[];
}

function resolveUniqueInventoryMatch<T extends { items?: { code?: string | null } | null }>(
  rows: T[],
  progressivoCode: string
): T | null {
  const targetCompact = normCodeCompact(progressivoCode);
  const targetLegacy = normCode(progressivoCode);

  if (!targetCompact && !targetLegacy) return null;

  const exactCompactMatches = rows.filter((row) => {
    const itemCodeCompact = normCodeCompact(row.items?.code);
    return !!itemCodeCompact && itemCodeCompact === targetCompact;
  });

  if (exactCompactMatches.length === 1) return exactCompactMatches[0];
  if (exactCompactMatches.length > 1) return null;

  const legacyMatches = rows.filter((row) => {
    const itemCodeCompact = normCodeCompact(row.items?.code);
    const itemCodeLegacy = normCode(row.items?.code);

    if (!itemCodeCompact && !itemCodeLegacy) return false;

    if (targetCompact && itemCodeCompact && itemCodeCompact.startsWith(targetCompact)) {
      return true;
    }

    if (targetLegacy && itemCodeLegacy && itemCodeLegacy === targetLegacy) {
      return true;
    }

    if (targetLegacy && itemCodeLegacy && itemCodeLegacy.startsWith(targetLegacy)) {
      return true;
    }

    return false;
  });

  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

async function loadProgressiviRows(
  input:
    | { headerId: string; pvId: string; inventoryDate: string }
    | { headerId?: string | null; pvId: string; inventoryDate: string }
): Promise<ProgressivoNormalizedRow[]> {
  const headerId = String(input.headerId ?? "").trim();

  let q = supabaseAdmin
    .from("inventory_progressivi_rows")
    .select("item_code, giacenza_qta1_fiscale");

  if (isUuid(headerId)) {
    q = q.eq("inventory_header_id", headerId);
  } else {
    q = q.eq("pv_id", input.pvId).eq("inventory_date", input.inventoryDate);
  }

  const { data, error } = await q;

  if (error) throw error;

  return ((data ?? []) as ProgressivoRowRaw[])
    .map((row) => ({
      raw_code: String(row.item_code ?? "").trim(),
      normalized_code_legacy: normCode(row.item_code),
      normalized_code_compact: normCodeCompact(row.item_code),
      giacenza_qta1_fiscale: normalizeQty(toExactDecimal(row.giacenza_qta1_fiscale)),
    }))
    .filter((row) => row.normalized_code_legacy || row.normalized_code_compact);
}

async function resolvePreviousHeader(
  currentHeader: HeaderRow,
  categories: LogicalCategory[]
): Promise<{ id: string; inventory_date: string; label: string | null } | null> {
  const currentLogical = resolveLogicalCategory({
    categoryId: currentHeader.category_id,
    label: currentHeader.label,
    categories,
  });

  const currentLogicalKey = buildLogicalCategoryKey({
    categoryId: currentLogical.resolvedCategoryId,
    label: currentLogical.resolvedCategoryId ? null : currentHeader.label,
  });

  const { data, error } = await supabaseAdmin
    .from("inventories_headers")
    .select("id, inventory_date, label, category_id")
    .eq("pv_id", currentHeader.pv_id)
    .lt("inventory_date", currentHeader.inventory_date)
    .order("inventory_date", { ascending: false })
    .limit(100);

  if (error) throw error;

  const candidates = (data ?? []) as PreviousHeaderCandidate[];

  for (const candidate of candidates) {
    const candidateLogical = resolveLogicalCategory({
      categoryId: candidate.category_id,
      label: candidate.label,
      categories,
    });

    const candidateLogicalKey = buildLogicalCategoryKey({
      categoryId: candidateLogical.resolvedCategoryId,
      label: candidateLogical.resolvedCategoryId ? null : candidate.label,
    });

    if (candidateLogicalKey && currentLogicalKey && candidateLogicalKey === currentLogicalKey) {
      return {
        id: String(candidate.id),
        inventory_date: String(candidate.inventory_date),
        label: candidate.label ?? null,
      };
    }

    if (!currentLogicalKey) {
      const sameRawLabel =
        normalizeLogicalCategoryLabel(candidate.label) ===
        normalizeLogicalCategoryLabel(currentHeader.label);

      if (sameRawLabel) {
        return {
          id: String(candidate.id),
          inventory_date: String(candidate.inventory_date),
          label: candidate.label ?? null,
        };
      }
    }
  }

  return null;
}

async function loadRecountedItemCodesForHeader(
  headerId: string | null | undefined
): Promise<Set<string>> {
  const validHeaderId = String(headerId ?? "").trim();
  if (!isUuid(validHeaderId)) return new Set<string>();

  const { data, error } = await supabaseAdmin
    .from("inventory_recount_events")
    .select("item_code")
    .eq("inventory_header_id", validHeaderId);

  if (error) throw error;

  const out = new Set<string>();
  for (const row of data ?? []) {
    const code = normCodeCompact((row as any)?.item_code);
    if (!code) continue;
    out.add(code);
  }

  return out;
}

function resolveUniqueProgressivoValue(
  progressiviRows: ProgressivoNormalizedRow[],
  fullItemCode: string
): number {
  const targetCompact = normCodeCompact(fullItemCode);
  const targetLegacy = normCode(fullItemCode);

  if (!targetCompact && !targetLegacy) return 0;

  const exactCompactMatches = progressiviRows.filter((row) => {
    return !!row.normalized_code_compact && row.normalized_code_compact === targetCompact;
  });

  if (exactCompactMatches.length === 1) {
    return normalizeQty(exactCompactMatches[0].giacenza_qta1_fiscale);
  }

  if (exactCompactMatches.length > 1) return 0;

  const exactLegacyMatches = progressiviRows.filter((row) => {
    return !!row.normalized_code_legacy && row.normalized_code_legacy === targetLegacy;
  });

  if (exactLegacyMatches.length === 1) {
    return normalizeQty(exactLegacyMatches[0].giacenza_qta1_fiscale);
  }

  return 0;
}

function computeTotals(rows: ProgressiviBlockRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.previous.inventario = normalizeQty(acc.previous.inventario + row.previous.inventario);
      acc.previous.giacenza_da_gestionale = normalizeQty(
        acc.previous.giacenza_da_gestionale + row.previous.giacenza_da_gestionale
      );
      acc.previous.carico_non_registrato = normalizeQty(
        acc.previous.carico_non_registrato + row.previous.carico_non_registrato
      );
      acc.previous.giacenza = normalizeQty(acc.previous.giacenza + row.previous.giacenza);
      acc.previous.valore_giacenza = round2(
        acc.previous.valore_giacenza + row.previous.valore_giacenza
      );

      acc.current.inventario = normalizeQty(acc.current.inventario + row.current.inventario);
      acc.current.giacenza_da_gestionale = normalizeQty(
        acc.current.giacenza_da_gestionale + row.current.giacenza_da_gestionale
      );
      acc.current.carico_non_registrato = normalizeQty(
        acc.current.carico_non_registrato + row.current.carico_non_registrato
      );
      acc.current.giacenza = normalizeQty(acc.current.giacenza + row.current.giacenza);
      acc.current.valore_giacenza = round2(
        acc.current.valore_giacenza + row.current.valore_giacenza
      );

      acc.riscontro.differenza = normalizeQty(acc.riscontro.differenza + row.riscontro.differenza);
      acc.riscontro.valore_differenza = round2(
        acc.riscontro.valore_differenza + row.riscontro.valore_differenza
      );

      return acc;
    },
    {
      previous: {
        inventario: 0,
        giacenza_da_gestionale: 0,
        carico_non_registrato: 0,
        giacenza: 0,
        valore_giacenza: 0,
      },
      current: {
        inventario: 0,
        giacenza_da_gestionale: 0,
        carico_non_registrato: 0,
        giacenza: 0,
        valore_giacenza: 0,
      },
      riscontro: {
        differenza: 0,
        valore_differenza: 0,
      },
    }
  );
}

function blockRowToSnapshotInput(
  row: ProgressiviBlockRow,
  isRecounted = false,
  recountSourceHeaderId: string | null = null
) {
  return {
    item_id: row.item_id,
    item_code: row.item_code,
    description: row.description,
    um: row.um,
    prezzo_vendita_eur: row.prezzo_vendita_eur,

    previous_inventario: normalizeQty(row.previous.inventario),
    previous_gestionale: normalizeQty(row.previous.giacenza_da_gestionale),
    previous_carico_non_registrato: normalizeQty(row.previous.carico_non_registrato),
    previous_giacenza: normalizeQty(row.previous.giacenza),
    previous_valore: row.previous.valore_giacenza,

    current_inventario: normalizeQty(row.current.inventario),
    current_gestionale: normalizeQty(row.current.giacenza_da_gestionale),
    current_carico_non_registrato: normalizeQty(row.current.carico_non_registrato),
    current_giacenza: normalizeQty(row.current.giacenza),
    current_valore: row.current.valore_giacenza,

    differenza: normalizeQty(row.riscontro.differenza),
    valore_differenza: row.riscontro.valore_differenza,

    is_recounted: isRecounted,
    recount_source_header_id: recountSourceHeaderId,
    last_recount_at: isRecounted ? new Date().toISOString() : null,
  };
}

function snapshotRowToBlockRow(row: ProgressiviSnapshotRow): ProgressiviBlockRow {
  return {
    item_id: row.item_id,
    item_code: row.item_code,
    description: row.description,
    um: row.um,
    prezzo_vendita_eur: round2(toNum(row.prezzo_vendita_eur)),

    // ✅ QUESTA È LA CHIAVE
    is_recounted: Boolean((row as any).is_recounted),

    previous: {
      inventario: normalizeQty(toNum(row.previous_inventario)),
      giacenza_da_gestionale: normalizeQty(toExactDecimal(row.previous_gestionale)),
      carico_non_registrato: normalizeQty(toNum(row.previous_carico_non_registrato)),
      giacenza: normalizeQty(toNum(row.previous_giacenza)),
      valore_giacenza: round2(toNum(row.previous_valore)),
    },
    current: {
      inventario: normalizeQty(toNum(row.current_inventario)),
      giacenza_da_gestionale: normalizeQty(toExactDecimal(row.current_gestionale)),
      carico_non_registrato: normalizeQty(toNum(row.current_carico_non_registrato)),
      giacenza: normalizeQty(toNum(row.current_giacenza)),
      valore_giacenza: round2(toNum(row.current_valore)),
    },
    riscontro: {
      differenza: normalizeQty(toNum(row.differenza)),
      valore_differenza: round2(toNum(row.valore_differenza)),
    },
  };
}

function rebuildRowWithCurrentGestionale(
  row: ProgressiviBlockRow,
  currentGestionale: number
): ProgressiviBlockRow {
  const normalizedCurrentGestionale = normalizeQty(currentGestionale);
  const currentGiacenza = normalizeQty(
    (row.current.inventario - normalizedCurrentGestionale) - row.current.carico_non_registrato
  );
  const differenza = normalizeQty(currentGiacenza - row.previous.giacenza);

  return {
    ...row,
    current: {
      ...row.current,
      giacenza_da_gestionale: normalizedCurrentGestionale,
      giacenza: currentGiacenza,
      valore_giacenza: round2(row.current.inventario * row.prezzo_vendita_eur),
    },
    riscontro: {
      differenza,
      valore_differenza: round2(differenza * row.prezzo_vendita_eur),
    },
  };
}

async function computeLiveProgressiviData(
  params: ProgressiviReportParams
): Promise<LiveProgressiviComputed> {
  const currentHeader = await resolveCurrentHeader(params);
  const categories = await loadCategories();
  const prevHeader = await resolvePreviousHeader(currentHeader, categories);

  const { data: pvData, error: pvErr } = await supabaseAdmin
    .from("pvs")
    .select("id, code, name")
    .eq("id", currentHeader.pv_id)
    .maybeSingle();

  if (pvErr) throw pvErr;

  const pv = (pvData ?? null) as PvRow | null;

  const currentRows = await loadInventoryRows(currentHeader.id);
  const previousRows = prevHeader ? await loadInventoryRows(prevHeader.id) : [];

  const resolvedCurrentLogicalCategory = resolveLogicalCategory({
    categoryId: currentHeader.category_id,
    label: currentHeader.label,
    categories,
  });

  const allItems = await loadAllItems();

  let universeCodes: string[] = [];
  const universeMap = new Map<string, CategoryUniverseItem>();
  const allItemsMap = new Map<string, CategoryUniverseItem>();

  for (const item of allItems) {
    const compactCode = normCodeCompact(item.code);
    if (!compactCode) continue;
    allItemsMap.set(compactCode, item);
  }

  if (currentHeader.category_id !== null && resolvedCurrentLogicalCategory.resolvedCategoryId) {
    const categoryUniverse = getCategoryItemsUniverse({
      items: allItems,
      resolvedCategoryId: resolvedCurrentLogicalCategory.resolvedCategoryId,
    });

    for (const item of categoryUniverse) {
      const code = normCodeCompact(item.code);
      if (!code) continue;
      universeMap.set(code, item);
    }

    universeCodes = Array.from(universeMap.keys());
  }

  const currentInventoryByResolvedCode = new Map<string, InventoryRowRaw>();
  const previousInventoryByResolvedCode = new Map<string, InventoryRowRaw>();

  for (const universeCode of universeCodes) {
    const currentMatch = resolveUniqueInventoryMatch(currentRows, universeCode);
    if (currentMatch) {
      currentInventoryByResolvedCode.set(universeCode, currentMatch);
    }

    const previousMatch = resolveUniqueInventoryMatch(previousRows, universeCode);
    if (previousMatch) {
      previousInventoryByResolvedCode.set(universeCode, previousMatch);
    }
  }

  const extraCurrentCodes = currentRows
    .map((row) => normCodeCompact(row.items?.code))
    .filter(Boolean) as string[];

  const extraPreviousCodes = previousRows
    .map((row) => normCodeCompact(row.items?.code))
    .filter(Boolean) as string[];

  const [currentProgressiviRows, previousProgressiviRows] = await Promise.all([
    loadProgressiviRows({
      headerId: currentHeader.id,
      pvId: currentHeader.pv_id,
      inventoryDate: currentHeader.inventory_date,
    }),
    prevHeader
      ? loadProgressiviRows({
          headerId: prevHeader.id,
          pvId: currentHeader.pv_id,
          inventoryDate: prevHeader.inventory_date,
        })
      : Promise.resolve([]),
  ]);

  const progressiviCodesCurrent = currentProgressiviRows
    .map((row) => row.normalized_code_compact)
    .filter(Boolean) as string[];

  const progressiviCodesPrevious = previousProgressiviRows
    .map((row) => row.normalized_code_compact)
    .filter(Boolean) as string[];

  const codes = Array.from(
    new Set([
      ...universeCodes,
      ...extraCurrentCodes,
      ...extraPreviousCodes,
      ...progressiviCodesCurrent,
      ...progressiviCodesPrevious,
    ])
  ).sort((a, b) => a.localeCompare(b, "it"));

  const rows: ProgressiviBlockRow[] = codes.map((code) => {
    const cur =
      currentInventoryByResolvedCode.get(code) ??
      currentRows.find((row) => normCodeCompact(row.items?.code) === code) ??
      null;

    const prev =
      previousInventoryByResolvedCode.get(code) ??
      previousRows.find((row) => normCodeCompact(row.items?.code) === code) ??
      null;

    const universeItem = universeMap.get(code) ?? null;
    const anyItem = allItemsMap.get(code) ?? null;
    const base = cur ?? prev;

    const price = round2(
      toNum(
        base?.items?.prezzo_vendita_eur ??
          universeItem?.prezzo_vendita_eur ??
          anyItem?.prezzo_vendita_eur
      )
    );

    const prevInventario = calcInventario(prev);
    const currInventario = calcInventario(cur);

    const progressivoSourceCode = String(
      base?.items?.code ?? universeItem?.code ?? anyItem?.code ?? code
    ).trim();

    const prevGest = resolveUniqueProgressivoValue(
      previousProgressiviRows,
      progressivoSourceCode
    );

    const currGest = resolveUniqueProgressivoValue(
      currentProgressiviRows,
      progressivoSourceCode
    );

    const prevCaricoNonReg = 0;
    const currCaricoNonReg = 0;

    const prevGiacenza = normalizeQty((prevInventario - prevGest) - prevCaricoNonReg);
    const currGiacenza = normalizeQty((currInventario - currGest) - currCaricoNonReg);

    const prevValore = round2(prevInventario * price);
    const currValore = round2(currInventario * price);

    const differenza = normalizeQty(currGiacenza - prevGiacenza);
    const valoreDifferenza = round2(differenza * price);

    return {
      item_id: base?.item_id ?? universeItem?.id ?? anyItem?.id ?? null,
      item_code: String(base?.items?.code ?? universeItem?.code ?? anyItem?.code ?? code).trim(),
      description: String(
        base?.items?.description ?? universeItem?.description ?? anyItem?.description ?? ""
      ).trim(),
      um: (base?.items?.um ?? universeItem?.um ?? anyItem?.um ?? null) as string | null,
      prezzo_vendita_eur: price,
      previous: {
        inventario: prevInventario,
        giacenza_da_gestionale: prevGest,
        carico_non_registrato: prevCaricoNonReg,
        giacenza: prevGiacenza,
        valore_giacenza: prevValore,
      },
      current: {
        inventario: currInventario,
        giacenza_da_gestionale: currGest,
        carico_non_registrato: currCaricoNonReg,
        giacenza: currGiacenza,
        valore_giacenza: currValore,
      },
      riscontro: {
        differenza,
        valore_differenza: valoreDifferenza,
      },
    };
  });

  const pvCode = String(pv?.code ?? "PV");
  const pvName = String(pv?.name ?? "");

  return {
    currentHeader,
    previousHeader: prevHeader,
    pv: {
      id: currentHeader.pv_id,
      code: pvCode,
      name: pvName,
      label: pvName ? `${pvCode} — ${pvName}` : pvCode,
    },
    logicalCategory: resolvedCurrentLogicalCategory,
    rows,
  };
}

export async function getProgressiviReportData(
  params: ProgressiviReportParams
): Promise<ProgressiviReportData> {
  const live = await computeLiveProgressiviData(params);

  const existingSnapshot = await findExistingProgressiviSnapshot({
    pv_id: live.currentHeader.pv_id,
    current_header_id: live.currentHeader.id,
    previous_header_id: live.previousHeader?.id ?? null,
    logical_category_id: live.logicalCategory.resolvedCategoryId,
    label: live.currentHeader.label ?? null,
  });

  let finalRows: ProgressiviBlockRow[] = [];

  const recountedCurrentCodes = await loadRecountedItemCodesForHeader(
    live.currentHeader.id
  );

  if (!existingSnapshot) {
    const created = await createProgressiviSnapshot({
      header: {
        pv_id: live.currentHeader.pv_id,
        current_header_id: live.currentHeader.id,
        previous_header_id: live.previousHeader?.id ?? null,
        inventory_date_current: live.currentHeader.inventory_date,
        inventory_date_previous: live.previousHeader?.inventory_date ?? null,
        category_id: live.currentHeader.category_id,
        subcategory_id: live.currentHeader.subcategory_id,
        label: live.currentHeader.label ?? null,
        logical_category_id: live.logicalCategory.resolvedCategoryId,
        logical_category_name: live.logicalCategory.resolvedCategoryName,
        created_by_username: null,
      },
      rows: live.rows.map((row) =>
        blockRowToSnapshotInput(
          row,
          recountedCurrentCodes.has(normCodeCompact(row.item_code)),
          recountedCurrentCodes.has(normCodeCompact(row.item_code))
            ? live.currentHeader.id
            : null
        )
      ),
    });

    finalRows = created.rows.length > 0 ? created.rows.map(snapshotRowToBlockRow) : live.rows;
  } else {
    const snapshot = await loadProgressiviSnapshot(existingSnapshot.id);

    if (snapshot.rows.length === 0) {
      const { error: deleteRowsError } = await supabaseAdmin
        .from("progressivi_report_rows")
        .delete()
        .eq("report_header_id", existingSnapshot.id);

      if (deleteRowsError) {
        throw new Error(
          `Errore cancellazione righe snapshot vuoto: ${deleteRowsError.message}`
        );
      }

      const { error: deleteHeaderError } = await supabaseAdmin
        .from("progressivi_report_headers")
        .delete()
        .eq("id", existingSnapshot.id);

      if (deleteHeaderError) {
        throw new Error(
          `Errore cancellazione header snapshot vuoto: ${deleteHeaderError.message}`
        );
      }

      const recreated = await createProgressiviSnapshot({
        header: {
          pv_id: live.currentHeader.pv_id,
          current_header_id: live.currentHeader.id,
          previous_header_id: live.previousHeader?.id ?? null,
          inventory_date_current: live.currentHeader.inventory_date,
          inventory_date_previous: live.previousHeader?.inventory_date ?? null,
          category_id: live.currentHeader.category_id,
          subcategory_id: live.currentHeader.subcategory_id,
          label: live.currentHeader.label ?? null,
          logical_category_id: live.logicalCategory.resolvedCategoryId,
          logical_category_name: live.logicalCategory.resolvedCategoryName,
          created_by_username: null,
        },
        rows: live.rows.map((row) =>
          blockRowToSnapshotInput(
            row,
            recountedCurrentCodes.has(normCodeCompact(row.item_code)),
            recountedCurrentCodes.has(normCodeCompact(row.item_code))
              ? live.currentHeader.id
              : null
          )
        ),
      });

      finalRows =
        recreated.rows.length > 0
          ? recreated.rows.map(snapshotRowToBlockRow)
          : live.rows;
    } else {
      const snapshotByCode = new Map<string, ProgressiviBlockRow>();
      for (const snapRow of snapshot.rows) {
        const normalizedCode = normCodeCompact(snapRow.item_code);
        if (!normalizedCode) continue;
        snapshotByCode.set(normalizedCode, snapshotRowToBlockRow(snapRow));
      }

      const mergedRowsMap = new Map<string, ProgressiviBlockRow>();

      for (const liveRow of live.rows) {
        const normalizedCode = normCodeCompact(liveRow.item_code);
        const snapshotRow = snapshotByCode.get(normalizedCode);

        if (!snapshotRow) {
          mergedRowsMap.set(normalizedCode, liveRow);
          continue;
        }

        if (recountedCurrentCodes.has(normalizedCode)) {
          mergedRowsMap.set(normalizedCode, liveRow);
          continue;
        }

        // NON ricontato: mantieni lo snapshot completo, senza toccare la giacenza gestionale
        mergedRowsMap.set(normalizedCode, snapshotRow);
      }

      for (const [normalizedCode, snapshotRow] of snapshotByCode.entries()) {
        if (!mergedRowsMap.has(normalizedCode)) {
          mergedRowsMap.set(normalizedCode, snapshotRow);
        }
      }

      const mergedRows = Array.from(mergedRowsMap.values()).sort((a, b) =>
        a.item_code.localeCompare(b.item_code, "it")
      );

      const replacedRows = await replaceProgressiviSnapshotRows({
        report_header_id: existingSnapshot.id,
        rows: mergedRows.map((row) =>
          blockRowToSnapshotInput(
            row,
            recountedCurrentCodes.has(normCodeCompact(row.item_code)),
            recountedCurrentCodes.has(normCodeCompact(row.item_code))
              ? live.currentHeader.id
              : null
          )
        ),
      });

      finalRows =
        replacedRows.length > 0
          ? replacedRows.map(snapshotRowToBlockRow)
          : mergedRows;
    }
  }

  const totals = computeTotals(finalRows);

  return {
    current_header: live.currentHeader,
    previous_header: live.previousHeader,
    pv: live.pv,
    rows: finalRows,
    totals,
    assumptions: {
      carico_non_registrato:
        "Il campo carico_non_registrato non è salvato nel database. Nel report viene inizializzato a 0 e, se necessario, compilato manualmente solo nel file Excel.",
    },
  };
}