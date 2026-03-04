import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as XLSX from "xlsx";

import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f-]{36}$/i.test(v.trim());
}

function toNumber(v: any) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function norm(s: any) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  try {
    const c = cookies();
    const session = parseSessionValue(c.get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const form = await req.formData();

    const file = form.get("file") as File | null;
    const pv_id = String(form.get("pv_id") ?? "").trim();
    const inventory_date = String(form.get("inventory_date") ?? "").trim();

    if (!file) {
      return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });
    }

    if (!isUuid(pv_id)) {
      return NextResponse.json({ ok: false, error: "pv_id non valido" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];

    const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];

    let headerRow = -1;

    for (let i = 0; i < Math.min(30, table.length); i++) {
      const line = norm(table[i].join(" "));
      if (line.includes("cod") && line.includes("art")) {
        headerRow = i;
        break;
      }
    }

    if (headerRow < 0) {
      return NextResponse.json({ ok: false, error: "Header non trovato nel file" }, { status: 400 });
    }

    const header = table[headerRow].map((c: any) => norm(c));

    function findCol(name: string) {
      return header.findIndex((h: string) => h.includes(name));
    }

    const iCode = findCol("cod");
    const iCar1 = findCol("tot carico qta1");
    const iSca1 = findCol("tot scarico qta1");
    const iGia1 = findCol("giacenza qta1");

    const iCar2 = findCol("tot carico qta2");
    const iSca2 = findCol("tot scarico qta2");
    const iGia2 = findCol("giacenza qta2");

    if (iCode < 0) {
      return NextResponse.json({ ok: false, error: "Colonna Codice articolo non trovata" }, { status: 400 });
    }

    const rows: any[] = [];

    for (let r = headerRow + 1; r < table.length; r++) {
      const row = table[r];

      const code = String(row[iCode] ?? "").trim();
      if (!code) continue;

      rows.push({
        pv_id,
        inventory_date,
        item_code: code,

        tot_carico_qta1: toNumber(row[iCar1]),
        tot_scarico_qta1: toNumber(row[iSca1]),
        giacenza_fiscale_qta1: toNumber(row[iGia1]),

        tot_carico_qta2: toNumber(row[iCar2]),
        tot_scarico_qta2: toNumber(row[iSca2]),
        giacenza_fiscale_qta2: toNumber(row[iGia2]),
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessuna riga trovata nel file" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("inventory_progressivi_rows")
      .upsert(rows, { onConflict: "pv_id,inventory_date,item_code" });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      rows: rows.length,
    });
  } catch (err: any) {
    console.error("[progressivi upload]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}