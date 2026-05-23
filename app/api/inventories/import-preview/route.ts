import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normText(v: unknown) {
  return String(v ?? "").trim();
}

function normCode(v: unknown) {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

function toNumber(v: unknown) {
  if (v === null || v === undefined || v === "") return 0;

  const s = String(v)
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function findColumn(row: Record<string, any>, candidates: string[]) {
  const keys = Object.keys(row || {});
  const normalized = keys.map((k) => ({
    original: k,
    normalized: k.trim().toLowerCase(),
  }));

  for (const c of candidates) {
    const target = c.trim().toLowerCase();
    const found = normalized.find((x) => x.normalized === target);
    if (found) return found.original;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "File Excel mancante." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return NextResponse.json(
        { ok: false, error: "Il file Excel non contiene fogli." },
        { status: 400 }
      );
    }

    const sheet = workbook.Sheets[sheetName];

    const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: "",
    });

    if (!rawRows.length) {
      return NextResponse.json(
        { ok: false, error: "Il file Excel non contiene righe." },
        { status: 400 }
      );
    }

    const firstRow = rawRows[0];

    const codeCol = findColumn(firstRow, ["Codice", "Code", "Cod. Articolo", "Articolo"]);
    const descCol = findColumn(firstRow, ["Descrizione", "Description"]);
    const pzCol = findColumn(firstRow, ["PZ", "Pezzi", "Qta", "Quantita", "Quantità"]);
    const mlCol = findColumn(firstRow, ["ML", "Ml"]);
    const grCol = findColumn(firstRow, ["GR", "Gr"]);

    if (!codeCol) {
      return NextResponse.json(
        { ok: false, error: "Colonna Codice non trovata nel file Excel." },
        { status: 400 }
      );
    }

    const parsedRows = rawRows
      .map((r, index) => {
        const code = normCode(r[codeCol]);
        const description = descCol ? normText(r[descCol]) : "";
        const qty = pzCol ? toNumber(r[pzCol]) : 0;
        const qty_ml = mlCol ? toNumber(r[mlCol]) : 0;
        const qty_gr = grCol ? toNumber(r[grCol]) : 0;

        return {
          row_number: index + 2,
          code,
          description,
          qty,
          qty_ml,
          qty_gr,
        };
      })
      .filter((r) => r.code);

    if (!parsedRows.length) {
      return NextResponse.json(
        { ok: false, error: "Nessun codice articolo valido trovato nel file." },
        { status: 400 }
      );
    }

    const codes = Array.from(new Set(parsedRows.map((r) => r.code)));

    const { data: items, error: itemsError } = await supabaseAdmin
      .from("items")
      .select("id, code, description, is_active, um, volume_ml_per_unit")
      .in("code", codes);

    if (itemsError) {
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 500 }
      );
    }

    const itemByCode = new Map<string, any>();

    for (const it of items || []) {
      const code = normCode((it as any).code);
      if (!code) continue;
      itemByCode.set(code, it);
    }

    const validRows: any[] = [];
    const missingRows: any[] = [];
    const inactiveRows: any[] = [];
    const emptyQtyRows: any[] = [];

    for (const r of parsedRows) {
      const item = itemByCode.get(r.code);

      if (!item) {
        missingRows.push(r);
        continue;
      }

      if (!item.is_active) {
        inactiveRows.push({
          ...r,
          item_id: item.id,
          item_description: item.description,
        });
        continue;
      }

      const hasQty =
        Number(r.qty || 0) > 0 ||
        Number(r.qty_ml || 0) > 0 ||
        Number(r.qty_gr || 0) > 0;

      if (!hasQty) {
        emptyQtyRows.push({
          ...r,
          item_id: item.id,
          item_description: item.description,
        });
        continue;
      }

      validRows.push({
        row_number: r.row_number,
        item_id: item.id,
        code: item.code,
        description: item.description,
        excel_description: r.description,
        qty: r.qty,
        qty_ml: r.qty_ml,
        qty_gr: r.qty_gr,
        um: item.um ?? null,
        volume_ml_per_unit: item.volume_ml_per_unit ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      totals: {
        excel_rows: parsedRows.length,
        valid_rows: validRows.length,
        missing_rows: missingRows.length,
        inactive_rows: inactiveRows.length,
        empty_qty_rows: emptyQtyRows.length,
      },
      rows: validRows,
      missing_rows: missingRows,
      inactive_rows: inactiveRows,
      empty_qty_rows: emptyQtyRows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore import preview Excel." },
      { status: 500 }
    );
  }
}