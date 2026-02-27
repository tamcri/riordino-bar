// app/api/admin/timeline/pivot-pdf/route.ts
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

function isoToIt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function escapeHtml(s: string) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  category_id: string | null;
};

function pickQtyAndUnit(r: { qty: number; qty_gr: number; qty_ml: number }) {
  const ml = Number(r.qty_ml || 0);
  const gr = Number(r.qty_gr || 0);
  const pz = Number(r.qty || 0);

  if (ml > 0) return { qty: ml, unit: "ML" };
  if (gr > 0) return { qty: gr, unit: "GR" };
  return { qty: pz, unit: "PZ" };
}

function matchCategory(requested: string, invCategoryId: string | null, itemCategoryId: string | null) {
  if (!requested) return true;
  if (requested === "__NULL__") return invCategoryId === null;
  if (isUuid(requested)) return invCategoryId === requested || itemCategoryId === requested;
  return true;
}

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const pv_id = (url.searchParams.get("pv_id") || "").trim();
  const category_id = (url.searchParams.get("category_id") || "").trim(); // "" | "__NULL__" | uuid
  const date_from = (url.searchParams.get("date_from") || "").trim();
  const date_to = (url.searchParams.get("date_to") || "").trim();

  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  if (!isIsoDate(date_from) || !isIsoDate(date_to)) {
    return NextResponse.json({ ok: false, error: "date non valide (YYYY-MM-DD)" }, { status: 400 });
  }

  // 1) righe inventari nel periodo (non filtro per category_id in SQL)
  const { data, error } = await supabaseAdmin
    .from("inventories")
    .select("item_id, inventory_date, category_id, qty, qty_gr, qty_ml")
    .eq("pv_id", pv_id)
    .gte("inventory_date", date_from)
    .lte("inventory_date", date_to);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const invAll = (data || []) as InvRow[];

  // 2) items + categories
  const itemIds = Array.from(new Set(invAll.map((r) => String(r.item_id || "")).filter((id) => isUuid(id))));
  const itemsMap = new Map<string, ItemMeta>();

  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("items")
      .select("id, code, description, category_id")
      .in("id", itemIds);

    if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

    for (const it of (items || []) as any[]) {
      const id = String(it?.id ?? "").trim();
      if (!isUuid(id)) continue;
      itemsMap.set(id, {
        id,
        code: String(it?.code ?? ""),
        description: String(it?.description ?? ""),
        category_id: it?.category_id ? String(it.category_id) : null,
      });
    }
  }

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

  // 3) filtro categoria logica
  const inv = invAll.filter((r) => {
    const it = itemsMap.get(String(r.item_id || "").trim()) || null;
    return matchCategory(category_id, r.category_id ?? null, it?.category_id ?? null);
  });

  // 4) grouping sezioni (solo se "tutte")
  function sectionLabelForRow(r: InvRow) {
    if (category_id === "__NULL__") return "SENZA_CATEGORIA_INV";
    if (isUuid(category_id)) return categoriesMap.get(category_id) || "CATEGORIA";

    const it = itemsMap.get(String(r.item_id || "").trim()) || null;
    const itemCatId = it?.category_id ?? null;
    return itemCatId ? categoriesMap.get(itemCatId) || "CATEGORIA" : "SENZA_CATEGORIA";
  }

  const sections = new Map<string, { label: string; rows: InvRow[] }>();
  for (const r of inv) {
    const label = sectionLabelForRow(r);
    const key = label; // ok come key per PDF
    const s = sections.get(key);
    if (!s) sections.set(key, { label, rows: [r] });
    else s.rows.push(r);
  }

  const sectionList = Array.from(sections.values()).sort((a, b) => a.label.localeCompare(b.label));

  // 5) build HTML per sezione
  function buildSectionHtml(label: string, rows: InvRow[]) {
    const rowsWithItem = rows
      .map((r) => {
        const it = itemsMap.get(String(r.item_id || "").trim()) || null;
        return { r, it };
      })
      .filter((x) => x.it && (x.it.code || x.it.description));

    const dates = Array.from(new Set(rowsWithItem.map((x) => x.r.inventory_date))).sort();

    // map per item
    const map: Record<string, { code: string; description: string; unit: string; byDate: Record<string, number> }> = {};

    for (const x of rowsWithItem) {
      const key = x.it!.id;
      const picked = pickQtyAndUnit({
        qty: Number(x.r.qty || 0),
        qty_gr: Number(x.r.qty_gr || 0),
        qty_ml: Number(x.r.qty_ml || 0),
      });

      if (!map[key]) {
        map[key] = {
          code: x.it!.code,
          description: x.it!.description,
          unit: picked.unit,
          byDate: {},
        };
      }

      // NB: se un item in giorni diversi cambia unità (rare), mantengo la prima unità trovata
      map[key].byDate[x.r.inventory_date] = picked.qty;
    }

    const keys = Object.keys(map).sort((a, b) => map[a].code.localeCompare(map[b].code));

    let html = `
      <div class="section">
        <h2>${escapeHtml(label)}</h2>
        <p>Periodo: ${isoToIt(date_from)} - ${isoToIt(date_to)}</p>

        <table>
          <tr>
            <th>Codice</th>
            <th>Descrizione</th>
            <th>UM</th>
            ${dates.map((d) => `<th>${isoToIt(d)}</th>`).join("")}
            ${dates.slice(1).map((d) => `<th>Δ ${isoToIt(d)}</th>`).join("")}
          </tr>
    `;

    for (const k of keys) {
      const row = map[k];
      const values = dates.map((d) => row.byDate[d] ?? 0);

      html += `<tr>`;
      html += `<td>${escapeHtml(row.code)}</td>`;
      html += `<td class="left">${escapeHtml(row.description)}</td>`;
      html += `<td>${escapeHtml(row.unit)}</td>`;

      for (const v of values) html += `<td>${Number(v)}</td>`;

      for (let i = 1; i < values.length; i++) {
        const delta = Number(values[i]) - Number(values[i - 1]);
        const cls = delta < 0 ? "neg" : delta > 0 ? "pos" : "zero";
        html += `<td class="${cls}">${delta}</td>`;
      }

      html += `</tr>`;
    }

    html += `</table></div>`;
    return html;
  }

  const sectionsHtml = sectionList.map((s, idx) => {
    const block = buildSectionHtml(s.label, s.rows);
    if (idx === 0) return block;
    return `<div style="page-break-before: always;"></div>${block}`;
  });

  const html = `
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
      h2 { margin: 0 0 6px 0; }
      p { margin: 0 0 10px 0; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ccc; padding: 4px; text-align: center; }
      th { background: #f0f0f0; }
      td.left { text-align: left; }
      .neg { color: #b91c1c; font-weight: 700; }
      .pos { color: #047857; font-weight: 700; }
      .zero { color: #111827; }
      @page { size: A4 landscape; margin: 10mm; }
    </style>
  </head>
  <body>
    <h1 style="margin:0 0 8px 0;">Timeline Giacenze (Pivot + Δ)</h1>
    ${sectionsHtml.join("\n")}
  </body>
  </html>
  `;

  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const puppeteerMod = isServerless ? await import("puppeteer-core") : await import("puppeteer");
  const puppeteer: any = (puppeteerMod as any).default ?? puppeteerMod;

  let browser: any = null;

  try {
    if (isServerless) {
      const chromiumMod = await import("@sparticuz/chromium");
      const chromium: any = (chromiumMod as any).default ?? chromiumMod;

      const launchOptions: any = {
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
        ignoreHTTPSErrors: true,
        defaultViewport: chromium.defaultViewport,
      };

      browser = await puppeteer.launch(launchOptions);
    } else {
      browser = await puppeteer.launch({ headless: "new" } as any);
    }

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBytes = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
    });

    const body = Buffer.from(pdfBytes);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="timeline_pivot_${date_from}_${date_to}.pdf"`,
        "cache-control": "no-store",
        "content-length": String(body.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Errore generazione PDF pivot" }, { status: 500 });
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
  }
}






