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
  const category_id = String(form.get("category_id") ?? "").trim();
  const subcategory_id = String(form.get("subcategory_id") ?? "").trim();
  const inventory_date = String(form.get("inventory_date") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "File Excel mancante (campo 'file')" },
      { status: 400 }
    );
  }

  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  if (!isUuid(category_id)) return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  if (subcategory_id && !isUuid(subcategory_id)) {
    return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
  }
  if (!isIsoDate(inventory_date)) {
    return NextResponse.json(
      { ok: false, error: "inventory_date non valida (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

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
  const [pvRes, catRes, subRes] = await Promise.all([
    supabaseAdmin.from("pvs").select("id, code, name").eq("id", pv_id).maybeSingle(),
    supabaseAdmin.from("categories").select("id, name").eq("id", category_id).maybeSingle(),
    subcategory_id
      ? supabaseAdmin.from("subcategories").select("id, name").eq("id", subcategory_id).maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
  ]);

  if (pvRes.error) return NextResponse.json({ ok: false, error: pvRes.error.message }, { status: 500 });
  if (catRes.error) return NextResponse.json({ ok: false, error: catRes.error.message }, { status: 500 });
  if (subRes?.error) return NextResponse.json({ ok: false, error: subRes.error.message }, { status: 500 });

  const pvLabel = pvRes.data ? `${pvRes.data.code} — ${pvRes.data.name}` : pv_id;
  const categoryName = catRes.data?.name ?? "";
  const subcategoryName = subcategory_id ? (subRes.data?.name ?? "") : "—";

  // 3) operatore dalla testata
  let hq = supabaseAdmin
    .from("inventories_headers")
    .select("operatore")
    .eq("pv_id", pv_id)
    .eq("category_id", category_id)
    .eq("inventory_date", inventory_date);

  if (subcategory_id) hq = hq.eq("subcategory_id", subcategory_id);
  else hq = hq.is("subcategory_id", null);

  const { data: headers, error: headerErr } = await hq.order("id", { ascending: false }).limit(1);
  if (headerErr) return NextResponse.json({ ok: false, error: headerErr.message }, { status: 500 });

  const operatore = ((headers?.[0] as any)?.operatore || "").toString().trim() || "—";

  // 4) righe inventario + join items (LEFT JOIN)
  let q = supabaseAdmin
    .from("inventories")
    .select("item_id, qty, qty_ml, items:items!left(code, description, prezzo_vendita_eur, volume_ml_per_unit)")
    .eq("pv_id", pv_id)
    .eq("category_id", category_id)
    .eq("inventory_date", inventory_date);

  if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
  else q = q.is("subcategory_id", null);

  const { data: invRows, error: invErr } = await q;
  if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });

  const inventoryLines = ((invRows || []) as any[]).map((r: any) => ({
    item_id: String(r?.item_id ?? ""),
    code: r?.items?.code ?? "",
    description: r?.items?.description ?? "",
    qty: Number(r?.qty ?? 0),
    qty_ml: Number(r?.qty_ml ?? 0),
    prezzo_vendita_eur: r?.items?.prezzo_vendita_eur ?? null,
    volume_ml_per_unit: r?.items?.volume_ml_per_unit ?? null,
  }));

  // 5) confronto
  // ✅ QUI: solo codici presenti in inventario (niente righe “solo gestionale” tipo DIE2)
  const isTabacchi = categoryName.toLowerCase().includes("tabacc");

const compareLines = isTabacchi
  ? buildCompareLines(inventoryLines, gestionaleMap) // confronto completo
  : buildCompareLines(inventoryLines, gestionaleMap, { onlyInventory: true }); // solo inventariati


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













