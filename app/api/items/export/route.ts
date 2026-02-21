// app/api/items/export/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

function isUuid(v: string | null) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function safeLikeTerm(v: string) {
  return String(v ?? "")
    .trim()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function asText(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function relName(v: any): string {
  if (!v) return "";
  // se arriva come array (caso comune)
  if (Array.isArray(v)) return asText(v?.[0]?.name);
  // se arriva come oggetto
  return asText(v?.name);
}


function asNumber(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function GET(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Solo admin può esportare articoli" }, { status: 401 });
    }

    const url = new URL(req.url);

    const category_id = String(url.searchParams.get("category_id") ?? "").trim();
    const subcategory_id = String(url.searchParams.get("subcategory_id") ?? "").trim() || null;
    const legacyCategory = String(url.searchParams.get("category") ?? "").trim().toUpperCase() as "TAB" | "GV" | "";

    const active = String(url.searchParams.get("active") ?? "1").trim();
    const qRaw = String(url.searchParams.get("q") ?? "").trim();
    const q = safeLikeTerm(qRaw);

    const usingNewSchema = !!category_id;

    if (usingNewSchema) {
      if (!isUuid(category_id)) {
        return NextResponse.json({ ok: false, error: "category_id non valido" }, { status: 400 });
      }
      if (subcategory_id && !isUuid(subcategory_id)) {
        return NextResponse.json({ ok: false, error: "subcategory_id non valido" }, { status: 400 });
      }
    } else {
      if (!legacyCategory || !["TAB", "GV"].includes(legacyCategory)) {
        return NextResponse.json(
          { ok: false, error: "Seleziona una categoria valida prima di esportare." },
          { status: 400 }
        );
      }
    }

    // 🔎 Recupero nome categoria/sottocategoria per intestazione
    let categoryName = "";
    let subcategoryName = "";

    if (usingNewSchema) {
      const { data: catRow } = await supabaseAdmin
        .from("categories")
        .select("name")
        .eq("id", category_id)
        .maybeSingle();

      if (catRow?.name) categoryName = catRow.name;

      if (subcategory_id) {
        const { data: subRow } = await supabaseAdmin
          .from("subcategories")
          .select("name")
          .eq("id", subcategory_id)
          .maybeSingle();

        if (subRow?.name) subcategoryName = subRow.name;
      }
    } else {
      categoryName = legacyCategory;
    }

    // 📦 Query items con LEFT JOIN categorie
    let query = supabaseAdmin
      .from("items")
      .select(`
        code,
        description,
        barcode,
        um,
        prezzo_vendita_eur,
        is_active,
        categories:categories!left(name),
        subcategories:subcategories!left(name)
      `);

    if (usingNewSchema) {
      query = query.eq("category_id", category_id);
      if (subcategory_id) query = query.eq("subcategory_id", subcategory_id);
    } else {
      query = query.eq("category", legacyCategory);
    }

    if (active === "1") query = query.eq("is_active", true);
    else if (active === "0") query = query.eq("is_active", false);

    if (q) {
      const like = `%${q}%`;
      query = query.or(`code.ilike.${like},description.ilike.${like},barcode.ilike.${like}`);
    }

    query = query.order("code", { ascending: true });

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = data || [];

    // 📊 Creazione Excel
    const wb = new ExcelJS.Workbook();
    wb.creator = "riordino-bar";
    wb.created = new Date();

    const ws = wb.addWorksheet("Anagrafica");

    // ====== INTESTAZIONE REPORT ======
    ws.addRow(["ANAGRAFICA ARTICOLI"]);
    ws.getRow(1).font = { size: 14, bold: true };

    ws.addRow([]);
    ws.addRow(["Categoria filtro:", categoryName || "—"]);
    ws.addRow(["Sottocategoria filtro:", subcategoryName || "—"]);

    let statoLabel = "Tutti";
    if (active === "1") statoLabel = "Attivi";
    else if (active === "0") statoLabel = "Disattivi";

    ws.addRow(["Stato filtro:", statoLabel]);
    ws.addRow(["Ricerca:", q || "—"]);
    ws.addRow([]);

    // ====== HEADER TABELLA ======
    ws.addRow([
      "Codice",
      "Descrizione",
      "Categoria",
      "Sottocategoria",
      "Barcode",
      "UM",
      "Prezzo"
    ]);

    const headerRowIndex = ws.lastRow?.number ?? 1;
    ws.getRow(headerRowIndex).font = { bold: true };

    // ====== RIGHE DATI ======
    for (const r of rows) {
      ws.addRow([
        asText(r.code),
        asText(r.description),
        relName((r as any).categories),
        relName((r as any).subcategories),

        r.barcode == null ? "" : asText(r.barcode),
        r.um == null ? "" : asText(r.um),
        asNumber(r.prezzo_vendita_eur) ?? "",
      ]);
    }

    ws.views = [{ state: "frozen", ySplit: headerRowIndex }];

    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 50;
    ws.getColumn(3).width = 22;
    ws.getColumn(4).width = 22;
    ws.getColumn(5).width = 22;
    ws.getColumn(6).width = 10;
    ws.getColumn(7).width = 12;

    ws.getColumn(7).numFmt = "#,##0.00";

    const buffer = await wb.xlsx.writeBuffer();
    const bin = Buffer.from(buffer as ArrayBuffer);

    return new NextResponse(bin, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="anagrafica-articoli.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[items/export] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Errore export" }, { status: 500 });
  }
}


