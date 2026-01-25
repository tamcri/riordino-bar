"use client";

import { useEffect, useMemo, useState } from "react";

type Pv = { id: string; code: string; name: string; is_active?: boolean };
type Category = { id: string; name: string; slug?: string; is_active?: boolean };
type Subcategory = { id: string; category_id: string; name: string; slug?: string; is_active?: boolean };

type Item = {
  id: string;
  code: string;
  description: string;
  barcode?: string | null;
  prezzo_vendita_eur?: number | null;
  is_active: boolean;
};

type InventoryRow = {
  id: string;
  item_id: string;
  code: string;
  description: string;
  qty: number;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s || "").trim());
}

function onlyDigits(v: string) {
  return v.replace(/[^\d]/g, "");
}

function formatEUR(n: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}

export default function InventoryClient() {
  const [pvs, setPvs] = useState<Pv[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [pvId, setPvId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [inventoryDate, setInventoryDate] = useState(todayISO());

  const [operatore, setOperatore] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});

  const [search, setSearch] = useState("");
  const [scannedIds, setScannedIds] = useState<string[]>([]);

  const canLoad = useMemo(() => !!pvId && !!categoryId && !!inventoryDate, [pvId, categoryId, inventoryDate]);
  const canSave = useMemo(() => !!operatore.trim() && !!pvId && !!categoryId && items.length > 0, [operatore, pvId, categoryId, items.length]);

  const filteredItems = useMemo(() => {
    const raw = search.trim();
    if (!raw) return items;

    const t = raw.toLowerCase();
    const digits = onlyDigits(raw);
    const isLikelyBarcode = digits.length >= 8;

    if (isLikelyBarcode) {
      const exact = items.filter((it) => {
        const bcDigits = onlyDigits(String(it.barcode ?? ""));
        const codeDigits = onlyDigits(String(it.code ?? ""));
        return (bcDigits && bcDigits === digits) || (codeDigits && codeDigits === digits);
      });
      if (exact.length > 0) return exact;

      return items.filter((it) => {
        const code = String(it.code || "").toLowerCase();
        const desc = String(it.description || "").toLowerCase();
        const bc = String(it.barcode || "").toLowerCase();
        const bcDigits = onlyDigits(String(it.barcode ?? ""));
        return code.includes(t) || desc.includes(t) || bc.includes(t) || (digits && bcDigits.includes(digits));
      });
    }

    return items.filter((it) => {
      const code = String(it.code || "").toLowerCase();
      const desc = String(it.description || "").toLowerCase();
      const bc = String(it.barcode || "").toLowerCase();
      return code.includes(t) || desc.includes(t) || bc.includes(t);
    });
  }, [items, search]);

  const scannedItems = useMemo(() => {
    const set = new Set(scannedIds);
    return items.filter((it) => set.has(it.id));
  }, [items, scannedIds]);

  const totScannedPieces = useMemo(() => {
    return scannedItems.reduce((sum, it) => sum + (Number(qtyMap[it.id]) || 0), 0);
  }, [scannedItems, qtyMap]);

  const totScannedDistinct = scannedItems.length;

  const totScannedValueEur = useMemo(() => {
    return scannedItems.reduce((sum, it) => {
      const q = Number(qtyMap[it.id]) || 0;
      const p = Number(it.prezzo_vendita_eur) || 0;
      return sum + q * p;
    }, 0);
  }, [scannedItems, qtyMap]);

  function setQty(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    setQtyMap((prev) => ({ ...prev, [itemId]: cleaned }));
  }

  function incrementQty(itemId: string, delta: number = 1) {
    setQtyMap((prev) => {
      const current = Number(prev[itemId] || "0") || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [itemId]: String(next) };
    });
  }

  // ✅ FIX: svuota lista + azzera qty SOLO degli scansionati
  function clearScannedList() {
    setQtyMap((prev) => {
      const next = { ...prev };
      scannedIds.forEach((id) => {
        next[id] = "";
      });
      return next;
    });
    setScannedIds([]);
  }

  // ✅ NUOVO: stessa logica di handleScanEnter, ma prende un rawInput (tablet-friendly)
  function handleScanFromRaw(rawInput: string) {
    const raw = (rawInput || "").trim();
    if (!raw) return;

    const digits = onlyDigits(raw);
    const isLikelyBarcode = digits.length >= 8;

    let found: Item | undefined;

    if (isLikelyBarcode) {
      found = items.find((it) => {
        const bcDigits = onlyDigits(String(it.barcode ?? ""));
        const codeDigits = onlyDigits(String(it.code ?? ""));
        return (bcDigits && bcDigits === digits) || (codeDigits && codeDigits === digits);
      });
    } else {
      const t = raw.toLowerCase();
      found = items.find((it) => String(it.code || "").toLowerCase() === t);
    }

    // sempre svuoto
    setSearch("");

    if (!found) {
      setMsg(null);
      setError("Barcode non trovato.");
      return;
    }

    setError(null);
    setMsg(null);

    setScannedIds((prev) => {
      if (prev.includes(found!.id)) return prev;
      return [found!.id, ...prev];
    });

    incrementQty(found.id, 1);
  }

  function handleScanEnter() {
    handleScanFromRaw(search);
  }

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento PV");
    setPvs(json.rows || []);
    if (!pvId && (json.rows?.[0]?.id ?? "")) setPvId(json.rows[0].id);
  }

  async function loadCategories() {
    const res = await fetch("/api/categories/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento categorie");
    setCategories(json.rows || []);
    if (!categoryId && (json.rows?.[0]?.id ?? "")) setCategoryId(json.rows[0].id);
  }

  async function loadSubcategories(nextCategoryId: string) {
    setSubcategories([]);
    setSubcategoryId("");
    if (!nextCategoryId) return;

    const res = await fetch(`/api/subcategories/list?category_id=${encodeURIComponent(nextCategoryId)}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento sottocategorie");
    setSubcategories(json.rows || []);
  }

  async function loadItems(nextCategoryId: string, nextSubcategoryId: string) {
    setItems([]);
    setQtyMap({});
    setSearch("");
    setScannedIds([]);

    if (!nextCategoryId) return;

    const params = new URLSearchParams();
    params.set("category_id", nextCategoryId);
    if (nextSubcategoryId) params.set("subcategory_id", nextSubcategoryId);
    params.set("limit", "1000");

    const res = await fetch(`/api/items/list?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento articoli");

    const rows: Item[] = json.rows || [];
    setItems(rows);

    const m: Record<string, string> = {};
    rows.forEach((it) => (m[it.id] = ""));
    setQtyMap(m);
  }

  async function loadExistingInventory(nextPvId: string, nextCategoryId: string, nextSubcategoryId: string, nextDate: string, currentItems: Item[]) {
    if (!nextPvId || !nextCategoryId || !nextDate) return;

    const params = new URLSearchParams();
    params.set("pv_id", nextPvId);
    params.set("category_id", nextCategoryId);
    params.set("inventory_date", nextDate);
    if (nextSubcategoryId) params.set("subcategory_id", nextSubcategoryId);

    const res = await fetch(`/api/inventories/rows?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) return;

    const map = new Map<string, number>();
    (json.rows || []).forEach((r: InventoryRow) => {
      if (r?.item_id) map.set(String(r.item_id), Number(r.qty ?? 0));
    });

    setQtyMap((prev) => {
      const next = { ...prev };
      currentItems.forEach((it) => {
        if (map.has(it.id)) {
          const v = String(map.get(it.id) ?? 0);
          next[it.id] = v === "0" ? "" : v;
        }
      });
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadPvs(), loadCategories()]);
      } catch (e: any) {
        setError(e?.message || "Errore");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!categoryId) return;
    (async () => {
      setError(null);
      try {
        await loadSubcategories(categoryId);
        await loadItems(categoryId, "");
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  useEffect(() => {
    if (!categoryId) return;
    (async () => {
      setError(null);
      try {
        await loadItems(categoryId, subcategoryId || "");
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subcategoryId]);

  useEffect(() => {
    if (!canLoad) return;
    if (items.length === 0) return;

    (async () => {
      setMsg(null);
      setError(null);
      try {
        await loadExistingInventory(pvId, categoryId, subcategoryId || "", inventoryDate, items);
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, inventoryDate, items.length]);

  async function save(forceOverwrite: boolean = false, overrideDate?: string) {
    if (!canSave) return;

    const dateToUse = (overrideDate ?? inventoryDate).trim();
    if (!isIsoDate(dateToUse)) {
      setError("Data inventario non valida (YYYY-MM-DD).");
      return;
    }

    setSaving(true);
    setMsg(null);
    setError(null);

    try {
      const rows = items.map((it) => ({
        item_id: it.id,
        qty: qtyMap[it.id] === "" ? 0 : Number(qtyMap[it.id]),
      }));

      const res = await fetch("/api/inventories/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pv_id: pvId,
          category_id: categoryId,
          subcategory_id: subcategoryId || null,
          inventory_date: dateToUse,
          operatore: operatore.trim(),
          rows,
          force_overwrite: forceOverwrite,
        }),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 409 || json?.code === "INVENTORY_ALREADY_EXISTS") {
        const choice = window.prompt(
          "Esiste già un inventario per PV/Categoria/Sottocategoria/Data.\n\nScrivi:\n1 = Sovrascrivi\n2 = Salva come nuovo (nuova data)\n0 = Annulla",
          "0"
        );

        if (choice === "1") {
          await save(true, dateToUse);
          return;
        }

        if (choice === "2") {
          const suggested = todayISO();
          const newDate = window.prompt("Inserisci la nuova data inventario (YYYY-MM-DD):", suggested) || "";
          if (!isIsoDate(newDate.trim())) {
            setError("Data non valida. Formato richiesto: YYYY-MM-DD");
            return;
          }
          setInventoryDate(newDate.trim());
          await save(false, newDate.trim());
          return;
        }

        setMsg("Salvataggio annullato. Inventario esistente mantenuto.");
        return;
      }

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Salvataggio fallito");

      setMsg(`Salvataggio OK — righe: ${json.saved}${json.overwritten ? " (sovrascritto)" : ""}`);
    } catch (e: any) {
      setError(e?.message || "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">Punto Vendita</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={pvId} onChange={(e) => setPvId(e.target.value)} disabled={loading}>
            {pvs.map((pv) => (
              <option key={pv.id} value={pv.id}>
                {pv.code} — {pv.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Categoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={loading}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Sottocategoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={loading || subcategories.length === 0}>
            <option value="">— Nessuna —</option>
            {subcategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">Se non ci sono sottocategorie, lascia “Nessuna”.</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Data inventario</label>
          <input type="date" className="w-full rounded-xl border p-3 bg-white" value={inventoryDate} onChange={(e) => setInventoryDate(e.target.value)} />
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <label className="block text-sm font-medium mb-2">Nome Operatore</label>
        <input className="w-full rounded-xl border p-3" placeholder="Es. Mario Rossi" value={operatore} onChange={(e) => setOperatore(e.target.value)} />
        <p className="text-xs text-gray-500 mt-1">Obbligatorio per salvare lo storico e generare l’Excel.</p>
      </div>

      <div className="rounded-2xl border bg-white p-4 flex items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          {items.length ? (
            <>
              Articoli caricati: <b>{items.length}</b>
            </>
          ) : (
            <>Seleziona una categoria per vedere gli articoli.</>
          )}
        </div>

        <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" disabled={!canSave || saving} onClick={() => save(false)}>
          {saving ? "Salvo..." : "Salva giacenze"}
        </button>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <label className="block text-sm font-medium mb-2">Cerca / Scansiona (Invio)</label>
        <input
          className="w-full rounded-xl border p-3"
          placeholder="Cerca per codice, descrizione o barcode... (usa Enter dopo scan)"
          value={search}
          onChange={(e) => {
            const v = e.target.value;
            setSearch(v);

            // ✅ Tablet/Android scanner USB: spesso arriva un terminatore (\n/\r o \t)
            if (/[\r\n\t]/.test(v)) {
              handleScanFromRaw(v.replace(/[\r\n\t]+/g, " "));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleScanEnter();
            }
          }}
        />
        <div className="mt-2 text-sm text-gray-600">
          Visualizzati: <b>{filteredItems.length}</b> / {items.length}
        </div>
      </div>

      {/* SCANSIONATI */}
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Scansionati</div>
            <div className="text-sm text-gray-600">
              Tot. Scansionati: <b>{totScannedPieces}</b> pezzi (<b>{totScannedDistinct}</b> articoli) — Valore: <b>{formatEUR(totScannedValueEur)}</b>
            </div>
          </div>

          <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" disabled={scannedIds.length === 0} onClick={clearScannedList}>
            Svuota lista
          </button>
        </div>

        {scannedItems.length === 0 ? (
          <div className="text-sm text-gray-500">Nessun articolo scansionato.</div>
        ) : (
          <div className="overflow-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 w-40">Codice</th>
                  <th className="text-left p-3">Descrizione</th>
                  <th className="text-left p-3 w-40">Quantità</th>
                </tr>
              </thead>
              <tbody>
                {scannedItems.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="p-3 font-medium">{it.code}</td>
                    <td className="p-3">{it.description}</td>
                    <td className="p-3">
                      <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={qtyMap[it.id] ?? ""} onChange={(e) => setQty(it.id, e.target.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 w-40">Codice</th>
              <th className="text-left p-3">Descrizione</th>
              <th className="text-left p-3 w-40">Quantità</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={3}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && filteredItems.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={3}>
                  Nessun articolo.
                </td>
              </tr>
            )}

            {filteredItems.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="p-3 font-medium">{it.code}</td>
                <td className="p-3">{it.description}</td>
                <td className="p-3">
                  <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={qtyMap[it.id] ?? ""} onChange={(e) => setQty(it.id, e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



















