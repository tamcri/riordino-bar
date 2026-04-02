import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

function toNullableNumber(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

function toNullableInt(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

function toBooleanDefaultTrue(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return true;
  if (["0", "false", "no", "n", "disattivo"].includes(s)) return false;
  return true;
}

function readCellString(cell: ExcelJS.Cell): string {
  const anyCell: any = cell as any;

  const t = String(anyCell?.text ?? "").trim();
  if (t) return t;

  const v = anyCell?.value;
  if (v == null) return "";

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return String(v);
  }

  if (typeof v === "object") {
    if (typeof (v as any).result === "number") return String((v as any).result);
    if (typeof (v as any).result === "string") return String((v as any).result).trim();
    if (Array.isArray((v as any).richText)) {
      try {
        return ((v as any).richText || []).map((x: any) => x?.text ?? "").join("").trim();
      } catch {
        return "";
      }
    }
  }

  return String(v).trim();
}

type ImportRow = {
  code: string;
  description: string;
  barcode: string | null;
  um: string | null;
  prezzo_vendita_eur: number | null;
  peso_kg: number | null;
  volume_ml_per_unit: number | null;
  is_active: boolean;
};

type HeaderMap = {
  codeCol: number;
  descriptionCol: number;
  barcodeCol: number;
  umCol: number;
  prezzoCol: number;
  pesoCol: number;
  volumeCol: number;
  activeCol: number;
  headerRow: number;
};

function findHeaders(ws: ExcelJS.Worksheet): HeaderMap | null {
  for (let r = 1; r <= Math.min(ws.rowCount || 1, 40); r++) {
    const row = ws.getRow(r);

    let codeCol = -1;
    let descriptionCol = -1;
    let barcodeCol = -1;
    let umCol = -1;
    let prezzoCol = -1;
    let pesoCol = -1;
    let volumeCol = -1;
    let activeCol = -1;

    for (let c = 1; c <= Math.min(ws.columnCount || 30, 30); c++) {
      const t = readCellString(row.getCell(c)).toLowerCase();

      if (!t) continue;

      if (
        codeCol === -1 &&
        ["code", "codice", "cod", "codice articolo", "cod. articolo"].some((k) => t.includes(k))
      ) {
        codeCol = c;
      }

      if (
        descriptionCol === -1 &&
        ["description", "descrizione", "descr"].some((k) => t.includes(k))
      ) {
        descriptionCol = c;
      }

      if (
        barcodeCol === -1 &&
        ["barcode", "bar code", "ean", "codice a barre", "codice barre"].some((k) =>
          t.includes(k)
        )
      ) {
        barcodeCol = c;
      }

      if (
        umCol === -1 &&
        ["um", "u.m", "u.m.", "unità di misura", "unita di misura"].some((k) =>
          t.includes(k)
        )
      ) {
        umCol = c;
      }

      if (
        prezzoCol === -1 &&
        ["prezzo_vendita_eur", "prezzo vendita", "prezzo di vendita", "prezzo"].some((k) =>
          t.includes(k)
        )
      ) {
        prezzoCol = c;
      }

      if (
        pesoCol === -1 &&
        ["peso_kg", "peso kg", "peso (kg)", "peso"].some((k) => t.includes(k))
      ) {
        pesoCol = c;
      }

      if (
        volumeCol === -1 &&
        ["volume_ml_per_unit", "ml per unit", "ml per unità", "ml per unita", "ml"].some((k) =>
          t.includes(k)
        )
      ) {
        volumeCol = c;
      }

      if (
        activeCol === -1 &&
        ["is_active", "attivo", "active"].some((k) => t.includes(k))
      ) {
        activeCol = c;
      }
    }

    if (codeCol !== -1 && descriptionCol !== -1) {
      return {
        codeCol,
        descriptionCol,
        barcodeCol,
        umCol,
        prezzoCol,
        pesoCol,
        volumeCol,
        activeCol,
        headerRow: r,
      };
    }
  }

  return null;
}

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Solo admin può importare articoli magazzino" },
      { status: 401 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });
    }

    const { data: centralPv, error: centralPvError } = await supabaseAdmin
      .from("pvs")
      .select("id")
      .eq("is_central_warehouse", true)
      .maybeSingle();

    if (centralPvError) {
      return NextResponse.json({ ok: false, error: centralPvError.message }, { status: 500 });
    }

    if (!centralPv) {
      return NextResponse.json(
        { ok: false, error: "Magazzino centrale non configurato" },
        { status: 400 }
      );
    }

    const { data: centralDeposit, error: centralDepositError } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("pv_id", (centralPv as any).id)
      .eq("code", "DEP-CENTRALE")
      .maybeSingle();

    if (centralDepositError) {
      return NextResponse.json({ ok: false, error: centralDepositError.message }, { status: 500 });
    }

    if (!centralDeposit) {
      return NextResponse.json(
        { ok: false, error: "Deposito centrale non trovato" },
        { status: 400 }
      );
    }

    const input = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(input);

    const ws = wb.worksheets[0];
    if (!ws) {
      return NextResponse.json({ ok: false, error: "Foglio Excel non trovato" }, { status: 400 });
    }

    const headers = findHeaders(ws);
    if (!headers) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Intestazioni non valide. Servono almeno le colonne Code/Codice e Description/Descrizione.",
        },
        { status: 400 }
      );
    }

    const extracted: ImportRow[] = [];
    let skipped_no_code = 0;
    let skipped_invalid = 0;

    for (let r = headers.headerRow + 1; r <= (ws.rowCount || headers.headerRow); r++) {
      const row = ws.getRow(r);

      const code = norm(readCellString(row.getCell(headers.codeCol)));
      if (!code) {
        skipped_no_code++;
        continue;
      }

      const description = norm(readCellString(row.getCell(headers.descriptionCol)));
      if (!description) {
        skipped_invalid++;
        continue;
      }

      const barcode =
        headers.barcodeCol !== -1
          ? norm(readCellString(row.getCell(headers.barcodeCol))) || null
          : null;

      const um =
        headers.umCol !== -1 ? norm(readCellString(row.getCell(headers.umCol))) || null : null;

      const prezzo_vendita_eur =
        headers.prezzoCol !== -1
          ? toNullableNumber(readCellString(row.getCell(headers.prezzoCol)))
          : null;

      const peso_kg =
        headers.pesoCol !== -1
          ? toNullableNumber(readCellString(row.getCell(headers.pesoCol)))
          : null;

      const volume_ml_per_unit =
        headers.volumeCol !== -1
          ? toNullableInt(readCellString(row.getCell(headers.volumeCol)))
          : null;

      const is_active =
        headers.activeCol !== -1
          ? toBooleanDefaultTrue(readCellString(row.getCell(headers.activeCol)))
          : true;

      extracted.push({
        code,
        description,
        barcode,
        um,
        prezzo_vendita_eur,
        peso_kg,
        volume_ml_per_unit,
        is_active,
      });
    }

    if (extracted.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessuna riga valida trovata nel file." },
        { status: 400 }
      );
    }

    const dedupMap = new Map<string, ImportRow>();
    for (const r of extracted) {
      dedupMap.set(r.code, r);
    }
    const deduped = Array.from(dedupMap.values());
    const codes = deduped.map((r) => r.code);

    const existingMap = new Map<string, string>();
    const chunkSize = 500;

    for (let i = 0; i < codes.length; i += chunkSize) {
      const chunk = codes.slice(i, i + chunkSize);
      const { data, error } = await supabaseAdmin
        .from("warehouse_items")
        .select("id, code")
        .in("code", chunk);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      (data || []).forEach((r: any) => {
        const code = String(r?.code ?? "").trim();
        const id = String(r?.id ?? "").trim();
        if (code && id) existingMap.set(code, id);
      });
    }

    const now = new Date().toISOString();

    const toInsert = deduped.filter((r) => !existingMap.has(r.code));

    let inserted = 0;
    const skipped_existing = deduped.length - toInsert.length;

    const createdIds: Array<{ id: string; code: string; is_active: boolean }> = [];

    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);

      const payload = chunk.map((r) => ({
        code: r.code,
        description: r.description,
        barcode: r.barcode,
        um: r.um,
        prezzo_vendita_eur: r.prezzo_vendita_eur,
        peso_kg: r.peso_kg,
        volume_ml_per_unit: r.volume_ml_per_unit,
        is_active: r.is_active,
        created_at: now,
        updated_at: now,
      }));

      const { data, error } = await supabaseAdmin
        .from("warehouse_items")
        .insert(payload)
        .select("id, code, is_active");

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const created = Array.isArray(data) ? data : [];
      inserted += created.length;

      created.forEach((r: any) => {
        createdIds.push({
          id: String(r?.id ?? "").trim(),
          code: String(r?.code ?? "").trim(),
          is_active: Boolean(r?.is_active),
        });
      });
    }

    if (createdIds.length > 0) {
      const depositPayload = createdIds.map((r) => ({
        deposit_id: (centralDeposit as any).id,
        warehouse_item_id: r.id,
        stock_qty: 0,
        is_active: r.is_active,
        created_at: now,
        updated_at: now,
      }));

      const { error } = await supabaseAdmin
        .from("warehouse_deposit_items")
        .insert(depositPayload);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      total_rows: extracted.length,
      deduped_rows: deduped.length,
      inserted,
      skipped_existing,
      skipped_no_code,
      skipped_invalid,
    });
  } catch (e: any) {
    console.error("[warehouse-items/import] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore import magazzino" },
      { status: 500 }
    );
  }
}