"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type DraftAdmin = {
  operatore: string;
  qtyMap: Record<string, string>;
  scannedIds: string[];
  showAllScanned: boolean;
  addQtyMap: Record<string, string>;
};

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

  // ✅ lista “Scansionati” in ordine cronologico: ultimo in cima
  const [scannedIds, setScannedIds] = useState<string[]>([]);

  // ✅ evidenza verde “ultimo toccato” (resta finché ne tocchi un altro)
  const [highlightScannedId, setHighlightScannedId] = useState<string | null>(null);

  // ✅ mostra solo ultimi 10 di default
  const [showAllScanned, setShowAllScanned] = useState(false);

  // ✅ qty “da aggiungere” (solo in sezione Scansionati)
  const [addQtyMap, setAddQtyMap] = useState<Record<string, string>>({});

  // ✅ dopo scan/Invio, nella tabella sotto mostro SOLO l’articolo trovato
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  // ✅ UX: focus automatico tra ricerca <-> quantità
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const canSave = useMemo(() => !!operatore.trim() && !!pvId && !!categoryId && items.length > 0, [operatore, pvId, categoryId, items.length]);

  const draftKey = useMemo(() => {
    const sub = subcategoryId || "null";
    return `inv_draft_admin:${pvId}:${categoryId}:${sub}:${inventoryDate}`;
  }, [pvId, categoryId, subcategoryId, inventoryDate]);

  function loadDraftIfAny(rows: Item[]) {
    try {
      if (!draftKey || !rows?.length) return;

      const raw = localStorage.getItem(draftKey);
      if (!raw) return;

      const d = JSON.parse(raw) as DraftAdmin;
      if (!d || typeof d !== "object") return;

      if (typeof d.operatore === "string") setOperatore(d.operatore);

      if (d.qtyMap && typeof d.qtyMap === "object") {
        setQtyMap((prev) => {
          const next: Record<string, string> = { ...prev };
          rows.forEach((it) => {
            if (d.qtyMap[it.id] != null) next[it.id] = String(d.qtyMap[it.id] ?? "");
          });
          return next;
        });
      }

      if (Array.isArray(d.scannedIds)) {
        const set = new Set(rows.map((r) => r.id));
        setScannedIds(d.scannedIds.filter((id) => set.has(id)));
      }

      if (typeof d.showAllScanned === "boolean") setShowAllScanned(d.showAllScanned);

      if (d.addQtyMap && typeof d.addQtyMap === "object") {
        const next: Record<string, string> = {};
        rows.forEach((it) => {
          if (d.addQtyMap[it.id] != null) next[it.id] = String(d.addQtyMap[it.id] ?? "");
        });
        setAddQtyMap(next);
      }
    } catch {
      // ignore
    }
  }

  function persistDraft() {
    try {
      if (!draftKey) return;
      const draft: DraftAdmin = {
        operatore,
        qtyMap,
        scannedIds,
        showAllScanned,
        addQtyMap,
      };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }

  function clearDraft() {
    try {
      if (!draftKey) return;
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!pvId || !categoryId || !inventoryDate) return;
    if (!items.length) return;

    const t = window.setTimeout(() => persistDraft(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, inventoryDate, items.length, operatore, scannedIds, showAllScanned, addQtyMap, qtyMap]);

  const filteredItems = useMemo(() => {
    // ✅ focus attivo => mostro SOLO l’articolo trovato
    if (focusItemId) {
      const it = items.find((x) => x.id === focusItemId);
      return it ? [it] : [];
    }

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
  }, [items, search, focusItemId]);

  const scannedItems = useMemo(() => {
    const byId = new Map(items.map((it) => [it.id, it]));
    return scannedIds.map((id) => byId.get(id)).filter(Boolean) as Item[];
  }, [items, scannedIds]);

  const scannedItemsVisible = useMemo(() => {
    if (showAllScanned) return scannedItems;
    return scannedItems.slice(0, 10);
  }, [scannedItems, showAllScanned]);

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

  function highlightAndMoveToTop(itemId: string) {
    setScannedIds((prev) => {
      const next = [itemId, ...prev.filter((id) => id !== itemId)];
      return next;
    });
    setHighlightScannedId(itemId);
  }

  function setQty(itemId: string, v: string) {
    const cleaned = onlyDigits(v);

    setQtyMap((prev) => ({ ...prev, [itemId]: cleaned }));

    const n = Number(cleaned || "0") || 0;

    setScannedIds((prev) => {
      const has = prev.includes(itemId);

      if (n > 0 && !has) return [itemId, ...prev];
      if (n > 0 && has) return [itemId, ...prev.filter((id) => id !== itemId)];

      if (n <= 0 && has) return prev.filter((id) => id !== itemId);

      return prev;
    });

    if (n > 0) setHighlightScannedId(itemId);
  }

  function addQty(itemId: string) {
    const delta = Number(onlyDigits(addQtyMap[itemId] ?? "")) || 0;
    if (delta <= 0) return;

    setQtyMap((prev) => {
      const current = Number(prev[itemId] || "0") || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [itemId]: String(next) };
    });

    setAddQtyMap((prev) => ({ ...prev, [itemId]: "" }));
    highlightAndMoveToTop(itemId);
  }

  function clearScannedList() {
    setQtyMap((prev) => {
      const next = { ...prev };
      scannedIds.forEach((id) => {
        next[id] = "";
      });
      return next;
    });
    setScannedIds([]);
    setShowAllScanned(false);
    setAddQtyMap({});
    setHighlightScannedId(null);
  }

  function handleScanEnter() {
    const raw = search.trim();
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

    setSearch("");

    if (!found) {
      setMsg(null);
      setError("Barcode non trovato.");
      return;
    }

    setError(null);
    setMsg(null);

    // ✅ in tabella sotto mostro SOLO questo articolo
    setFocusItemId(found.id);

    // ✅ UX: focus automatico sulla Quantità (tabella sotto)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = qtyInputRefs.current[found!.id];
        if (el) {
          el.focus();
          el.select();
        }
      });
    });

    if (scannedIds.includes(found.id)) {
      highlightAndMoveToTop(found.id);
      return;
    }

    setScannedIds((prev) => [found!.id, ...prev]);
    setHighlightScannedId(found.id);
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

    // ✅ cambio categoria => tolgo focus
    setFocusItemId(null);
  }

  async function loadItems(nextCategoryId: string, nextSubcategoryId: string) {
    setItems([]);
    setQtyMap({});
    setSearch("");
    setScannedIds([]);
    setShowAllScanned(false);
    setAddQtyMap({});
    setHighlightScannedId(null);
    setFocusItemId(null);

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

    loadDraftIfAny(rows);
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

  // ✅ FIX DEFINITIVO: non precompiliamo dal DB (rimane così)
  useEffect(() => {
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, inventoryDate, items.length]);

  function resetAfterClose() {
    setOperatore("");
    setSearch("");
    setScannedIds([]);
    setShowAllScanned(false);
    setAddQtyMap({});
    setHighlightScannedId(null);
    setFocusItemId(null);

    setQtyMap((prev) => {
      const next: Record<string, string> = { ...prev };
      items.forEach((it) => (next[it.id] = ""));
      return next;
    });

    clearDraft();
  }

  async function save(mode: "close" | "continue") {
    if (!canSave) return;

    const dateToUse = inventoryDate.trim();
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
          mode,
        }),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 409 || json?.code === "INVENTORY_ALREADY_EXISTS") {
        setMsg(null);
        setError(json?.error || "Esiste già un inventario: non è consentito sovrascrivere.");
        return;
      }

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Salvataggio fallito");

      setMsg(mode === "continue" ? `Salvato. Puoi continuare. — righe: ${json.saved}` : `Salvataggio OK — righe: ${json.saved}`);

      if (mode === "close") {
        resetAfterClose();
      } else {
        persistDraft();
      }
    } catch (e: any) {
      setError(e?.message || "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  const focusItem = focusItemId ? items.find((x) => x.id === focusItemId) : null;

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

        <div className="flex items-center gap-2">
          <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" disabled={!canSave || saving} onClick={() => save("continue")} type="button">
            {saving ? "Salvo..." : "Salva e continua"}
          </button>

          <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" disabled={!canSave || saving} onClick={() => save("close")} type="button">
            {saving ? "Salvo..." : "Salva e chiudi"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <label className="block text-sm font-medium mb-2">Cerca / Scansiona (Invio)</label>
        <input
          ref={searchInputRef}
          className="w-full rounded-xl border p-3"
          placeholder="Cerca per codice, descrizione o barcode... (usa Enter dopo scan)"
          value={search}
          onChange={(e) => {
            const v = e.target.value;
            setSearch(v);
            // ✅ se inizi a digitare, tolgo focus e torno alla lista normale
            if (focusItemId) setFocusItemId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleScanEnter();
            }
          }}
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            Visualizzati: <b>{filteredItems.length}</b> / {items.length}
          </div>

          {focusItemId && (
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              type="button"
              onClick={() => {
                setFocusItemId(null);
                setHighlightScannedId(null);
                requestAnimationFrame(() => {
                  const el = searchInputRef.current;
                  if (el) {
                    el.focus();
                    el.select();
                  }
                });
              }}
              title="Torna alla lista completa"
            >
              Mostra tutti
            </button>
          )}
        </div>

        {focusItem && (
          <div className="mt-2 text-xs text-gray-600">
            Stai vedendo solo: <b>{focusItem.code}</b> — {focusItem.description}
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Scansionati</div>
            <div className="text-sm text-gray-600">
              Tot. Scansionati: <b>{totScannedPieces}</b> pezzi (<b>{totScannedDistinct}</b> articoli) — Valore: <b>{formatEUR(totScannedValueEur)}</b>
            </div>
            {scannedItems.length > 10 && <div className="text-xs text-gray-500 mt-1">Mostro {showAllScanned ? "tutti" : "gli ultimi 10"}.</div>}
          </div>

          <div className="flex items-center gap-2">
            {scannedItems.length > 10 && (
              <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => setShowAllScanned((v) => !v)} type="button">
                {showAllScanned ? "—" : "+"}
              </button>
            )}
            <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" disabled={scannedIds.length === 0} onClick={clearScannedList} type="button">
              Svuota lista
            </button>
          </div>
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
                  <th className="text-left p-3 w-40">Tot.</th>
                  <th className="text-right p-3 w-48">Aggiungi</th>
                </tr>
              </thead>
              <tbody>
                {scannedItemsVisible.map((it) => {
                  const isHi = highlightScannedId === it.id;
                  return (
                    <tr key={it.id} className={`border-t ${isHi ? "bg-green-50" : ""}`}>
                      <td className="p-3 font-medium">{it.code}</td>
                      <td className="p-3">{it.description}</td>
                      <td className="p-3">
                        <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={qtyMap[it.id] ?? ""} onChange={(e) => setQty(it.id, e.target.value)} />
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-2">
                          <input
                            className="w-28 rounded-xl border p-2 text-right"
                            inputMode="numeric"
                            placeholder="+ qty"
                            value={addQtyMap[it.id] ?? ""}
                            onChange={(e) => setAddQtyMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addQty(it.id);
                              }
                            }}
                          />
                          <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" type="button" onClick={() => addQty(it.id)}>
                            Aggiungi
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

            {filteredItems.map((it) => {
              const isHi = highlightScannedId === it.id;
              return (
                <tr key={it.id} className={`border-t ${isHi ? "bg-green-50" : ""}`}>
                  <td className="p-3 font-medium">{it.code}</td>
                  <td className="p-3">{it.description}</td>
                  <td className="p-3">
                    <input
                      ref={(el) => {
                        qtyInputRefs.current[it.id] = el;
                      }}
                      className="w-full rounded-xl border p-2"
                      inputMode="numeric"
                      placeholder="0"
                      value={qtyMap[it.id] ?? ""}
                      onChange={(e) => setQty(it.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const el = searchInputRef.current;
                          if (el) {
                            el.focus();
                            el.select();
                          }
                        }
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
