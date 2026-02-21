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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function isIsoDate(v: string | null) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

// ✅ interpreta "" / "null" come NULL (Rapido: categoria = Nessuna/Tutte)
function normNullParam(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
}

// ✅ stessa filosofia del gestionale: token 1, uppercase, no spaces
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
  const pv_id = String(form.get("pv_id") ?? "").trim();

  // ✅ Rapido: category_id può essere null (form: omesso, "", "null")
  const category_id = normNullParam(form.get("category_id"));
  // ✅ subcategory: "" / "null" / omesso => null
  const subcategory_id = normNullParam(form.get("subcategory_id"));

  const inventory_date = String(form.get("inventory_date") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "File Excel mancante (campo 'file')" },
      { status: 400 }
    );
  }

  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });

  // ✅ Standard: UUID obbligatorio; Rapido: NULL ammesso
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

  // 1) gestionale
  let gestionaleMap: Map<string, number>;
  try {
    const ab = await file.arrayBuffer();
    gestionaleMap = await parseGestionaleXlsx(ab);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore lettura Excel gestionale" },
      { status: 400 }
    );
  }

  // 2) meta
  const pvRes = await supabaseAdmin.from("pvs").select("id, code, name").eq("id", pv_id).maybeSingle();
  if (pvRes.error) return NextResponse.json({ ok: false, error: pvRes.error.message }, { status: 500 });

  let categoryName = "Tutte";
  if (!isRapid && category_id) {
    const catRes = await supabaseAdmin.from("categories").select("id, name").eq("id", category_id).maybeSingle();
    if (catRes.error) return NextResponse.json({ ok: false, error: catRes.error.message }, { status: 500 });
    categoryName = catRes.data?.name ?? "";
  }

  let subcategoryName = "—";
  if (subcategory_id) {
    const subRes = await supabaseAdmin.from("subcategories").select("id, name").eq("id", subcategory_id).maybeSingle();
    if (subRes.error) return NextResponse.json({ ok: false, error: subRes.error.message }, { status: 500 });
    subcategoryName = subRes.data?.name ?? "";
  }

  const pvLabel = pvRes.data ? `${pvRes.data.code} — ${pvRes.data.name}` : pv_id;

  // 3) operatore dalla testata
  let hq = supabaseAdmin
    .from("inventories_headers")
    .select("operatore")
    .eq("pv_id", pv_id)
    .eq("inventory_date", inventory_date);

  if (!isRapid && category_id) hq = hq.eq("category_id", category_id);
  else hq = hq.is("category_id", null);

  if (subcategory_id) hq = hq.eq("subcategory_id", subcategory_id);
  else hq = hq.is("subcategory_id", null);

  const { data: headers, error: headerErr } = await hq.order("id", { ascending: false }).limit(1);
  if (headerErr) return NextResponse.json({ ok: false, error: headerErr.message }, { status: 500 });

  const operatore = ((headers?.[0] as any)?.operatore || "").toString().trim() || "—";

  // 4) righe inventario + join items (LEFT JOIN)
  // ✅ QUI aggiungo category/subcategory names dagli items, così poi inventoryCompare può creare fogli per gruppo.
  let q = supabaseAdmin
    .from("inventories")
    .select(`
      item_id,
      qty,
      qty_gr,
      qty_ml,
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

  if (!isRapid && category_id) q = q.eq("category_id", category_id);
  else q = q.is("category_id", null);

  if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
  else q = q.is("subcategory_id", null);

  const { data: invRows, error: invErr } = await q;
  if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });

  let inventoryLines = ((invRows || []) as any[]).map((r: any) => ({
    item_id: String(r?.item_id ?? ""),
    code: r?.items?.code ?? "",
    description: r?.items?.description ?? "",
    qty: Number(r?.qty ?? 0),
    qty_gr: Number(r?.qty_gr ?? 0),
    qty_ml: Number(r?.qty_ml ?? 0),
    prezzo_vendita_eur: r?.items?.prezzo_vendita_eur ?? null,
    volume_ml_per_unit: r?.items?.volume_ml_per_unit ?? null,

    // ✅ passiamo i nomi (usati per i fogli extra)
    category_name: r?.items?.categories?.name ?? null,
    subcategory_name: r?.items?.subcategories?.name ?? null,
  }));

  // ✅ RAPIDO (Tutte): vogliamo poter fare PIÙ COMPARAZIONI con file diversi.
  // Quindi teniamo SOLO gli articoli "riconosciuti" dal file gestionale.
  if (isRapid) {
    const gestionaleCodes = new Set(Array.from(gestionaleMap.keys()).map(normCode));

    inventoryLines = inventoryLines.filter((l) => {
      const codeNorm = normCode(l.code);
      if (!codeNorm) return false;
      return gestionaleCodes.has(codeNorm);
    });
  }

  // 5) confronto
  // ✅ Qui: per Tabacchi confronto completo, per gli altri solo inventariati
  const isTabacchi = categoryName.toLowerCase().includes("tabacc");

  const compareLines = isTabacchi
    ? buildCompareLines(inventoryLines, gestionaleMap)
    : buildCompareLines(inventoryLines, gestionaleMap, { onlyInventory: true });

  const xlsx = await buildInventoryCompareXlsx(
    { inventoryDate: inventory_date, operatore, pvLabel, categoryName, subcategoryName },
    compareLines
  );

  const filename = `confronto_inventario_${pvRes.data?.code ?? "PV"}_${inventory_date}.xlsx`;
  const bytes = new Uint8Array(xlsx);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}













