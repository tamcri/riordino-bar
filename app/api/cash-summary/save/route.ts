import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type SupplierPayment = {
  code?: string;
  name?: string;
  amount?: number | string | null;
};

type Body = {
  data?: string;
  operatore?: string;
  incasso_totale?: number | null;
  pagamento_fornitori?: number | null;
  gv_pagati?: number | null;
  lis_plus?: number | null;
  mooney?: number | null;
  totale_esistenza_cassa?: number | null;
  vendita_gv?: number | null;
  vendita_tabacchi?: number | null;
  totale?: number | null;
  pos?: number | null;
  spese_extra?: number | null;
  versamento?: number | null;
  da_versare?: number | null;
  tot_versato?: number | null;
  fondo_cassa?: number | null;
  fornitori?: SupplierPayment[];
};

const USER_TABLE_CANDIDATES = ["app_user", "app_users", "utenti", "users"];

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function lookupPvIdFromUserTables(username: string): Promise<string | null> {
  for (const table of USER_TABLE_CANDIDATES) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("pv_id")
      .eq("username", username)
      .maybeSingle();

    if (error) continue;

    const pv_id = (data as any)?.pv_id ?? null;
    if (pv_id && isUuid(pv_id)) return pv_id;

    return null;
  }
  return null;
}

async function lookupPvIdFromUsernameCode(username: string): Promise<string | null> {
  const code = (username || "").trim().split(/\s+/)[0]?.toUpperCase();
  if (!code || code.length > 5) return null;

  const { data, error } = await supabaseAdmin
    .from("pvs")
    .select("id")
    .eq("is_active", true)
    .eq("code", code)
    .maybeSingle();

  if (error) return null;
  return data?.id ?? null;
}

