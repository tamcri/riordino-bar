// app/api/inventories/compare/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildInventoryCompareXlsx,
  parseGestionaleXlsx,
  buildCompareLines,
} from "@/lib/excel/inventoryCompare";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function isIsoDate(v: string | null) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function normNullParam(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  if (s.toLowerCase() === "undefined") return null;
  return s;
}

function normUuidParam(v: any): string | null {
  const s = normNullParam(v);
  if (!s) return null;
  return isUuid(s) ? s : null;
}

function normCode(v: any) {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const firstToken = raw.split(/\s+/)[0] || "";
  return firstToken.trim().toUpperCase().replace(/\s+/g, "");
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Richiesta non valida (form-data mancante)" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  const inventory_header_id = normUuidParam(form.get("inventory_header_id"));
  const pv_id = String(form.get("pv_id") ?? "").trim();

  const category_id = normNullParam(form.get("category_id"));
  const subcategory_id = normNullParam(form.get("subcategory_id"));
  const inventory_date = String(form.get("inventory_date") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "File Excel mancante (campo 'file')" },
      { status: 400 }
    );
  }

  if (!isUuid(pv_id)) {
    return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  }

  if (category_id !== null && !isUuid(category_id)) {
    return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  }

  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }

  if (!isIsoDate(inventory_date)) {
    return NextResponse.json(
      { ok: false, error: "inventory_date non valida (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const isRapid = category_id === null;

  let gestionaleMap: Map<string, number>;
  let gestionaleDescMap: Map<string, string>;

  try {
    const ab = await file.arrayBuffer();
    const parsedGestionale = await parseGestionaleXlsx(ab);
    gestionaleMap = parsedGestionale.qtyMap;
    gestionaleDescMap = parsedGestionale.descMap;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura Excel gestionale" },
      { status: 400 }
    );
  }

  const pvRes = await supabaseAdmin
    .from("pvs")
    .select("id, code, name")
    .eq("id", pv_id)
    .maybeSingle();

  if (pvRes.error) {
    return NextResponse.json({ ok: false, error: pvRes.error.message }, { status: 500 });
  }

  let categoryName = "Tutte";

  if (!isRapid && category_id) {
    const catRes = await supabaseAdmin
      .from("categories")
      .select("id, name")
      .eq("id", category_id)
      .maybeSingle();

    if (catRes.error) {
      return NextResponse.json({ ok: false, error: catRes.error.message }, { status: 500 });
    }

    categoryName = catRes.data?.name ?? "";
  }

  let subcategoryName = "—";

  if (subcategory_id) {
    const subRes = await supabaseAdmin
      .from("subcategories")
      .select("id, name")
      .eq("id", subcategory_id)
      .maybeSingle();

    if (subRes.error) {
      return NextResponse.json({ ok: false, error: subRes.error.message }, { status: 500 });
    }

    subcategoryName = subRes.data?.name ?? "";
  }

  const pvLabel = pvRes.data ? `${pvRes.data.code} — ${pvRes.data.name}` : pv_id;

  let currentHeader: any = null;

  if (inventory_header_id !== null) {
    const { data: headerById, error: headerByIdErr } = await supabaseAdmin
      .from("inventories_headers")
      .select("id, operatore, category_id, subcategory_id, rapid_session_id, label")
      .eq("id", inventory_header_id)
      .maybeSingle();

    if (headerByIdErr) {
      return NextResponse.json({ ok: false, error: headerByIdErr.message }, { status: 500 });
    }

    currentHeader = headerById ?? null;
  }

  if (!currentHeader) {
    let hq = supabaseAdmin
      .from("inventories_headers")
      .select("id, operatore, category_id, subcategory_id, rapid_session_id, label")
      .eq("pv_id", pv_id)
      .eq("inventory_date", inventory_date);

    if (!isRapid && category_id) hq = hq.eq("category_id", category_id);
    else hq = hq.is("category_id", null);

    if (!isRapid) {
      if (subcategory_id) hq = hq.eq("subcategory_id", subcategory_id);
      else hq = hq.is("subcategory_id", null);

      hq = hq.is("rapid_session_id", null);
    }

    const { data: headers, error: headerErr } = await hq
      .order("updated_at", { ascending: false })
      .limit(1);

    if (headerErr) {
      return NextResponse.json({ ok: false, error: headerErr.message }, { status: 500 });
    }

    currentHeader = (headers?.[0] as any) ?? null;
  }

  const operatore = String(currentHeader?.operatore ?? "").trim() || "—";

  const currentHeaderCategoryId = (currentHeader?.category_id ?? null) as string | null;
  const currentHeaderSubcategoryId = (currentHeader?.subcategory_id ?? null) as string | null;
  const currentHeaderRapidSessionId = (currentHeader?.rapid_session_id ?? null) as string | null;
  const currentHeaderLabel = String(currentHeader?.label ?? "").trim();

  if (isRapid && currentHeaderLabel) {
    categoryName = currentHeaderLabel;
  }

  let q = supabaseAdmin
    .from("inventories")
    .select(`
      item_id,
      qty,
      qty_gr,
      qty_ml,
      rapid_session_id,
      category_id,
      subcategory_id,
      items:items!left(
        code,
        description,
        prezzo_vendita_eur,
        volume_ml_per_unit,
        category_id,
        subcategory_id,
        categories:categories(name),
        subcategories:subcategories(name)
      )
    `)
    .eq("pv_id", pv_id)
    .eq("inventory_date", inventory_date);

  if (isRapid) {
    q = q.is("category_id", null);

    if (currentHeaderRapidSessionId) {
      q = q.or(`rapid_session_id.eq.${currentHeaderRapidSessionId},rapid_session_id.is.null`);
    } else {
      q = q.is("rapid_session_id", null);
    }

    // Importante: in rapido NON filtro subcategory_id.
  } else {
    const effectiveCategoryId = currentHeaderCategoryId ?? category_id;
    const effectiveSubcategoryId = currentHeaderSubcategoryId ?? subcategory_id;

    if (effectiveCategoryId) q = q.eq("category_id", effectiveCategoryId);

    if (effectiveSubcategoryId) q = q.eq("subcategory_id", effectiveSubcategoryId);
    else q = q.is("subcategory_id", null);

    q = q.is("rapid_session_id", null);
  }

  const { data: invRows, error: invErr } = await q;

  if (invErr) {
    return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });
  }

  let inventoryLines = ((invRows || []) as any[]).map((r: any) => ({
    item_id: String(r?.item_id ?? ""),
    code: r?.items?.code ?? "",
    description: r?.items?.description ?? "",
    qty: Number(r?.qty ?? 0),
    qty_gr: Number(r?.qty_gr ?? 0),
    qty_ml: Number(r?.qty_ml ?? 0),
    prezzo_vendita_eur: r?.items?.prezzo_vendita_eur ?? null,
    volume_ml_per_unit: r?.items?.volume_ml_per_unit ?? null,
    category_name: r?.items?.categories?.name ?? null,
    subcategory_name: r?.items?.subcategories?.name ?? null,
  }));

  const { data: allItems, error: allItemsErr } = await supabaseAdmin
    .from("items")
    .select("code, prezzo_vendita_eur");

  if (allItemsErr) {
    return NextResponse.json({ ok: false, error: allItemsErr.message }, { status: 500 });
  }

  const priceMap = new Map<string, number>();

  for (const item of allItems ?? []) {
    const code = normCode((item as any)?.code);
    if (!code) continue;

    const prezzo = (item as any)?.prezzo_vendita_eur;
    if (prezzo === null || prezzo === undefined || prezzo === "") continue;

    priceMap.set(code, Number(prezzo));
  }

  if (isRapid) {
    const gestionaleCodes = new Set(Array.from(gestionaleMap.keys()).map(normCode));

    inventoryLines = inventoryLines.filter((l) => {
      const codeNorm = normCode(l.code);
      if (!codeNorm) return false;
      return gestionaleCodes.has(codeNorm);
    });
  }

  const normalizedInventoryLabel = currentHeaderLabel.toLowerCase().trim();
  const normalizedCategoryName = String(categoryName || "").toLowerCase().trim();

  const isTabacchi =
    normalizedInventoryLabel.includes("tabacc") ||
    normalizedCategoryName.includes("tabacc");

  const isGrattaEVinci =
    normalizedInventoryLabel.includes("gratta e vinci") ||
    normalizedInventoryLabel.includes("gratta&vinci") ||
    normalizedInventoryLabel.includes("grattaevinci") ||
    normalizedCategoryName.includes("gratta e vinci") ||
    normalizedCategoryName.includes("gratta&vinci") ||
    normalizedCategoryName.includes("grattaevinci");

  const isFullCompareCategory = isTabacchi || isGrattaEVinci;

  const compareLines = isFullCompareCategory
    ? buildCompareLines(inventoryLines, gestionaleMap, {
        descMap: gestionaleDescMap,
        priceMap,
      })
    : buildCompareLines(inventoryLines, gestionaleMap, {
        onlyInventory: true,
        descMap: gestionaleDescMap,
        priceMap,
      });

  const xlsx = await buildInventoryCompareXlsx(
    {
      inventoryDate: inventory_date,
      operatore,
      pvLabel,
      categoryName,
      subcategoryName,
    },
    compareLines
  );

  const filename = `confronto_inventario_${pvRes.data?.code ?? "PV"}_${inventory_date}.xlsx`;
  const bytes = new Uint8Array(xlsx);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}