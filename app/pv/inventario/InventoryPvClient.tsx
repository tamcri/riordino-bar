"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Category = { id: string; name: string };
type Subcategory = { id: string; category_id: string; name: string };

type Item = {
  id: string;
  code: string;
  description: string;
  barcode?: string | null;
  prezzo_vendita_eur?: number | null;
};

type MeResponse = {
  ok: boolean;
  role?: string;
  pv_id?: string | null;
  error?: string;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function onlyDigits(v: string) {
  return v.replace(/[^\d]/g, "");
}

// ISO -> IT (YYYY-MM-DD => DD-MM-YYYY)
function formatDateIT(iso: string) {
  const s = (iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}-${m}-${y}`;
}

function formatEUR(n: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}

type DraftPv = {
  operatore: string;
  qtyMap: Record<string, string>;
  scannedIds: string[];
  showAllScanned: boolean;
  addQtyMap: Record<string, string>;
};

// ✅ multi-barcode: splitta tutto ciò che non è cifra e produce lista barcode
function splitBarcodes(raw: any): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const parts = s
    .split(/[^0-9]+/g) // split su qualsiasi non-cifra ( ; , spazio / | ecc )
    .map((x) => x.trim())
    .filter(Boolean);

  // tolgo duplicati
  return Array.from(new Set(parts));
}

function itemHasBarcode(it: Item, digits: string): boolean {
  if (!digits) return false;
  const list = splitBarcodes(it.barcode);
  return list.some((b) => b === digits);
}

function itemHasBarcodeLike(it: Item, digits: string): boolean {
  if (!digits) return false;
  const list = splitBarcodes(it.barcode);
  return list.some((b) => b.includes(digits));
}

export default function InventoryPvClient() {
  const [pvId, setPvId] = useState<string>("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [inventoryDate, setInventoryDate] = useState(todayISO()); // ISO per input date

  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});

  useEffect(() => {
    setInventoryDate(todayISO());
  }, []);

  // ✅ operatore
  const [operatore, setOperatore] = useState("");

  // ✅ filtro ricerca (client-side) + scan
  const [search, setSearch] = useState("");

  // ✅ lista “Scansionati”
  const [scannedIds, setScannedIds] = useState<string[]>([]);

  // ✅ evidenza verde “ultimo toccato” (resta finché ne tocchi un altro)
  const [highlightScannedId, setHighlightScannedId] = useState<string | null>(null);

  // ✅ mostra solo ultimi 10 di default
  const [showAllScanned, setShowAllScanned] = useState(false);

  // ✅ qty “da aggiungere” (solo in sezione Scansionati)
  const [addQtyMap, setAddQtyMap] = useState<Record<string, string>>({});

  // ✅ NEW: dopo scan/Invio, mostra SOLO l’articolo trovato nella lista sotto
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  // ✅ NEW: focus UX (solo quanto richiesto)
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ✅ operatore obbligatorio
  const canSave = useMemo(() => !!pvId && !!categoryId && items.length > 0 && !!operatore.trim(), [pvId, categoryId, items.length, operatore]);

  // ✅ chiave bozza (PV)
  const draftKey = useMemo(() => {
    const sub = subcategoryId || "null";
    return `inv_draft_pv:${pvId}:${categoryId}:${sub}:${inventoryDate}`;
  }, [pvId, categoryId, subcategoryId, inventoryDate]);

  function loadDraftIfAny(rows: Item[]) {
    try {
      if (!draftKey || !rows?.length) return;

      const raw = localStorage.getItem(draftKey);
      if (!raw) return;

      const d = JSON.parse(raw) as DraftPv;
      if (!d || typeof d !== "object") return;

      // operatore
      if (typeof d.operatore === "string") setOperatore(d.operatore);

      // qtyMap: prendo SOLO item presenti
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
      // se bozza corrotta, la ignoro
    }
  }

  function persistDraft() {
    try {
      if (!draftKey) return;
      const draft: DraftPv = {
        operatore: operatore,
        qtyMap: qtyMap,
        scannedIds: scannedIds,
        showAllScanned: showAllScanned,
        addQtyMap: addQtyMap,
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

  // ✅ salva bozza quando cambi qualcosa (solo se ho i dati base)
  useEffect(() => {
    if (!pvId || !categoryId || !inventoryDate) return;
    if (!items.length) return;

    const t = window.setTimeout(() => persistDraft(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, inventoryDate, items.length, operatore, scannedIds, showAllScanned, addQtyMap, qtyMap]);

  // ✅ ricerca “furba” per barcode (multi-barcode)
  const filteredItems = useMemo(() => {
    // NEW: se ho un focus, mostro SOLO quello
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
      // ✅ match ESATTO su uno qualsiasi dei barcode dell’articolo (o sul code numerico)
      const exact = items.filter((it) => {
        const codeDigits = onlyDigits(String(it.code ?? ""));
        return itemHasBarcode(it, digits) || (codeDigits && codeDigits === digits);
      });
      if (exact.length > 0) return exact;

      // fallback: match parziale su barcode multipli o su stringhe
      return items.filter((it) => {
        const code = String(it.code || "").toLowerCase();
        const desc = String(it.description || "").toLowerCase();
        const bcRaw = String(it.barcode || "").toLowerCase();
        return code.includes(t) || desc.includes(t) || bcRaw.includes(t) || itemHasBarcodeLike(it, digits);
      });
    }

    // non barcode: classico
    return items.filter((it) => {
      const code = String(it.code || "").toLowerCase();
      const desc = String(it.description || "").toLowerCase();
      const bc = String(it.barcode || "").toLowerCase();
      return code.includes(t) || desc.includes(t) || bc.includes(t);
    });
  }, [items, search, focusItemId]);

  // ✅ manteniamo l’ordine di scannedIds (cronologico: ultimo in cima)
  const scannedItems = useMemo(() => {
    const byId = new Map(items.map((it) => [it.id, it]));
    return scannedIds.map((id) => byId.get(id)).filter(Boolean) as Item[];
  }, [items, scannedIds]);

  // ✅ default: mostra solo 10
  const scannedItemsVisible = useMemo(() => {
    if (showAllScanned) return scannedItems;
    return scannedItems.slice(0, 10);
  }, [scannedItems, showAllScanned]);

  const totScannedPieces = useMemo(() => {
    return scannedItems.reduce((sum, it) => sum + (Number(qtyMap[it.id]) || 0), 0);
  }, [scannedItems, qtyMap]);

  const totScannedDistinct = scannedItems.length;

  // ✅ valore totale dei pezzi scansionati
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

  // ✅ “Aggiungi quantità” (somma)
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
        next[id] = "0";
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
        const codeDigits = onlyDigits(String(it.code ?? ""));
        return itemHasBarcode(it, digits) || (codeDigits && codeDigits === digits);
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

    // ✅ in lista sotto mostro SOLO questo articolo
    setFocusItemId(found.id);

    // ✅ (1) focus su quantità
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

  async function loadMe() {
    const res = await fetch("/api/me", { cache: "no-store" });
    const json: MeResponse = await res.json();

    if (!json.ok) throw new Error(json.error || "Errore autenticazione");
    if (json.role !== "punto_vendita") throw new Error("Accesso non consentito");
    if (!json.pv_id) throw new Error("PV non associato");

    setPvId(json.pv_id);
  }

  async function loadCategories() {
    const res = await fetch("/api/categories/list", { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Errore categorie");

    setCategories(json.rows || []);
    if (json.rows?.[0]?.id) setCategoryId(json.rows[0].id);
  }

  async function loadSubcategories(catId: string) {
    setSubcategories([]);
    setSubcategoryId("");

    if (!catId) return;

    const res = await fetch(`/api/subcategories/list?category_id=${catId}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Errore sottocategorie");

    setSubcategories(json.rows || []);
  }

  async function loadItems(catId: string, subId: string) {
    setItems([]);
    setQtyMap({});
    setSearch("");
    setScannedIds([]);
    setShowAllScanned(false);
    setAddQtyMap({});
    setHighlightScannedId(null);
    setFocusItemId(null);

    if (!catId) return;

    const params = new URLSearchParams();
    params.set("category_id", catId);
    if (subId) params.set("subcategory_id", subId);
    params.set("limit", "1000");

    const res = await fetch(`/api/items/list?${params.toString()}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Errore articoli");

    const rows: Item[] = json.rows || [];
    setItems(rows);

    const m: Record<string, string> = {};
    rows.forEach((it) => (m[it.id] = "0"));
    setQtyMap(m);

    loadDraftIfAny(rows);
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setMsg(null);

        await loadMe();
        await loadCategories();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!categoryId) return;
    (async () => {
      try {
        setError(null);
        setMsg(null);
        await loadSubcategories(categoryId);
        await loadItems(categoryId, "");
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [categoryId]);

  useEffect(() => {
    if (!categoryId) return;
    (async () => {
      try {
        setError(null);
        setMsg(null);
        await loadItems(categoryId, subcategoryId);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [subcategoryId]);

  // ✅ FIX DEFINITIVO: in PV NON precompiliamo mai dal DB (rimane così)
  useEffect(() => {
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, items.length, inventoryDate]);

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
      items.forEach((it) => (next[it.id] = "0"));
      return next;
    });

    clearDraft();
  }

  async function save(mode: "close" | "continue") {
    if (!pvId || !categoryId || items.length === 0) return;

    if (!operatore.trim()) {
      setError("Inserisci il Nome Operatore prima di salvare.");
      setMsg(null);
      return;
    }

    setSaving(true);
    setMsg(null);
    setError(null);

    try {
      const rows = items
        .map((it) => {
          const v = qtyMap[it.id];
          if (v === "") return null;
          return { item_id: it.id, qty: Number(v) };
        })
        .filter(Boolean);

      if (rows.length === 0) throw new Error("Inserisci almeno una quantità");

      const res = await fetch("/api/inventories/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pv_id: pvId,
          category_id: categoryId,
          subcategory_id: subcategoryId || null,
          inventory_date: inventoryDate,
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

      if (!json?.ok) throw new Error(json?.error || "Errore salvataggio");

      setMsg(mode === "continue" ? "Salvato. Puoi continuare." : "Inventario salvato correttamente");

      if (mode === "close") {
        resetAfterClose();
      } else {
        persistDraft();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Caricamento…</p>;

  const focusItem = focusItemId ? items.find((x) => x.id === focusItemId) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4">
        <label className="block text-sm font-medium mb-2">Nome Operatore</label>
        <input className="w-full rounded-xl border p-3" placeholder="Es. Mario Rossi" value={operatore} onChange={(e) => setOperatore(e.target.value)} />
        <p className="text-xs text-gray-500 mt-1">Obbligatorio per salvare.</p>
      </div>

      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">Categoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Sottocategoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={subcategories.length === 0}>
            <option value="">— Nessuna —</option>
            {subcategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Data inventario</label>
          <input type="date" className="w-full rounded-xl border p-3 bg-white" value={inventoryDate} onChange={(e) => setInventoryDate(e.target.value)} />
          <div className="text-xs text-gray-500 mt-1">
            Formato mostrato: <b>{formatDateIT(inventoryDate)}</b>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 flex justify-between items-center gap-3">
        <div className="text-sm text-gray-600">
          Articoli caricati: <b>{items.length}</b>
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

      {/* SCANSIONATI */}
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Scansionati</div>
            <div className="text-sm text-gray-600">
              Tot. Scansionati: <b>{totScannedPieces}</b> pezzi (<b>{totScannedDistinct}</b> articoli) — Valore: <b>{formatEUR(totScannedValueEur)}</b>
            </div>
            {scannedItems.length > 10 && (
              <div className="text-xs text-gray-500 mt-1">
                Mostro {showAllScanned ? "tutti" : "gli ultimi 10"}.
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {scannedItems.length > 10 && (
              <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => setShowAllScanned((v) => !v)} type="button">
                {showAllScanned ? "—" : "+"}
              </button>
            )}
            <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" disabled={scannedIds.length === 0} onClick={() => {
              setQtyMap((prev) => {
                const next = { ...prev };
                scannedIds.forEach((id) => { next[id] = "0"; });
                return next;
              });
              setScannedIds([]);
              setShowAllScanned(false);
              setAddQtyMap({});
              setHighlightScannedId(null);
            }} type="button">
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
                  <th className="text-right p-3 w-32">Tot.</th>
                  <th className="text-right p-3 w-40">Aggiungi</th>
                </tr>
              </thead>
              <tbody>
                {scannedItemsVisible.map((it) => {
                  const isHi = highlightScannedId === it.id;
                  return (
                    <tr key={it.id} className={`border-t ${isHi ? "bg-green-50" : ""}`}>
                      <td className="p-3 font-medium">{it.code}</td>
                      <td className="p-3">{it.description}</td>
                      <td className="p-3 text-right">
                        <input className="w-24 rounded-xl border p-2 text-right" inputMode="numeric" placeholder="0" value={qtyMap[it.id] ?? ""} onChange={(e) => {
                          const cleaned = onlyDigits(e.target.value);
                          setQtyMap((prev) => ({ ...prev, [it.id]: cleaned }));
                        }} />
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-2">
                          <input
                            className="w-24 rounded-xl border p-2 text-right"
                            inputMode="numeric"
                            placeholder="+ qty"
                            value={addQtyMap[it.id] ?? ""}
                            onChange={(e) => setAddQtyMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const delta = Number(onlyDigits(addQtyMap[it.id] ?? "")) || 0;
                                if (delta <= 0) return;
                                setQtyMap((prev) => {
                                  const current = Number(prev[it.id] || "0") || 0;
                                  return { ...prev, [it.id]: String(Math.max(0, current + delta)) };
                                });
                                setAddQtyMap((prev) => ({ ...prev, [it.id]: "" }));
                                highlightAndMoveToTop(it.id);
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

      {msg && <p className="text-green-700 text-sm">{msg}</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 w-40">Codice</th>
              <th className="text-left p-3">Descrizione</th>
              <th className="text-right p-3 w-40">Quantità</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((it) => {
              const isHi = highlightScannedId === it.id;
              return (
                <tr key={it.id} className={`border-t ${isHi ? "bg-green-50" : ""}`}>
                  <td className="p-3 font-medium">{it.code}</td>
                  <td className="p-3">{it.description}</td>
                  <td className="p-3 text-right">
                    <input
                      ref={(el) => {
                        qtyInputRefs.current[it.id] = el;
                      }}
                      className="w-24 rounded-xl border p-2 text-right"
                      inputMode="numeric"
                      placeholder="(vuoto)"
                      value={qtyMap[it.id] ?? ""}
                      onChange={(e) => {
                        const cleaned = onlyDigits(e.target.value);
                        setQtyMap((prev) => ({ ...prev, [it.id]: cleaned }));
                        const n = Number(cleaned || "0") || 0;

                        setScannedIds((prev) => {
                          const has = prev.includes(it.id);
                          if (n > 0 && !has) return [it.id, ...prev];
                          if (n > 0 && has) return [it.id, ...prev.filter((id) => id !== it.id)];
                          if (n <= 0 && has) return prev.filter((id) => id !== it.id);
                          return prev;
                        });

                        if (n > 0) setHighlightScannedId(it.id);
                      }}
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
            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={3} className="p-3 text-gray-500">
                  Nessun articolo
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}