async function requirePvIdForPuntoVendita(username: string): Promise<string> {
  const pvFromUsers = await lookupPvIdFromUserTables(username);
  if (pvFromUsers) return pvFromUsers;

  const pvFromCode = await lookupPvIdFromUsernameCode(username);
  if (pvFromCode) return pvFromCode;

  throw new Error("Utente punto vendita senza PV assegnato (pv_id mancante).");
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || !["admin", "amministrativo", "punto_vendita"].includes(session.role)) {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Body non valido" }, { status: 400 });
    }

    const data = String(body.data ?? "").trim();
    const operatore = String(body.operatore ?? "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return NextResponse.json({ ok: false, error: "Data non valida (YYYY-MM-DD)" }, { status: 400 });
    }

    if (!operatore) {
      return NextResponse.json({ ok: false, error: "Operatore obbligatorio" }, { status: 400 });
    }

    const incasso_totale = toNumber(body.incasso_totale);
    const pagamento_fornitori = toNumber(body.pagamento_fornitori) ?? 0;
    const gv_pagati = toNumber(body.gv_pagati);
    const lis_plus = toNumber(body.lis_plus);
    const mooney = toNumber(body.mooney);
    const totale_esistenza_cassa = toNumber(body.totale_esistenza_cassa);
    const vendita_gv = toNumber(body.vendita_gv);
    const vendita_tabacchi = toNumber(body.vendita_tabacchi);
    const totale = toNumber(body.totale);
    const pos = toNumber(body.pos);
    const spese_extra = toNumber(body.spese_extra) ?? 0;
    const versamento = toNumber(body.versamento);
    const da_versare = toNumber(body.da_versare);
    const tot_versato = toNumber(body.tot_versato);
    const fondo_cassa = toNumber(body.fondo_cassa);

    if (incasso_totale === null) {
      return NextResponse.json({ ok: false, error: "Incasso Totale obbligatorio" }, { status: 400 });
    }
    if (gv_pagati === null) {
      return NextResponse.json({ ok: false, error: "G&V Pagati obbligatorio" }, { status: 400 });
    }
    if (lis_plus === null) {
      return NextResponse.json({ ok: false, error: "LIS+ obbligatorio" }, { status: 400 });
    }
    if (mooney === null) {
      return NextResponse.json({ ok: false, error: "MOONEY obbligatorio" }, { status: 400 });
    }
    if (totale_esistenza_cassa === null) {
      return NextResponse.json({ ok: false, error: "Totale Esistenza Cassa obbligatorio" }, { status: 400 });
    }
    if (vendita_gv === null) {
      return NextResponse.json({ ok: false, error: "Vendita G&V obbligatorio" }, { status: 400 });
    }
    if (vendita_tabacchi === null) {
      return NextResponse.json({ ok: false, error: "Vendita Tabacchi obbligatorio" }, { status: 400 });
    }
    if (totale === null) {
      return NextResponse.json({ ok: false, error: "Totale obbligatorio" }, { status: 400 });
    }
    if (pos === null) {
      return NextResponse.json({ ok: false, error: "POS obbligatorio" }, { status: 400 });
    }
    if (versamento === null) {
      return NextResponse.json({ ok: false, error: "Versamento obbligatorio" }, { status: 400 });
    }
    if (da_versare === null) {
      return NextResponse.json({ ok: false, error: "Da Versare obbligatorio" }, { status: 400 });
    }
    if (fondo_cassa === null) {
      return NextResponse.json({ ok: false, error: "Fondo Cassa obbligatorio" }, { status: 400 });
    }

    let pv_id: string | null = null;

    if (session.role === "punto_vendita") {
      try {
        pv_id = await requirePvIdForPuntoVendita(session.username);
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, error: e?.message || "PV non assegnato" },
          { status: 401 }
        );
      }
    } else {
      return NextResponse.json(
        { ok: false, error: "Questa route al momento è riservata al PV" },
        { status: 403 }
      );
    }

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .select("id, is_closed, tot_versato")
      .eq("pv_id", pv_id)
      .eq("data", data)
      .maybeSingle();

    if (existingErr) {
      return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 });
    }

    const isClosingNow = tot_versato !== null;

    if (existing && existing.tot_versato === null && tot_versato === null) {
      return NextResponse.json(
        {
          ok: false,
          error: "Esiste già un riepilogo per questa data. Apri quello esistente.",
        },
        { status: 409 }
      );
    }

    if (!existing) {
      const payload = {
        pv_id,
        data,
        operatore,
        incasso_totale,
        pagamento_fornitori,
        gv_pagati,
        lis_plus,
        mooney,
        totale_esistenza_cassa,
        vendita_gv,
        vendita_tabacchi,
        totale,
        pos,
        spese_extra,
        versamento,
        da_versare,
        tot_versato,
        fondo_cassa,
        is_closed: isClosingNow,
        updated_at: new Date().toISOString(),
      };

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("pv_cash_summaries")
        .insert(payload)
        .select("id")
        .maybeSingle();

      if (insertErr) {
        return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
      }

      const summaryId = inserted?.id;
      if (!summaryId) {
        return NextResponse.json({ ok: false, error: "ID riepilogo non trovato" }, { status: 500 });
      }

      const fornitori = Array.isArray(body.fornitori) ? body.fornitori : [];
      const supplierRows = fornitori
        .map((f) => ({
          summary_id: summaryId,
          supplier_code: String(f?.code ?? "").trim() || null,
          supplier_name: String(f?.name ?? "").trim() || null,
          amount: toNumber(f?.amount) ?? 0,
        }))
        .filter((r) => r.supplier_code || r.supplier_name);

      if (supplierRows.length > 0) {
        const { error: supplierErr } = await supabaseAdmin
          .from("pv_cash_supplier_payments")
          .insert(supplierRows);

        if (supplierErr) {
          return NextResponse.json({ ok: false, error: supplierErr.message }, { status: 500 });
        }
      }

      return NextResponse.json({
        ok: true,
        id: summaryId,
        is_closed: isClosingNow,
        mode: "insert",
      });
    }

    if (existing.is_closed) {
      return NextResponse.json(
        { ok: false, error: "Riepilogo già chiuso. Il PV non può più modificarlo." },
        { status: 409 }
      );
    }

    const isVersatoOnlyUpdate =
      tot_versato !== null &&
      existing.tot_versato === null;

    if (!isVersatoOnlyUpdate) {
      const payload = {
        operatore,
        incasso_totale,
        pagamento_fornitori,
        gv_pagati,
        lis_plus,
        mooney,
        totale_esistenza_cassa,
        vendita_gv,
        vendita_tabacchi,
        totale,
        pos,
        spese_extra,
        versamento,
        da_versare,
        tot_versato,
        fondo_cassa,
        is_closed: isClosingNow,
        updated_at: new Date().toISOString(),
      };

      const { error: updateErr } = await supabaseAdmin
        .from("pv_cash_summaries")
        .update(payload)
        .eq("id", existing.id);

      if (updateErr) {
        return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
      }

      const { error: deleteSupplierErr } = await supabaseAdmin
        .from("pv_cash_supplier_payments")
        .delete()
        .eq("summary_id", existing.id);

      if (deleteSupplierErr) {
        return NextResponse.json({ ok: false, error: deleteSupplierErr.message }, { status: 500 });
      }

      const fornitori = Array.isArray(body.fornitori) ? body.fornitori : [];
      const supplierRows = fornitori
        .map((f) => ({
          summary_id: existing.id,
          supplier_code: String(f?.code ?? "").trim() || null,
          supplier_name: String(f?.name ?? "").trim() || null,
          amount: toNumber(f?.amount) ?? 0,
        }))
        .filter((r) => r.supplier_code || r.supplier_name);

      if (supplierRows.length > 0) {
        const { error: supplierInsertErr } = await supabaseAdmin
          .from("pv_cash_supplier_payments")
          .insert(supplierRows);

        if (supplierInsertErr) {
          return NextResponse.json({ ok: false, error: supplierInsertErr.message }, { status: 500 });
        }
      }

      return NextResponse.json({
        ok: true,
        id: existing.id,
        is_closed: isClosingNow,
        mode: "update",
      });
    }

    const { error: versatoErr } = await supabaseAdmin
      .from("pv_cash_summaries")
      .update({
        tot_versato,
        da_versare,
        is_closed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (versatoErr) {
      return NextResponse.json({ ok: false, error: versatoErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      id: existing.id,
      is_closed: true,
      mode: "close",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Errore salvataggio riepilogo" },
      { status: 500 }
    );
  }
}