import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const SUPA_HOST = (() => {
  try {
    return new URL(process.env.SUPABASE_URL || "").host;
  } catch {
    return "INVALID_SUPABASE_URL";
  }
})();

function normText(v: any): string {
  return String(v ?? "").trim();
}

// Base: toglie spazi e nbsp (non tocca punteggiatura)
function normCode(v: any): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\u00A0/g, "");
}

// Soft: serve solo per il match “tollerante” (non modifica DB)
function normCodeSoft(v: any): string {
  const base = normCode(v);
  if (!base) return "";
  return base.replace(/[^A-Za-z0-9]/g, "");
}

function toNumber(v: any): number | null {
  if (v == null) return null;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function pickFirstKey(row: any, keys: string[]) {
  const lowerMap = new Map<string, string>();
  for (const k of Object.keys(row || {})) lowerMap.set(k.toLowerCase().trim(), k);
  for (const want of keys) {
    const real = lowerMap.get(want.toLowerCase());
    if (real) return real;
  }
  return null;
}

function errPayload(where: string, err: any) {
  return {
    ok: false,
    where,
    supa_host: SUPA_HOST,
    node_env: process.env.NODE_ENV ?? null,
    has_supa_url: !!process.env.SUPABASE_URL,
    message: err?.message ?? String(err ?? "Unknown error"),
    details: err?.details ?? null,
    hint: err?.hint ?? null,
    code: err?.code ?? null,
  };
}

/**
 * Scarta "codici" palesemente non-codice che arrivano dal gestionale.
 * Esempio: "CORREZ0,40" (sembra un importo/quantità, non un codice articolo reale).
 *
 * Heuristica:
 * - contiene virgola o punto
 * - contiene almeno una cifra
 *
 * Nota: non vogliamo bloccare codici validi con punto tipo "J&B" (ma quelli di solito non hanno cifre).
 */
function shouldIgnoreBadCode(raw: string): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return true;

  const hasSep = s.includes(",") || s.includes(".");
  const hasDigit = /\d/.test(s);

  if (hasSep && hasDigit) return true;
  return false;
}

/**
 * Esclusioni business:
 * - Tabacchi
 * - Gratta e Vinci
 */
function isExcludedCategory(cat: any): boolean {
  if (!cat) return false;
  const slug = String(cat.slug ?? "").toLowerCase().trim();
  const name = String(cat.name ?? "").toLowerCase().trim();

  const hay = `${slug} ${name}`.trim();

  // Tabacchi
  if (slug === "tabacchi" || hay.includes("tabacc")) return true;

  // Gratta e Vinci (tollerante)
  if (hay.includes("gratta") || hay.includes("vinci") || hay.includes("gratta e vinci")) return true;

  return false;
}

type ExcelEntry = {
  raw_code: string;
  code: string; // base
  soft: string; // alfanumerico only
  ml: number;
};

