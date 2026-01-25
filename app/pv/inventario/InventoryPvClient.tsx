"use client";

import { useEffect, useMemo, useState } from "react";

type Category = { id: string; name: string };
type Subcategory = { id: string; category_id: string; name: string };

type Item = {
  id: string;
  code: string;
  description: string;
  barcode?: string | null;
  prezzo_vendita_eur?: number | null;
};

type InventoryLine = {
  item_id: string;
  qty: number;
};

type MeResponse = {
  ok: boolean;
  role?: string;
  pv_id?: string | null;
  error?: string;
};

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
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

export default function InventoryPvClient() {
  const [pvId, setPvId] = useState<string>("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [inventoryDate, setInventoryDate] = useState(todayISO()); // ISO per input date

  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});

  // ✅ operatore
  const [operatore, setOperatore] = useState("");

  // ✅ filtro ricerca (client-side) + scan
  const [search, setSearch] = useState("");

  // ✅ lista “Scansionati”
  const [scannedIds, setScannedIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ✅ operatore obbligatorio
  const canSave = useMemo(() => !!pvId && !!categoryId && items.length > 0 && !!operatore.trim(), [pvId, categoryId, items.length, operatore]);

  // ✅ ricerca “furba” per barcode:
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

  // ✅ valore totale dei pezzi scansionati
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

  // ✅ NUOVO: gestione scan "tablet-friendly"
  // Molti scanner USB su Android non triggerano onKeyDown Enter come su PC,
  // ma inseriscono direttamente un \n/\r o \t nel valore dell'input.
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
    rows.forEach((it) => (m[it.id] = ""));
    setQtyMap(m);
  }

  async function prefillInventory() {
    if (!pvId || !categoryId || items.length === 0) return;

    const params = new URLSearchParams();
    params.set("category_id", categoryId);
    params.set("inventory_date", inventoryDate);
    if (subcategoryId) params.set("subcategory_id", subcategoryId);

    const res = await fetch(`/api/inventories/rows?${params.toString()}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) return;

    const map = new Map<string, number>();
    (json.rows || []).forEach((r: InventoryLine) => {
      map.set(r.item_id, Number(r.qty ?? 0));
    });

    setQtyMap((prev) => {
      const next = { ...prev };
      items.forEach((it) => {
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

  useEffect(() => {
    (async () => {
      try {
        setMsg(null);
        setError(null);
        await prefillInventory();
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, items.length, inventoryDate]);

  async function save() {
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
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Errore salvataggio");

      setMsg("Inventario salvato correttamente");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Caricamento…</p>;

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

      <div className="rounded-2xl border bg-white p-4 flex justify-between">
        <div className="text-sm text-gray-600">
          Articoli caricati: <b>{items.length}</b>
        </div>

        <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" disabled={!canSave || saving} onClick={save}>
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
            // Appena lo vedo, processo lo scan e svuoto campo (lo fa già handleScanFromRaw)
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
                  <th className="text-right p-3 w-32">Quantità</th>
                </tr>
              </thead>
              <tbody>
                {scannedItems.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="p-3 font-medium">{it.code}</td>
                    <td className="p-3">{it.description}</td>
                    <td className="p-3 text-right">
                      <input className="w-24 rounded-xl border p-2 text-right" inputMode="numeric" placeholder="0" value={qtyMap[it.id] ?? ""} onChange={(e) => setQty(it.id, e.target.value)} />
                    </td>
                  </tr>
                ))}
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
            {filteredItems.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="p-3 font-medium">{it.code}</td>
                <td className="p-3">{it.description}</td>
                <td className="p-3 text-right">
                  <input className="w-24 rounded-xl border p-2 text-right" inputMode="numeric" placeholder="(vuoto)" value={qtyMap[it.id] ?? ""} onChange={(e) => setQty(it.id, e.target.value)} />
                </td>
              </tr>
            ))}
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























