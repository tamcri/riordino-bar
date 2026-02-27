import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function isIsoDate(v: string | null) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function isoToIt(iso: string) {
  if (!iso) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// Excel sheet name: max 31 chars, no []:*?/\
function safeSheetName(name: string) {
  const cleaned = (name || "SENZA_CATEGORIA")
    .replace(/[\[\]\:\*\?\/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned;
  return truncated || "SENZA_CATEGORIA";
}

function normParam(v: string | null) {
  const s = (v ?? "").trim();
  return s;
}

type InvRow = {
  item_id: string;
  inventory_date: string;
  category_id: string | null;
  qty: number | null;
  qty_gr: number | null;
  qty_ml: number | null;
};

type ItemMeta = {
  id: string;
  code: string;
  description: string;
  prezzo_vendita_eur: number | null;
  category_id: string | null;
  um?: string | null;
  peso_kg?: number | null;
  volume_ml_per_unit?: number | null;
};

function computeValueEUR(r: { qty: number; qty_gr: number; qty_ml: number }, it: ItemMeta | null) {
  const price = Number(it?.prezzo_vendita_eur ?? 0);
  if (!Number.isFinite(price) || price <= 0) return 0;

  const ml = Number(r.qty_ml || 0);
  const gr = Number(r.qty_gr || 0);
  const pz = Number(r.qty || 0);

  // stessa regola usata altrove nel progetto: ml > gr > pz
  if (ml > 0) {
    const perUnit = Number(it?.volume_ml_per_unit ?? 0);
    if (!Number.isFinite(perUnit) || perUnit <= 0) return 0;
    return (ml / perUnit) * price;
  }

  if (gr > 0) {
    const um = String(it?.um ?? "").trim().toLowerCase();
    if (um === "kg") return (gr / 1000) * price;

    const pesoKg = Number(it?.peso_kg ?? 0);
    if (Number.isFinite(pesoKg) && pesoKg > 0) {
      const grPerUnit = pesoKg * 1000;
      if (grPerUnit > 0) return (gr / grPerUnit) * price;
    }
    return 0;
  }

  if (pz > 0) return pz * price;
  return 0;
}

function matchCategory(requested: string, invCategoryId: string | null, itemCategoryId: string | null) {
  // requested:
  // "" => tutte (incluse null)
  // "__NULL__" => solo inventory.category_id NULL
  // uuid => match su inventory.category_id OR item.category_id (perché da te Tabacchi a volte è NULL)
  if (!requested) return true;

  if (requested === "__NULL__") {
    return invCategoryId === null;
  }

  if (isUuid(requested)) {
    return invCategoryId === requested || itemCategoryId === requested;
  }

  // fallback: se arriva qualcosa di strano, non filtro
  return true;
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  const pv_id = normParam(url.searchParams.get("pv_id"));
  const category_id = normParam(url.searchParams.get("category_id")); // "" | "__NULL__" | uuid
  const item_id = normParam(url.searchParams.get("item_id"));
  const date_from = normParam(url.searchParams.get("date_from"));
  const date_to = normParam(url.searchParams.get("date_to"));

  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  if (!isIsoDate(date_from) || !isIsoDate(date_to))
    return NextResponse.json({ ok: false, error: "date_from/date_to non valide" }, { status: 400 });

  // 1) Inventories nel periodo (NON filtro qui per category_id, perché spesso Tabacchi è salvata con category_id NULL)
  let q = supabaseAdmin
    .from("inventories")
    .select("item_id, inventory_date, category_id, qty, qty_gr, qty_ml")
    .eq("pv_id", pv_id)
    .gte("inventory_date", date_from)
    .lte("inventory_date", date_to)
    .order("inventory_date", { ascending: true });

  if (item_id && isUuid(item_id)) q = q.eq("item_id", item_id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const invRowsAll = (data || []) as InvRow[];

  // 2) item map
  const itemIds = Array.from(new Set(invRowsAll.map((r) => String(r.item_id || "").trim()).filter((id) => isUuid(id))));
  const itemsMap = new Map<string, ItemMeta>();

  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("items")
      .select("id, code, description, prezzo_vendita_eur, category_id, um, peso_kg, volume_ml_per_unit")
      .in("id", itemIds);

    if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

    for (const it of (items || []) as any[]) {
      const id = String(it?.id ?? "").trim();
      if (!isUuid(id)) continue;
      itemsMap.set(id, {
        id,
        code: String(it?.code ?? ""),
        description: String(it?.description ?? ""),
        prezzo_vendita_eur: it?.prezzo_vendita_eur ?? null,
        category_id: it?.category_id ? String(it.category_id) : null,
        um: it?.um ?? null,
        peso_kg: it?.peso_kg ?? null,
        volume_ml_per_unit: it?.volume_ml_per_unit ?? null,
      });
    }
  }

  // 3) categories map
  const catIds = Array.from(
    new Set(
      Array.from(itemsMap.values())
        .map((x) => x.category_id)
        .filter((x): x is string => !!x && isUuid(x))
    )
  );

  const categoriesMap = new Map<string, string>();
  if (catIds.length > 0) {
    const { data: cats, error: catsErr } = await supabaseAdmin.from("categories").select("id, name").in("id", catIds);
    if (catsErr) return NextResponse.json({ ok: false, error: catsErr.message }, { status: 500 });

    for (const c of (cats || []) as any[]) {
      const id = String(c?.id ?? "").trim();
      const name = String(c?.name ?? "").trim();
      if (isUuid(id) && name) categoriesMap.set(id, name);
    }
  }

  // 4) filtro categoria "logica" (inv.category_id OR item.category_id)
  const invRows = invRowsAll.filter((r) => {
    const it = itemsMap.get(String(r.item_id || "").trim()) || null;
    return matchCategory(category_id, r.category_id ?? null, it?.category_id ?? null);
  });

  // 5) grouping fogli
  // - se category_id è uuid o "__NULL__" => 1 foglio unico
  // - se category_id è "" => più fogli, uno per categoria item (come storico inventario)
  type GroupKey = { key: string; label: string };

  function groupKeyForRow(r: InvRow): GroupKey {
    const it = itemsMap.get(String(r.item_id || "").trim()) || null;
    const itemCatId = it?.category_id ?? null;
    const itemCatName = itemCatId ? categoriesMap.get(itemCatId) : null;

    if (category_id === "__NULL__") return { key: "__NULL__", label: "SENZA_CATEGORIA_INV" };
    if (isUuid(category_id)) return { key: category_id, label: categoriesMap.get(category_id) || "CATEGORIA" };

    // tutte: splitta per categoria item
    return { key: itemCatId || "__NO_CAT__", label: itemCatName || "SENZA_CATEGORIA" };
  }

  const groups = new Map<string, { label: string; rows: InvRow[] }>();
  for (const r of invRows) {
    const gk = groupKeyForRow(r);
    const g = groups.get(gk.key);
    if (!g) groups.set(gk.key, { label: gk.label, rows: [r] });
    else g.rows.push(r);
  }

  // ordinamento fogli: alfabetico, SENZA_CATEGORIA per ultimo
  const groupEntries = Array.from(groups.entries()).sort((a, b) => {
    const an = a[1].label.toLowerCase();
    const bn = b[1].label.toLowerCase();
    if (an === "senza_categoria") return 1;
    if (bn === "senza_categoria") return -1;
    return an.localeCompare(bn);
  });

  // 6) Excel
  const wb = new ExcelJS.Workbook();
  wb.creator = "riordino-bar";
  wb.created = new Date();

  // SOMMARIO
  const wsSum = wb.addWorksheet("SOMMARIO");
  wsSum.columns = [
    { header: "Categoria", key: "cat", width: 30 },
    { header: "Righe", key: "rows", width: 10 },
    { header: "Tot PZ", key: "pz", width: 12 },
    { header: "Tot GR", key: "gr", width: 12 },
    { header: "Tot ML", key: "ml", width: 12 },
    { header: "Tot Valore €", key: "val", width: 18 },
  ];
  wsSum.getRow(1).font = { bold: true };
  wsSum.getColumn("val").numFmt = "€ #,##0.00";

  for (const [, g] of groupEntries) {
    let totPz = 0;
    let totGr = 0;
    let totMl = 0;
    let totVal = 0;

    for (const r of g.rows) {
      const pz = Number(r.qty || 0) || 0;
      const gr = Number(r.qty_gr || 0) || 0;
      const ml = Number(r.qty_ml || 0) || 0;
      totPz += pz;
      totGr += gr;
      totMl += ml;

      const it = itemsMap.get(String(r.item_id || "").trim()) || null;
      totVal += computeValueEUR({ qty: pz, qty_gr: gr, qty_ml: ml }, it);
    }

    wsSum.addRow({
      cat: g.label,
      rows: g.rows.length,
      pz: totPz,
      gr: totGr,
      ml: totMl,
      val: totVal,
    });
  }

  function buildTimelineSheet(label: string, rows: InvRow[]) {
    const ws = wb.addWorksheet(safeSheetName(label));

    ws.columns = [
      { header: "Data", key: "date", width: 14 },
      { header: "Codice", key: "code", width: 18 },
      { header: "Descrizione", key: "description", width: 45 },

      { header: "PZ", key: "pz", width: 10 },
      { header: "Δ PZ", key: "dpz", width: 10 },

      { header: "GR", key: "gr", width: 10 },
      { header: "Δ GR", key: "dgr", width: 10 },

      { header: "ML", key: "ml", width: 10 },
      { header: "Δ ML", key: "dml", width: 10 },

      { header: "Valore €", key: "value", width: 15 },
      { header: "Δ Valore €", key: "dvalue", width: 15 },
    ];

    ws.getRow(1).font = { bold: true };

    ws.getColumn("pz").numFmt = "0";
    ws.getColumn("dpz").numFmt = "0";
    ws.getColumn("gr").numFmt = "0";
    ws.getColumn("dgr").numFmt = "0";
    ws.getColumn("ml").numFmt = "0";
    ws.getColumn("dml").numFmt = "0";
    ws.getColumn("value").numFmt = "€ #,##0.00";
    ws.getColumn("dvalue").numFmt = "€ #,##0.00";

    // delta per item
    const lastByItem = new Map<string, { pz: number; gr: number; ml: number; value: number }>();

    let totalPz = 0;
    let totalGr = 0;
    let totalMl = 0;
    let totalValue = 0;

    let totalDeltaPz = 0;
    let totalDeltaGr = 0;
    let totalDeltaMl = 0;
    let totalDeltaValue = 0;

    // ordine: data poi codice
    const sorted = rows.slice().sort((a, b) => {
      const da = String(a.inventory_date || "");
      const db = String(b.inventory_date || "");
      if (da !== db) return da.localeCompare(db);

      const ita = itemsMap.get(String(a.item_id || "").trim());
      const itb = itemsMap.get(String(b.item_id || "").trim());
      return String(ita?.code ?? "").localeCompare(String(itb?.code ?? ""));
    });

    for (const r of sorted) {
      const itemId = String(r.item_id || "");
      const it = itemsMap.get(itemId) || null;

      const pz = Number(r.qty || 0) || 0;
      const gr = Number(r.qty_gr || 0) || 0;
      const ml = Number(r.qty_ml || 0) || 0;
      const value = computeValueEUR({ qty: pz, qty_gr: gr, qty_ml: ml }, it);

      const prev = itemId ? lastByItem.get(itemId) : undefined;

      const dpz = prev ? pz - prev.pz : 0;
      const dgr = prev ? gr - prev.gr : 0;
      const dml = prev ? ml - prev.ml : 0;
      const dvalue = prev ? value - prev.value : 0;

      if (itemId) lastByItem.set(itemId, { pz, gr, ml, value });

      totalPz += pz;
      totalGr += gr;
      totalMl += ml;
      totalValue += value;

      if (prev) {
        totalDeltaPz += dpz;
        totalDeltaGr += dgr;
        totalDeltaMl += dml;
        totalDeltaValue += dvalue;
      }

      ws.addRow({
        date: isoToIt(r.inventory_date),
        code: it?.code ?? "",
        description: it?.description ?? "",
        pz: pz || "",
        dpz: prev ? dpz : "",
        gr: gr || "",
        dgr: prev ? dgr : "",
        ml: ml || "",
        dml: prev ? dml : "",
        value,
        dvalue: prev ? dvalue : "",
      });
    }

    const totalRow = ws.addRow({
      date: "",
      code: "",
      description: "TOTALE",
      pz: totalPz,
      dpz: totalDeltaPz,
      gr: totalGr,
      dgr: totalDeltaGr,
      ml: totalMl,
      dml: totalDeltaMl,
      value: totalValue,
      dvalue: totalDeltaValue,
    });
    totalRow.font = { bold: true };
  }

  // creo i fogli
  for (const [, g] of groupEntries) {
    buildTimelineSheet(g.label, g.rows);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `timeline_giacenze_${date_from}_${date_to}.xlsx`;

  return new NextResponse(new Uint8Array(buffer as any), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}


