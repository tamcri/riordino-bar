// app/api/inventories/delete/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
function normNullParam(v: string | null): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
}

export async function DELETE(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  // ✅ per sicurezza: elimina SOLO admin (coerente con la UI che mostra Elimina solo ad admin)
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(req.url);

  const pv_id = (url.searchParams.get("pv_id") || "").trim();

  // ✅ Rapido: category_id può essere null (qs: omesso, "", "null")
  const category_id = normNullParam(url.searchParams.get("category_id"));

  // ✅ subcategory: "" / "null" / omesso => null
  const subcategory_id = normNullParam(url.searchParams.get("subcategory_id"));

  const inventory_date = (url.searchParams.get("inventory_date") || "").trim();

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

  // filtro comune (✅ supporta category_id NULL)
  const baseFilter = (q: any) => {
    q = q.eq("pv_id", pv_id).eq("inventory_date", inventory_date);

    if (category_id) q = q.eq("category_id", category_id);
    else q = q.is("category_id", null);

    if (subcategory_id) q = q.eq("subcategory_id", subcategory_id);
    else q = q.is("subcategory_id", null);

    return q;
  };

  // 1) elimina righe inventario
  const delRowsQ = baseFilter(supabaseAdmin.from("inventories").delete());
  const { error: delRowsErr, count: rowsDeleted } = await delRowsQ.select("*", { count: "exact", head: true });

  if (delRowsErr) {
    return NextResponse.json({ ok: false, error: delRowsErr.message }, { status: 500 });
  }

  // 2) elimina header inventario (operatore)
  const delHeadQ = baseFilter(supabaseAdmin.from("inventories_headers").delete());
  const { error: delHeadErr, count: headersDeleted } = await delHeadQ.select("*", { count: "exact", head: true });

  if (delHeadErr) {
    return NextResponse.json({ ok: false, error: delHeadErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deleted: {
      inventories: rowsDeleted ?? 0,
      inventories_headers: headersDeleted ?? 0,
    },
  });
}

