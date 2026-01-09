// File: app/api/reorder/history/[id]/pat/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import path from "path";
import fs from "fs/promises";
import ExcelJS from "exceljs";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { extractRowsForPatFromCleanReorderXlsx } from "@/lib/excel/fillOrderTab";

export const runtime = "nodejs";

function getSessionFromCookies() {
  const raw = cookies().get(COOKIE_NAME)?.value || "";
  return parseSessionValue(raw);
}

function normPvLabel(s: string) {
  return (s || "")
    .toUpperCase()
    .trim()
    .replace(/[-–—]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

const PV_ALLOWED_NORM = new Set(
  [
    "A3 FLACCA",
    "C3 VELLETRI",
    "C7 ROVERETO",
    "C8 RIMINI",
    "C9 PERUGIA",
    "D1 VIAREGGIO",
    "D2 LATINA",
  ].map(normPvLabel)
);

function fmtDateIT(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function extractNumericCode(codArticolo: string): string {
  const s = (codArticolo || "").trim().toUpperCase();
  const m = s.match(/\d+/g);
  if (!m?.length) return "";
  return m.join("");
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const session = getSessionFromCookies();
  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const reorderId = ctx.params.id;
  if (!reorderId) {
    return NextResponse.json({ ok: false, error: "Parametro id mancante" }, { status: 400 });
  }

  const { data: reorder, error: rErr } = await supabaseAdmin
    .from("reorders")
    .select("id, type, export_path, pv_label, created_at")
    .eq("id", reorderId)
    .single();

  if (rErr || !reorder) {
    return NextResponse.json({ ok: false, error: "Storico non trovato" }, { status: 404 });
  }

  if (reorder.type !== "TAB") {
    return NextResponse.json({ ok: false, error: "PAT disponibile solo per ordini TAB" }, { status: 400 });
  }

  const pvLabelRaw = String(reorder.pv_label || "").trim();
  const pvLabelNorm = normPvLabel(pvLabelRaw);

  if (!PV_ALLOWED_NORM.has(pvLabelNorm)) {
    return NextResponse.json({ ok: false, error: "PAT non disponibile per questo punto vendita" }, { status: 403 });
  }

  if (!reorder.export_path) {
    return NextResponse.json({ ok: false, error: "export_path mancante nello storico." }, { status: 500 });
  }

  const { data: fileBlob, error: dErr } = await supabaseAdmin.storage
    .from("reorders")
    .download(reorder.export_path);

  if (dErr || !fileBlob) {
    console.error("[history/pat] download error:", dErr);
    return NextResponse.json({ ok: false, error: "Excel pulito non trovato nello storage." }, { status: 404 });
  }

  const cleanAb = await fileBlob.arrayBuffer();

  const srcRows = await extractRowsForPatFromCleanReorderXlsx(cleanAb);

  // Solo righe con Qtà da ordinare > 0
  const rows = (Array.isArray(srcRows) ? srcRows : []).filter((r) => Number(r.qtaDaOrdinare || 0) > 0);

  const templatePath = path.join(process.cwd(), "templates", "PAT.xlsx");
  let templateBytes: Uint8Array;

  try {
    templateBytes = new Uint8Array(await fs.readFile(templatePath));
  } catch {
    return NextResponse.json({ ok: false, error: `Template non trovato: ${templatePath}` }, { status: 404 });
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(templateBytes) as any);

  const ws = wb.worksheets[0];
  if (!ws) {
    return NextResponse.json({ ok: false, error: "Template PAT senza worksheet." }, { status: 500 });
  }

  // intestazione
  ws.getCell("A4").value = fmtDateIT(String(reorder.created_at || ""));
  ws.getCell("B4").value = pvLabelRaw;

  // area dati template
  const startRow = 6;
  const lastDataRowTpl = 222;

  // righe totali nel template originale (da allegato)
  const totalsRowTpl = 223; // totali KG e Stecca
  const discountRowTpl = 224; // riga Sconto (input)
  const discountedRowTpl = 225; // riga totale scontato (formula)

  // pulizia area dati (nel caso template “sporco”)
  for (let r = startRow; r <= lastDataRowTpl; r++) {
    for (let c = 1; c <= 6; c++) ws.getCell(r, c).value = null;
  }

  // scrivo righe reali (massimo quanto può contenere il template prima di “tagliare”)
  const maxDataRows = lastDataRowTpl - startRow + 1; // 217
  const maxRows = Math.min(rows.length, maxDataRows);

  for (let i = 0; i < maxRows; i++) {
    const rr = rows[i];
    const excelRow = startRow + i;

    const codNum = extractNumericCode(rr.codArticolo);
    const descr = String(rr.descrizione || "").trim();

    const kg = Number.isFinite(rr.qtaKg) ? rr.qtaKg : 0;
    const qta = Number.isFinite(rr.qtaDaOrdinare) ? rr.qtaDaOrdinare : 0;
    const valore = Number.isFinite(rr.valoreDaOrdinare) ? rr.valoreDaOrdinare : 0;

    const costo = qta > 0 ? valore / qta : 0;
    const stecca = qta > 0 ? qta * costo : 0;

    ws.getCell(excelRow, 1).value = codNum; // Cod. Articolo
    ws.getCell(excelRow, 2).value = descr; // Descrizione
    ws.getCell(excelRow, 3).value = kg; // Kg
    ws.getCell(excelRow, 4).value = qta; // Qtà
    ws.getCell(excelRow, 5).value = costo; // Costo
    ws.getCell(excelRow, 6).value = stecca; // Stecca

    ws.getCell(excelRow, 5).numFmt = "€ #,##0.00;[Red]-€ #,##0.00";
    ws.getCell(excelRow, 6).numFmt = "€ #,##0.00;[Red]-€ #,##0.00";
  }

  // ✅ QUI: eliminiamo le righe vuote tra ultima riga compilata e i totali
  // calcolo ultima riga compilata
  const lastWrittenRow = maxRows > 0 ? startRow + maxRows - 1 : startRow - 1;

  // vogliamo che i totali finiscano subito sotto l'ultima riga (o sotto header se non c'è niente)
  const newTotalsRow = Math.max(startRow, lastWrittenRow + 1);

  // nel template i totali stanno a 223: se newTotalsRow è più in alto, tagliamo via le righe vuote
  if (newTotalsRow < totalsRowTpl) {
    const howManyToDelete = totalsRowTpl - newTotalsRow; // righe vuote da eliminare
    ws.spliceRows(newTotalsRow, howManyToDelete);
    // Dopo spliceRows:
    // - l'ex riga 223 diventa newTotalsRow
    // - l'ex 224 diventa newTotalsRow+1
    // - l'ex 225 diventa newTotalsRow+2
  }

  const totalsRow = newTotalsRow;
  const discountRow = totalsRow + 1;
  const discountedRow = totalsRow + 2;

  // aggiorno formule totali (range dinamico, senza righe vuote)
  // Colonna KG = C, Colonna Stecca = F
  if (lastWrittenRow >= startRow) {
    ws.getCell(`C${totalsRow}`).value = { formula: `SUM(C${startRow}:C${lastWrittenRow})` };
    ws.getCell(`F${totalsRow}`).value = { formula: `SUM(F${startRow}:F${lastWrittenRow})` };
  } else {
    // nessuna riga: totali 0
    ws.getCell(`C${totalsRow}`).value = 0;
    ws.getCell(`F${totalsRow}`).value = 0;
  }

  ws.getCell(`F${totalsRow}`).numFmt = "€ #,##0.00;[Red]-€ #,##0.00";

  // Sconto: input manuale in F{discountRow}, formula prezzo scontato in F{discountedRow}
  ws.getCell(`F${discountRow}`).value = null;
  ws.getCell(`F${discountRow}`).numFmt = "0%";

  ws.getCell(`F${discountedRow}`).value = { formula: `F${totalsRow}-(F${totalsRow}*F${discountRow})` };
  ws.getCell(`F${discountedRow}`).numFmt = "€ #,##0.00;[Red]-€ #,##0.00";

  const out = await wb.xlsx.writeBuffer();

  const filename = `PAT_${pvLabelRaw}_${reorder.id}.xlsx`
    .replace(/\s+/g, "_")
    .replace(/[^\w\-\.]/g, "");

  return new NextResponse(Buffer.from(out as ArrayBuffer), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}


