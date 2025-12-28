// File: lib/pdf/fillU88.ts
import { PDFDocument } from "pdf-lib";

/* -------------------- normalize -------------------- */

function norm(s: string): string {
  return (s || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[ÀÁ]/g, "A")
    .replace(/[ÈÉ]/g, "E")
    .replace(/[ÌÍ]/g, "I")
    .replace(/[ÒÓ]/g, "O")
    .replace(/[ÙÚ]/g, "U")
    .replace(/[^A-Z0-9]/g, "");
}

function normKey(s: string): string {
  let x = norm(s);

  x = x
    .replace(/BLU/g, "BLUE")
    .replace(/ROSSO/g, "RED")
    .replace(/ROSSA/g, "RED")
    .replace(/BIANCA/g, "WHITE")
    .replace(/BIONDE/g, "BLONDE")
    .replace(/BIONDA/g, "BLONDE");

  x = x
    .replace(/AST\d+/g, "")
    .replace(/\d+AST/g, "")
    .replace(/AST/g, "")
    .replace(/\d+PZ/g, "")
    .replace(/PZ/g, "");

  return x;
}

function moneyIT(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/* -------------------- descr variants -------------------- */

function buildDescrVariants(descr: string): string[] {
  const base0 = (descr || "").trim();
  if (!base0) return [];

  const variants = new Set<string>();

  variants.add(base0);
  variants.add(base0.replace(/\*LE\*/gi, "*"));

  variants.add(
    base0
      .replace(/\b(\d+)\s*GR\b/gi, "$1GR")
      .replace(/\b(\d+)\s*G\b/gi, "$1G")
      .replace(/\b(\d+)\s*PZ\b/gi, "$1PZ")
  );

  {
    const m = base0.match(/\b(\d+)\s*GR\b/i) || base0.match(/\b(\d+)GR\b/i);
    if (m?.[1]) {
      const n = m[1];
      variants.add(
        base0
          .replace(/\b(\d+)\s*GR\b/gi, `${n}G*${n}GR`)
          .replace(/\b(\d+)GR\b/gi, `${n}G*${n}GR`)
      );
      variants.add(`${base0} ${n}G*${n}GR`);
    }
  }

  variants.add(base0.replace(/\b(\d+)\s*AST\b/gi, "AST$1"));
  variants.add(base0.replace(/\bAST\s*(\d+)\b/gi, "$1AST"));

  variants.add(base0.replace(/\bAST\b/gi, "").replace(/\s+/g, " ").trim());
  variants.add(base0.replace(/\bAST\s*\d+\b/gi, "").replace(/\s+/g, " ").trim());
  variants.add(base0.replace(/\b\d+\s*AST\b/gi, "").replace(/\s+/g, " ").trim());

  variants.add(base0.replace(/\b\d+\s*PZ\b/gi, "").replace(/\s+/g, " ").trim());
  variants.add(base0.replace(/\b\d+PZ\b/gi, "").replace(/\s+/g, " ").trim());

  const cleaned: string[] = [];
  for (const v of variants) {
    const vv = v.replace(/\*\s*\*/g, "*").replace(/\s+/g, " ").trim();
    if (vv) cleaned.push(vv);
  }

  return Array.from(new Set(cleaned));
}

/* -------------------- types -------------------- */

export type U88Item = {
  descrizione: string;
  pesoKg: number;
  valoreDaOrdinare: number;
};

export type U88Missing = {
  descrizione: string;
  pesoKg: number;
  valoreDaOrdinare: number;
  found: { KG: boolean; GR: boolean; IMPORTO: boolean };
  triedVariants: string[];
  bestGuess?: { KG: string | null; GR: string | null; IMPORTO: string | null };
  write?: {
    KG?: { ok: boolean; reason?: string; resolved?: string | null; tried?: string[] };
    GR?: { ok: boolean; reason?: string; resolved?: string | null; tried?: string[] };
    IMPORTO?: { ok: boolean; reason?: string; resolved?: string | null; tried?: string[] };
  };
};

/* -------------------- suffix indexing -------------------- */

type Prefix = "KG" | "GR" | "IMPORTO";

type FieldEntry = {
  name: string;
  suffixRaw: string;
  suffixNorm: string;
  suffixKey: string;
};

function detectPrefixAndSuffix(name: string): { prefix: Prefix | null; suffixRaw: string } {
  const trimmed = (name || "").trim();

  if (/^KG/i.test(trimmed)) return { prefix: "KG", suffixRaw: trimmed.slice(2).trim() };
  if (/^GR/i.test(trimmed)) return { prefix: "GR", suffixRaw: trimmed.slice(2).trim() };
  if (/^IMPORTO/i.test(trimmed)) return { prefix: "IMPORTO", suffixRaw: trimmed.slice(7).trim() };

  return { prefix: null, suffixRaw: "" };
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function scoreMatch(needleNorm: string, needleKey: string, rowNorm: string, rowKey: string): number {
  if (!needleNorm || !rowNorm) return 0;

  let score = 0;

  score += commonPrefixLen(needleNorm, rowNorm);
  if (rowNorm.includes(needleNorm)) score += 200;
  if (needleNorm.includes(rowNorm)) score += 120;

  if (needleKey && rowKey) {
    score += commonPrefixLen(needleKey, rowKey);
    if (rowKey.includes(needleKey)) score += 260;
    if (needleKey.includes(rowKey)) score += 160;
  }

  const numsNeedle = needleNorm.match(/\d+/g) || [];
  const numsRow = rowNorm.match(/\d+/g) || [];
  if (numsNeedle.length && numsRow.length) {
    const set = new Set(numsRow);
    let hit = 0;
    for (const n of numsNeedle) if (set.has(n)) hit++;
    score += hit * 30;
  }

  return score;
}

/* -------------------- robust writer -------------------- */

function fieldTypeName(field: any): string {
  return field?.constructor?.name || typeof field;
}

function buildNameIndex(form: any) {
  const byNorm = new Map<string, string>();
  const all: string[] = [];

  for (const f of form.getFields()) {
    const name = f.getName();
    all.push(name);
    const k = norm(name);
    if (k && !byNorm.has(k)) byNorm.set(k, name);
  }

  return { byNorm, all };
}

function uniqNonEmpty(arr: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const v = (x || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function safeSetTextMany(
  form: any,
  idx: { byNorm: Map<string, string>; all: string[] },
  candidates: Array<string | null | undefined>,
  value: string
): { ok: boolean; reason?: string; resolved?: string | null; tried?: string[] } {
  const tried = uniqNonEmpty(candidates);

  for (const name of tried) {
    try {
      const f = form.getField(name);
      const t = fieldTypeName(f);
      if (t !== "PDFTextField") {
        return { ok: false, reason: `NOT_TEXT_FIELD(${t})`, resolved: name, tried };
      }
      form.getTextField(name).setText(value);
      return { ok: true, resolved: name, tried };
    } catch {
      // continuo
    }
  }

  for (const raw of tried) {
    const k = norm(raw);
    const hit = k ? idx.byNorm.get(k) : null;
    if (hit) {
      try {
        const f = form.getField(hit);
        const t = fieldTypeName(f);
        if (t !== "PDFTextField") {
          return { ok: false, reason: `NOT_TEXT_FIELD(${t})`, resolved: hit, tried };
        }
        form.getTextField(hit).setText(value);
        return { ok: true, resolved: hit, tried };
      } catch (e: any) {
        return { ok: false, reason: `EXCEPTION(${e?.message || String(e)})`, resolved: hit, tried };
      }
    }
  }

  return { ok: false, reason: "NO_FIELD", resolved: null, tried };
}

/* -------------------- main -------------------- */

export async function fillU88Pdf(
  templatePdfBytes: Uint8Array,
  items: U88Item[]
): Promise<{ pdf: Uint8Array; missing: U88Missing[] }> {
  const pdfDoc = await PDFDocument.load(templatePdfBytes);
  const form = pdfDoc.getForm();

  const fields = form.getFields();
  const names = fields.map((f) => f.getName());

  const entries: Record<Prefix, FieldEntry[]> = { KG: [], GR: [], IMPORTO: [] };

  for (const name of names) {
    const { prefix, suffixRaw } = detectPrefixAndSuffix(name);
    if (!prefix) continue;

    const suffixNorm = norm(suffixRaw);
    if (!suffixNorm) continue;

    entries[prefix].push({
      name,
      suffixRaw,
      suffixNorm,
      suffixKey: normKey(suffixRaw),
    });
  }

  const kgBySuffix = new Map<string, string>();
  const grBySuffix = new Map<string, string>();
  const impBySuffix = new Map<string, string>();

  for (const e of entries.KG) kgBySuffix.set(e.suffixNorm, e.name);
  for (const e of entries.GR) grBySuffix.set(e.suffixNorm, e.name);
  for (const e of entries.IMPORTO) impBySuffix.set(e.suffixNorm, e.name);

  // ✅ Mappa: nomeCampoIMPORTO (norm) -> suffixNorm, per marcare usedSuffix quando scrivo davvero
  const impSuffixByNameNorm = new Map<string, string>();
  for (const e of entries.IMPORTO) {
    impSuffixByNameNorm.set(norm(e.name), e.suffixNorm);
  }

  const impRows = entries.IMPORTO;

  const usedSuffix = new Set<string>();
  const missing: U88Missing[] = [];

  const nameIndex = buildNameIndex(form);

  for (const item of items) {
    const descr = (item.descrizione || "").trim();
    if (!descr) continue;

    const safeKg = Math.max(0, Number.isFinite(item.pesoKg) ? item.pesoKg : 0);
    const importo = Number.isFinite(item.valoreDaOrdinare) ? item.valoreDaOrdinare : 0;

    const variants = buildDescrVariants(descr);
    const variantsNorm = variants.map((v) => norm(v)).filter(Boolean);
    const variantsKey = variants.map((v) => normKey(v)).filter(Boolean);

    let bestRow: FieldEntry | null = null;
    let bestScore = 0;

    for (const row of impRows) {
      if (usedSuffix.has(row.suffixNorm)) continue;

      let localBest = 0;
      for (let i = 0; i < variantsNorm.length; i++) {
        const nd = variantsNorm[i];
        const nk = variantsKey[i] || normKey(variants[i] || "");
        const sc = scoreMatch(nd, nk, row.suffixNorm, row.suffixKey);
        if (sc > localBest) localBest = sc;
      }

      if (localBest > bestScore) {
        bestScore = localBest;
        bestRow = row;
      }
    }

    // candidati basati su bestRow (se c’è)
    const guessIMPORTO = bestRow ? bestRow.name : null;
    const guessKG = bestRow ? (kgBySuffix.get(bestRow.suffixNorm) || null) : null;
    const guessGR = bestRow ? (grBySuffix.get(bestRow.suffixNorm) || null) : null;

    // scrivo importo (robusto)
    const wImp = safeSetTextMany(form, nameIndex, [guessIMPORTO], moneyIT(importo));

    // ✅ FIX CRITICO: se ho scritto IMPORTO, quella riga è usata. Stop sovrascritture.
    if (wImp.ok && wImp.resolved) {
      const suf = impSuffixByNameNorm.get(norm(wImp.resolved));
      if (suf) usedSuffix.add(suf);
    }

    // kg/gr
    let kgInt = 0;
    let grInt = 0;

    if (safeKg >= 1) {
      kgInt = Math.floor(safeKg);
      const remainderKg = safeKg - kgInt;
      grInt = Math.round(remainderKg * 1000);
      if (grInt >= 1000) {
        kgInt += 1;
        grInt = 0;
      }
    } else {
      grInt = Math.round(safeKg * 1000);
    }

    const wKg = safeSetTextMany(form, nameIndex, [guessKG], kgInt > 0 ? String(kgInt) : "");
    const wGr = safeSetTextMany(form, nameIndex, [guessGR], grInt > 0 ? String(grInt) : "");

    const found = { KG: wKg.ok, GR: wGr.ok, IMPORTO: wImp.ok };

    if (!found.KG || !found.GR || !found.IMPORTO) {
      missing.push({
        descrizione: descr,
        pesoKg: safeKg,
        valoreDaOrdinare: importo,
        found,
        triedVariants: variants,
        bestGuess: {
          KG: guessKG,
          GR: guessGR,
          IMPORTO: guessIMPORTO,
        },
        write: {
          KG: wKg,
          GR: wGr,
          IMPORTO: wImp,
        },
      });
    }
  }

  form.flatten();
  const pdf = await pdfDoc.save();

  return { pdf, missing };
}
























