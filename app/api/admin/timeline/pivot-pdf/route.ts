// app/api/admin/timeline/pivot-pdf/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  return !!v && /^[0-9a-f-]{36}$/i.test(v.trim());
}

function isIsoDate(v: string | null) {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
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

export async function GET(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const pv_id = url.searchParams.get("pv_id");
  const category_id = url.searchParams.get("category_id");
  const date_from = url.searchParams.get("date_from");
  const date_to = url.searchParams.get("date_to");

  if (!isUuid(pv_id)) return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
  if (!isUuid(category_id)) return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
  if (!isIsoDate(date_from) || !isIsoDate(date_to)) {
    return NextResponse.json({ ok: false, error: "date non valide (YYYY-MM-DD)" }, { status: 400 });
  }

  // 1) righe inventari nel periodo
  const { data, error } = await supabaseAdmin
    .from("inventories")
    .select(
      `
      inventory_date,
      qty,
      items:items(code, description)
    `
    )
    .eq("pv_id", pv_id)
    .eq("category_id", category_id)
    .gte("inventory_date", date_from)
    .lte("inventory_date", date_to);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data || []) as any[];

  // 2) date ordinate
  const dates = Array.from(new Set(rows.map((r) => r.inventory_date))).sort();

  // 3) pivot
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const code = r?.items?.code ?? "";
    const description = r?.items?.description ?? "";
    if (!code && !description) continue;

    const key = `${code}|||${description}`;
    if (!map[key]) map[key] = {};
    map[key][r.inventory_date] = Number(r.qty || 0);
  }

  // 4) HTML
  let html = `
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
    <h2>Timeline Giacenze (Pivot + Δ)</h2>
    <p>Periodo: ${isoToIt(date_from!)} - ${isoToIt(date_to!)}</p>

    <table>
      <tr>
        <th>Codice</th>
        <th>Descrizione</th>
        ${dates.map((d) => `<th>${isoToIt(d)}</th>`).join("")}
        ${dates.slice(1).map((d) => `<th>Δ ${isoToIt(d)}</th>`).join("")}
      </tr>
  `;

  const keys = Object.keys(map).sort((a, b) => a.localeCompare(b));

  for (const key of keys) {
    const [code, description] = key.split("|||");
    const values = dates.map((d) => map[key][d] ?? 0);

    html += `<tr>`;
    html += `<td>${escapeHtml(code)}</td>`;
    html += `<td class="left">${escapeHtml(description)}</td>`;

    // qty per data
    for (const v of values) {
      html += `<td>${Number(v)}</td>`;
    }

    // delta
    for (let i = 1; i < values.length; i++) {
      const delta = Number(values[i]) - Number(values[i - 1]);
      const cls = delta < 0 ? "neg" : delta > 0 ? "pos" : "zero";
      html += `<td class="${cls}">${delta}</td>`;
    }

    html += `</tr>`;
  }

  html += `
    </table>
  </body>
  </html>
  `;

  // 5) puppeteer: serverless vs locale
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  // NB: in locale serve "puppeteer" installato (tu lo hai in devDependencies)
  const puppeteerMod = isServerless ? await import("puppeteer-core") : await import("puppeteer");
  const puppeteer: any = (puppeteerMod as any).default ?? puppeteerMod;

  let browser: any = null;

  try {
    if (isServerless) {
      const chromiumMod = await import("@sparticuz/chromium");
      const chromium: any = (chromiumMod as any).default ?? chromiumMod;

      // ✅ cast a any: evita rogne TS su defaultViewport/headless/ignoreHTTPSErrors
      const launchOptions: any = {
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
        ignoreHTTPSErrors: true,
        defaultViewport: chromium.defaultViewport,
      };

      browser = await puppeteer.launch(launchOptions);
    } else {
      // Locale: puppeteer gestisce Chrome/Chromium
      browser = await puppeteer.launch({
        headless: "new",
      } as any);
    }

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    const pdfBytes = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
    });

    // ✅ Buffer: evita problemi con NextResponse su alcuni runtime
    const body = Buffer.from(pdfBytes);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="timeline_pivot_${date_from}_${date_to}.pdf"`,
        "cache-control": "no-store",
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






