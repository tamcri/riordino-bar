"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PV = { id: string; code: string; name: string };
type Deposit = { id: string; pv_id: string; code: string; name: string | null };

type Category = { id: string; name: string };
type Subcategory = { id: string; category_id: string; name: string };

type DepositItemRow = {
  id: string;
  deposit_id: string;
  item_id: string;
  imported_code: string;
  stock_qty: number;
  items?: any; // items.code, items.description, items.barcode, um, ecc
};

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function pickList(json: any, keys: string[]) {
  for (const k of keys) {
    const v = json?.[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function normSearch(s: any) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isDigitsOnly(s: string) {
  return /^[0-9]+$/.test(s);
}

// Gestione "più barcode": se barcode è "123; 456, 789" li spacchetta
function splitBarcodes(raw: any): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  // split su tutto ciò che non è numero
  const parts = s.split(/[^0-9]+/g).map((x) => x.trim()).filter(Boolean);
  // se non erano solo numeri (es. barcode con testo), fallback: usa anche l'intera stringa
  if (parts.length === 0) return [s];
  return parts;
}

function rowMatches(r: DepositItemRow, q: string) {
  // ritorna un "tipo match" per evidenziare e spiegare
  const code = normSearch(r.items?.code);
  const imported = normSearch(r.imported_code);
  const desc = normSearch(r.items?.description);

  // barcode: cerco sia su stringa completa, sia su barcode splittati
  const rawBarcode = String(r.items?.barcode ?? "");
  const barcodeAll = normSearch(rawBarcode);

  if (!q) return { ok: true, reason: "" };

  if (code.includes(q) || imported.includes(q)) return { ok: true, reason: "codice" };
  if (desc.includes(q)) return { ok: true, reason: "descrizione" };

  // match barcode diretto
  if (barcodeAll.includes(q)) return { ok: true, reason: "barcode" };

  // match barcode "multipli" (solo numeri)
  const qDigits = q.replace(/[^0-9]/g, "");
  if (qDigits && isDigitsOnly(qDigits)) {
    const parts = splitBarcodes(rawBarcode);
    if (parts.some((b) => b === qDigits || b.includes(qDigits))) return { ok: true, reason: "barcode" };
  }

  return { ok: false, reason: "" };
}

// --- LT -> CL helpers
function isLT(row: DepositItemRow) {
  const um = String(row.items?.um ?? "").trim().toUpperCase();
  return um === "LT";
}

// Se stock_qty arriva "vecchio" in litri (0.8, 1.0, 0.75) lo converto in cl.
// Se arriva già in cl (80, 100, 75) lo lascio.
function normalizeToClIfLT(row: DepositItemRow, qtyAny: any): number {
  const n = Number(qtyAny ?? 0);
  if (!Number.isFinite(n)) return 0;
  if (!isLT(row)) return Math.max(0, Math.round(n)); // per altri UM: quantità intera
  // euristica: se è <= 10 presumiamo litri
  if (n > 0 && n <= 10) return Math.max(0, Math.round(n * 100));
  return Math.max(0, Math.round(n)); // già cl
}

export default function AdminDepositInventoryPage() {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState("");

  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositId, setDepositId] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");

  const [items, setItems] = useState<DepositItemRow[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const [operatorName, setOperatorName] = useState("");
  const [notes, setNotes] = useState("");

  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // --- Import gestionale state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDate, setImportDate] = useState(todayISO());
  const [importing, setImporting] = useState(false);

  const filteredSubcategories = useMemo(() => {
    if (!categoryId) return subcategories;
    return subcategories.filter((s) => String(s.category_id) === String(categoryId));
  }, [subcategories, categoryId]);

  const searchQ = useMemo(() => normSearch(search), [search]);

  const visibleItems = useMemo(() => {
    if (!searchQ) return items;
    return items.filter((r) => rowMatches(r, searchQ).ok);
  }, [items, searchQ]);

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    const list = pickList(json, ["pvs", "rows", "data"]);
    setPvs(Array.isArray(list) ? list : []);
  }

  async function loadCategories() {
    const res = await fetch("/api/categories/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    const list = pickList(json, ["categories", "rows", "data"]);
    setCategories(Array.isArray(list) ? list : []);
  }

  async function loadSubcategoriesByCategory(catId: string) {
    if (!catId) {
      setSubcategories([]);
      return;
    }
    const res = await fetch(`/api/subcategories/list?category_id=${catId}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    const list = pickList(json, ["subcategories", "rows", "data"]);
    setSubcategories(Array.isArray(list) ? list : []);
  }

  async function loadDeposits(pv_id: string) {
    setDeposits([]);
    setDepositId("");
    setItems([]);
    setSearch("");
    setMsg(null);

    setCategoryId("");
    setSubcategoryId("");
    setSubcategories([]);

    setImportFile(null);
    setImportDate(todayISO());

    if (!pv_id) return;

    const res = await fetch(`/api/deposits/list?pv_id=${pv_id}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (json?.ok) setDeposits(json.deposits || []);
  }

  async function loadItems(dep_id: string, cat?: string, sub?: string) {
    if (!dep_id) return;

    const params = new URLSearchParams();
    params.set("deposit_id", dep_id);
    if (cat) params.set("category_id", cat);
    if (sub) params.set("subcategory_id", sub);

    const res = await fetch(`/api/deposits/items?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);

    if (json?.ok) {
      const list: DepositItemRow[] = json.items || [];
      setItems(list);

      const initial: Record<string, number> = {};
      for (const r of list) {
        // Regola UM: se LT => teniamo in cl (intero), altrimenti intero normale
        initial[r.item_id] = normalizeToClIfLT(r, r.stock_qty ?? 0);
      }
      setQuantities(initial);
    } else {
      setItems([]);
      setMsg(json?.error || "Errore caricamento articoli deposito");
    }
  }

  useEffect(() => {
    loadPvs();
    loadCategories();
  }, []);

  useEffect(() => {
    loadDeposits(pvId);
  }, [pvId]);

  useEffect(() => {
    loadItems(depositId, categoryId || "", subcategoryId || "");
  }, [depositId, categoryId, subcategoryId]);

  async function handleSave() {
    setMsg(null);
    if (!depositId) return setMsg("Seleziona un deposito.");
    if (!operatorName.trim()) return setMsg("Inserisci nome operatore.");

    // ✅ salva tutta la categoria/sottocategoria selezionata (ricerca = solo “trova”)
    const lines = items.map((r) => ({
      item_id: r.item_id,
      // Se LT: qty già in cl (intero). Se altro: intero
      qty: normalizeToClIfLT(r, quantities[r.item_id] ?? 0),
    }));

    setLoading(true);
    try {
      const res = await fetch("/api/deposit-inventories/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deposit_id: depositId,
          inventory_date: todayISO(),
          operator_name: operatorName,
          notes,
          lines,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore salvataggio");
        return;
      }

      setMsg(`Inventario salvato (${json.rows_inserted} righe).`);
      await loadItems(depositId, categoryId || "", subcategoryId || "");
    } finally {
      setLoading(false);
    }
  }

  async function handleImportGestionale() {
    setMsg(null);
    if (!depositId) return setMsg("Seleziona un deposito prima di importare.");
    if (!importFile) return setMsg("Seleziona il file Excel del gestionale.");

    setImporting(true);
    try {
      const fd = new FormData();
      fd.set("deposit_id", depositId);
      fd.set("inventory_date", importDate || todayISO());
      fd.set("file", importFile);

      const res = await fetch("/api/deposits/stock/import-gestionale", {
        method: "POST",
        body: fd,
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore import gestionale");
        return;
      }

      const unknown = Number(json?.unknown_codes_count ?? 0);
      const cols = json?.detected_columns
        ? ` (colonne: codice="${json.detected_columns.code}", qty="${json.detected_columns.qty}", um="${json.detected_columns.um || "-"}")`
        : "";

      setMsg(
        `✅ Import gestionale completato: ${json.rows_inserted} righe applicate.${unknown ? ` Codici non trovati: ${unknown} (vedi sample in console).` : ""}${cols}`
      );

      if (unknown && Array.isArray(json.unknown_codes_sample)) {
        console.warn("Codici non trovati (sample):", json.unknown_codes_sample);
      }

      await loadItems(depositId, categoryId || "", subcategoryId || "");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-semibold">Inventario Deposito</h1>
          <Link href="/admin/deposits" className="border px-4 py-2 rounded-xl bg-white">
            ← Depositi
          </Link>
        </div>

        {/* BLOCCO SELEZIONI */}
        <section className="bg-white rounded-2xl border p-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <select className="border p-3 rounded-xl" value={pvId} onChange={(e) => setPvId(e.target.value)}>
              <option value="">Seleziona PV</option>
              {pvs.map((pv) => (
                <option key={pv.id} value={pv.id}>
                  {pv.code} - {pv.name}
                </option>
              ))}
            </select>

            <select
              className="border p-3 rounded-xl"
              value={depositId}
              onChange={(e) => setDepositId(e.target.value)}
              disabled={!pvId}
            >
              <option value="">Seleziona Deposito</option>
              {deposits.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <select
              className="border p-3 rounded-xl"
              value={categoryId}
              onChange={(e) => {
                const v = e.target.value;
                setCategoryId(v);
                setSubcategoryId("");
                setSearch("");
                loadSubcategoriesByCategory(v);
              }}
            >
              <option value="">Tutte le categorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              className="border p-3 rounded-xl"
              value={subcategoryId}
              onChange={(e) => {
                setSubcategoryId(e.target.value);
                setSearch("");
              }}
              disabled={!categoryId}
            >
              <option value="">Tutte le sottocategorie</option>
              {filteredSubcategories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="border p-3 rounded-xl"
              placeholder="Nome operatore"
              value={operatorName}
              onChange={(e) => setOperatorName(e.target.value)}
            />
            <input
              className="border p-3 rounded-xl"
              placeholder="Note (opzionale)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </section>

        {/* IMPORT GIACENZE GESTIONALE */}
        <section className="bg-white rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">📥 Import giacenze da gestionale</div>
              <div className="text-xs text-gray-600">
                Colonna quantità: <b>Giac.fisc.1</b>. Se UM = <b>LT</b> → convertiamo in <b>cl</b>.
              </div>
            </div>
            <div className="text-xs text-gray-600">
              Data import:{" "}
              <input
                type="date"
                className="border rounded px-2 py-1"
                value={importDate}
                onChange={(e) => setImportDate(e.target.value)}
                disabled={!depositId}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 items-center">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="border p-3 rounded-xl bg-white"
              disabled={!depositId}
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />

            <button
              onClick={handleImportGestionale}
              disabled={!depositId || !importFile || importing}
              className="bg-black text-white px-6 py-3 rounded-xl disabled:opacity-60"
            >
              {importing ? "Import in corso..." : "Importa giacenze"}
            </button>
          </div>
        </section>

        {/* 🔎 RICERCA STICKY (rimane su) */}
        <section className="sticky top-0 z-30">
          <div className="bg-gray-100 pt-2">
            <div className="bg-white rounded-2xl border p-4 shadow-sm">
              <div className="grid md:grid-cols-2 gap-4 items-center">
                <input
                  className="border p-3 rounded-xl"
                  placeholder="Cerca per Articolo, Descrizione o Barcode…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={!depositId}
                />
                <div className="text-xs text-gray-600">
                  Visualizzati: <b>{visibleItems.length}</b> / Totali: <b>{items.length}</b>
                  {searchQ ? <span className="ml-2">(ricerca attiva)</span> : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* LISTA PRODOTTI */}
        <section className="bg-white rounded-2xl border p-4">
          {msg && <p className="mb-2 text-sm">{msg}</p>}

          {visibleItems.length === 0 ? (
            <div className="text-sm text-gray-600">Nessun articolo con questi filtri.</div>
          ) : (
            <div className="overflow-auto max-h-[500px]">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 border-b text-left sticky top-0 z-20 bg-gray-50">Codice</th>
                    <th className="p-2 border-b text-left sticky top-0 z-20 bg-gray-50">Descrizione</th>
                    <th className="p-2 border-b text-left sticky top-0 z-20 bg-gray-50">Barcode</th>
                    <th className="p-2 border-b text-right sticky top-0 z-20 bg-gray-50">Quantità</th>
                    <th className="p-2 border-b text-left sticky top-0 z-20 bg-gray-50">Storico</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((r) => {
                    const match = rowMatches(r, searchQ);
                    const highlight = searchQ && match.ok;

                    const um = String(r.items?.um ?? "").trim().toUpperCase();
                    const showUm = um ? `(${um === "LT" ? "CL" : um})` : "";

                    return (
                      <tr
                        key={r.id}
                        className={[
                          "odd:bg-white even:bg-gray-50",
                          highlight ? "ring-2 ring-black/10 bg-yellow-50" : "",
                        ].join(" ")}
                        title={highlight ? `Match su: ${match.reason}` : ""}
                      >
                        <td className="p-2 border-b font-mono">
                          {r.items?.code}
                          {highlight && match.reason === "codice" ? (
                            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border bg-white">match</span>
                          ) : null}
                        </td>
                        <td className="p-2 border-b">
                          {r.items?.description}
                          {highlight && match.reason === "descrizione" ? (
                            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border bg-white">match</span>
                          ) : null}
                        </td>
                        <td className="p-2 border-b font-mono">
                          {r.items?.barcode}
                          {highlight && match.reason === "barcode" ? (
                            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border bg-white">match</span>
                          ) : null}
                        </td>
                        <td className="p-2 border-b text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-[10px] text-gray-600">{showUm}</span>
                            <input
                              type="number"
                              className="w-24 border rounded px-2 py-1 text-right"
                              value={quantities[r.item_id] ?? 0}
                              onChange={(e) =>
                                setQuantities((prev) => ({
                                  ...prev,
                                  [r.item_id]: Number(e.target.value) || 0,
                                }))
                              }
                            />
                          </div>
                        </td>
                        <td className="p-2 border-b">
                          <Link
                            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                            href={`/admin/deposits/item-history?pv_id=${encodeURIComponent(pvId)}&item_id=${encodeURIComponent(
                              r.item_id
                            )}`}
                          >
                            Apri
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4">
            <button
              onClick={handleSave}
              disabled={loading || visibleItems.length === 0}
              className="bg-black text-white px-6 py-3 rounded-xl disabled:opacity-60"
              title={categoryId ? "Salva inventario della categoria selezionata" : "Salva inventario deposito"}
            >
              {loading ? "Salvataggio..." : "Salva Inventario Deposito"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}