export async function POST(req: Request) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Solo admin" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "FormData non valido" }, { status: 400 });

  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "file obbligatorio" }, { status: 400 });

  // 1) leggo excel
  const buf = Buffer.from(await file.arrayBuffer());
  let rows: any[] = [];
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as any[];
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Errore lettura Excel: ${e?.message || "XLSX"}` }, { status: 400 });
  }

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "Excel vuoto (nessuna riga dati)" }, { status: 400 });
  }

  // colonne attese dal tuo file: Codice, UM2, Litri
  const kCode = pickFirstKey(rows[0], ["Codice", "Cod. Articolo", "Codice articolo", "Code"]);
  const kUm2 = pickFirstKey(rows[0], ["UM2", "Um2", "UM", "Um"]);
  const kLitri = pickFirstKey(rows[0], ["Litri", "LITRI", "Lt", "LT", "Lit"]);

  if (!kCode || !kLitri) {
    return NextResponse.json(
      {
        ok: false,
        error: `Non trovo colonne. Serve "Codice" e "Litri". Trovate: ${Object.keys(rows[0] || {}).join(", ")}`,
      },
      { status: 400 }
    );
  }

  // 2) costruisco entries: code(base) -> entry
  const codeToEntry = new Map<string, ExcelEntry>();
  const softToCodes = new Map<string, string[]>(); // per ambiguità

  let ignored_bad_code = 0;
  const ignored_bad_code_samples: string[] = [];

  for (const r of rows) {
    const rawCode = String((r as any)[kCode] ?? "");

    // ✅ ignora codici palesemente errati
    if (shouldIgnoreBadCode(rawCode)) {
      ignored_bad_code++;
      if (ignored_bad_code_samples.length < 50) ignored_bad_code_samples.push(rawCode);
      continue;
    }

    const code = normCode(rawCode);
    if (!code) continue;

    if (kUm2) {
      const um2 = normText((r as any)[kUm2]).toUpperCase();
      if (um2 && um2 !== "LT") continue;
    }

    const litri = toNumber((r as any)[kLitri]);
    if (litri == null || litri <= 0) continue;

    const ml = Math.round(litri * 1000);
    if (ml <= 0) continue;

    const soft = normCodeSoft(rawCode);

    const entry: ExcelEntry = { raw_code: rawCode, code, soft, ml };
    codeToEntry.set(code, entry);

    if (soft) {
      const arr = softToCodes.get(soft) || [];
      if (!arr.includes(code)) arr.push(code);
      softToCodes.set(soft, arr);
    }
  }

  if (codeToEntry.size === 0) {
    return NextResponse.json({ ok: false, error: "Nessuna riga valida (Codice/Litri)" }, { status: 400 });
  }

  const codes = Array.from(codeToEntry.keys());
  const chunkSize = 1000;

  let updated = 0;
  let skipped_already_set = 0;
  let not_found = 0;

  let matched_via_soft = 0;
  let ambiguous_soft = 0;

  // ✅ NEW: esclusioni per categoria (Tabacchi / Gratta e Vinci)
  let excluded_by_category = 0;

  const MAX_LIST = 300;
  const not_found_codes: string[] = [];
  const skipped_codes: string[] = [];
  const updated_codes: string[] = [];
  const ambiguous_codes: string[] = [];
  const excluded_codes: string[] = [];

  const soft_matches: { input_code: string; input_raw: string; soft: string; matched_db_code: string }[] = [];

  async function guardedUpdateById(id: string, ml: number) {
    // tentativo 1: NULL
    let { data: updData, error: updErr } = await supabaseAdmin
      .from("items")
      .update({ volume_ml_per_unit: ml, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("volume_ml_per_unit", null)
      .select("id");

    if (updErr) return { ok: false as const, where: "UPDATE(NULL)", err: updErr };

    // tentativo 2: 0
    if (!Array.isArray(updData) || updData.length === 0) {
      const second = await supabaseAdmin
        .from("items")
        .update({ volume_ml_per_unit: ml, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("volume_ml_per_unit", 0)
        .select("id");

      updData = second.data;
      updErr = second.error;

      if (updErr) return { ok: false as const, where: "UPDATE(0)", err: updErr };
    }

    const didUpdate = Array.isArray(updData) && updData.length > 0;
    return { ok: true as const, didUpdate };
  }

  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);

    // ✅ leggo anche categoria per poter escludere tabacchi / gratta&vinci
    const { data: items1, error: readErr1 } = await supabaseAdmin
      .from("items")
      .select("id, code, volume_ml_per_unit, category:categories!items_category_id_fkey(slug,name)")
      .in("code", chunk);

    if (readErr1) {
      return NextResponse.json(
        errPayload("READ(1): items.select('id,code,volume_ml_per_unit,category:categories(slug,name)').in('code',chunk)", readErr1),
        { status: 500 }
      );
    }

    const foundByCode = new Map<string, any>();
    for (const it of items1 || []) foundByCode.set(normCode((it as any).code), it);

    const needSoft: { code: string; soft: string }[] = [];
    const softSet = new Set<string>();

    for (const code of chunk) {
      const entry = codeToEntry.get(code)!;
      const it = foundByCode.get(code);

      if (it) {
        // ✅ esclusione per categoria
        if (isExcludedCategory((it as any).category)) {
          excluded_by_category++;
          if (excluded_codes.length < MAX_LIST) excluded_codes.push(code);
          continue;
        }

        const current = (it as any).volume_ml_per_unit;
        if (current != null && Number(current) > 0) {
          skipped_already_set++;
          if (skipped_codes.length < MAX_LIST) skipped_codes.push(code);
          continue;
        }

        const resUpd = await guardedUpdateById(String((it as any).id), entry.ml);
        if (!resUpd.ok) {
          return NextResponse.json(errPayload(`${resUpd.where}: items.update(...) guarded`, resUpd.err), { status: 500 });
        }

        if (resUpd.didUpdate) {
          updated++;
          if (updated_codes.length < MAX_LIST) updated_codes.push(code);
        } else {
          skipped_already_set++;
          if (skipped_codes.length < MAX_LIST) skipped_codes.push(code);
        }
        continue;
      }

      const soft = entry.soft;

      if (!soft) {
        not_found++;
        if (not_found_codes.length < MAX_LIST) not_found_codes.push(code);
        continue;
      }

      const list = softToCodes.get(soft) || [];
      if (list.length > 1) {
        ambiguous_soft++;
        if (ambiguous_codes.length < MAX_LIST) ambiguous_codes.push(code);
        continue;
      }

      needSoft.push({ code, soft });
      softSet.add(soft);
    }

    if (needSoft.length > 0) {
      const softCodes = Array.from(softSet);

      const { data: matches, error: rpcErr } = await supabaseAdmin.rpc("items_match_code_soft", {
        soft_codes: softCodes,
      });

      if (rpcErr) {
        return NextResponse.json(errPayload("RPC: supabaseAdmin.rpc('items_match_code_soft', {soft_codes})", rpcErr), {
          status: 500,
        });
      }

      // mappa soft -> {id, code}
      const foundBySoft = new Map<string, any>();
      const idsToHydrate: string[] = [];
      for (const m of (matches as any[]) || []) {
        const soft = String((m as any).code_soft ?? "").trim();
        const id = String((m as any).id ?? "");
        if (soft && id) {
          foundBySoft.set(soft, m);
          idsToHydrate.push(id);
        }
      }

      // ✅ carico in batch le info complete (volume + category) per gli id trovati via soft
      const { data: hydrated, error: hydErr } = await supabaseAdmin
        .from("items")
        .select("id, code, volume_ml_per_unit, category:categories(slug,name)")
        .in("id", idsToHydrate);

      if (hydErr) {
        return NextResponse.json(
          errPayload("READ(hydrate): items.select('id,code,volume_ml_per_unit,category:categories(slug,name)').in('id', ids)", hydErr),
          { status: 500 }
        );
      }

      const hydById = new Map<string, any>();
      for (const it of hydrated || []) hydById.set(String((it as any).id), it);

      for (const { code, soft } of needSoft) {
        const entry = codeToEntry.get(code)!;
        const m = foundBySoft.get(soft);

        if (!m) {
          not_found++;
          if (not_found_codes.length < MAX_LIST) not_found_codes.push(code);
          continue;
        }

        const itemId = String((m as any).id);
        const full = hydById.get(itemId);

        if (!full) {
          not_found++;
          if (not_found_codes.length < MAX_LIST) not_found_codes.push(code);
          continue;
        }

        // ✅ esclusione per categoria anche sui soft-match
        if (isExcludedCategory((full as any).category)) {
          excluded_by_category++;
          if (excluded_codes.length < MAX_LIST) excluded_codes.push(code);
          continue;
        }

        matched_via_soft++;
        if (soft_matches.length < MAX_LIST) {
          soft_matches.push({
            input_code: code,
            input_raw: entry.raw_code,
            soft,
            matched_db_code: String((full as any).code ?? ""),
          });
        }

        const current = (full as any)?.volume_ml_per_unit;
        if (current != null && Number(current) > 0) {
          skipped_already_set++;
          if (skipped_codes.length < MAX_LIST) skipped_codes.push(code);
          continue;
        }

        const resUpd = await guardedUpdateById(itemId, entry.ml);
        if (!resUpd.ok) {
          return NextResponse.json(errPayload(`${resUpd.where}: items.update(...) guarded (soft)`, resUpd.err), {
            status: 500,
          });
        }

        if (resUpd.didUpdate) {
          updated++;
          if (updated_codes.length < MAX_LIST) updated_codes.push(code);
        } else {
          skipped_already_set++;
          if (skipped_codes.length < MAX_LIST) skipped_codes.push(code);
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "volume-ml",
    total_rows: rows.length,
    codes_in_file: codeToEntry.size,
    updated,
    skipped_already_set,
    not_found,
    detected_columns: { code: kCode, um2: kUm2, litri: kLitri },

    matched_via_soft,
    ambiguous_soft,

    // ✅ info utile: righe ignorate
    ignored_bad_code,
    ignored_bad_code_samples,

    // ✅ NEW: esclusioni business
    excluded_by_category,
    excluded_codes,

    lists_limit: MAX_LIST,
    not_found_codes,
    ambiguous_codes,
    skipped_codes,
    updated_codes,
    soft_matches,
  });
}










