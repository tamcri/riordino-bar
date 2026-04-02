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

type PreviewRow = {
  row_number: number;
  code: string;
  description: string;
  barcode: string | null;
  um: string | null;
  prezzo_vendita_eur: number | null;
  peso_kg: number | null;
  volume_ml_per_unit: number | null;
  is_active: boolean;
  status: "ok" | "duplicate" | "invalid";
  reason: string | null;
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
      { ok: false, error: "Solo admin può fare preview import" },
      { status: 401 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "File mancante" }, { status: 400 });
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

    const rawRows: PreviewRow[] = [];
    const seenInFile = new Set<string>();

    for (let r = headers.headerRow + 1; r <= (ws.rowCount || headers.headerRow); r++) {
      const row = ws.getRow(r);

      const code = norm(readCellString(row.getCell(headers.codeCol)));
      const description = norm(readCellString(row.getCell(headers.descriptionCol)));

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

      if (!code && !description) continue;

      let status: PreviewRow["status"] = "ok";
      let reason: string | null = null;

      if (!code) {
        status = "invalid";
        reason = "Codice mancante";
      } else if (!description) {
        status = "invalid";
        reason = "Descrizione mancante";
      } else if (seenInFile.has(code)) {
        status = "duplicate";
        reason = "Codice duplicato nel file";
      }

      if (code) seenInFile.add(code);

      rawRows.push({
        row_number: r,
        code,
        description,
        barcode,
        um,
        prezzo_vendita_eur,
        peso_kg,
        volume_ml_per_unit,
        is_active,
        status,
        reason,
      });
    }

    if (rawRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessuna riga valida trovata nel file." },
        { status: 400 }
      );
    }

    const validCodes = Array.from(
      new Set(rawRows.filter((r) => r.status !== "invalid" && r.code).map((r) => r.code))
    );

    const existingCodes = new Set<string>();
    const chunkSize = 500;

    for (let i = 0; i < validCodes.length; i += chunkSize) {
      const chunk = validCodes.slice(i, i + chunkSize);
      const { data, error } = await supabaseAdmin
        .from("warehouse_items")
        .select("code")
        .in("code", chunk);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      (data || []).forEach((r: any) => {
        const code = String(r?.code ?? "").trim();
        if (code) existingCodes.add(code);
      });
    }

    const rows = rawRows.map((r) => {
      if (r.status === "invalid") return r;

      if (existingCodes.has(r.code)) {
        return {
          ...r,
          status: "duplicate" as const,
          reason: r.reason || "Codice già esistente in anagrafica",
        };
      }

      return r;
    });

    const total = rows.length;
    const valid = rows.filter((r) => r.status === "ok").length;
    const duplicates = rows.filter((r) => r.status === "duplicate").length;
    const invalid = rows.filter((r) => r.status === "invalid").length;

    return NextResponse.json({
      ok: true,
      total,
      valid,
      duplicates,
      invalid,
      rows,
    });
  } catch (e: any) {
    console.error("[warehouse-items/import-preview] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore preview import magazzino" },
      { status: 500 }
    );
  }
}