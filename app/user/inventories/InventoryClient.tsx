"use client";

import { useEffect, useMemo, useState } from "react";

type Pv = { id: string; code: string; name: string; is_active?: boolean };
type Category = { id: string; name: string; slug?: string; is_active?: boolean };
type Subcategory = { id: string; category_id: string; name: string; slug?: string; is_active?: boolean };
type Item = { id: string; code: string; description: string; is_active: boolean };

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function InventoryClient() {
  const [pvs, setPvs] = useState<Pv[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [pvId, setPvId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState<string>(""); // "" = nessuna
  const [inventoryDate, setInventoryDate] = useState(todayISO());

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // qty per item_id
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});

  const canLoad = useMemo(() => !!pvId && !!categoryId && !!inventoryDate, [pvId, categoryId, inventoryDate]);
  const canSave = useMemo(() => !!pvId && !!categoryId && items.length > 0, [pvId, categoryId, items.length]);

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

    if (!nextCategoryId) return;

    const params = new URLSearchParams();
    params.set("category_id", nextCategoryId);
    if (nextSubcategoryId) params.set("subcategory_id", nextSubcategoryId);

    const res = await fetch(`/api/items/list?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento articoli");

    const rows: Item[] = json.rows || [];
    setItems(rows);

    // init qty map vuota
    const m: Record<string, string> = {};
    rows.forEach((it) => (m[it.id] = ""));
    setQtyMap(m);
  }

  async function loadExistingInventory(nextPvId: string, nextCategoryId: string, nextSubcategoryId: string, nextDate: string) {
    if (!nextPvId || !nextCategoryId || !nextDate) return;

    const params = new URLSearchParams();
    params.set("pv_id", nextPvId);
    params.set("category_id", nextCategoryId);
    params.set("inventory_date", nextDate);
    if (nextSubcategoryId) params.set("subcategory_id", nextSubcategoryId);

    const res = await fetch(`/api/inventories/list?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento inventario");

    // costruisci map item_id -> qty
    const byItem: Record<string, string> = {};
    (json.rows || []).forEach((r: any) => {
      if (r?.item_id) byItem[String(r.item_id)] = String(r.qty ?? 0);
    });

    // applica ai campi già presenti
    setQtyMap((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((itemId) => {
        if (byItem[itemId] !== undefined) next[itemId] = byItem[itemId] === "0" ? "" : byItem[itemId];
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

  // quando cambia categoria -> carica sottocategorie + items
  useEffect(() => {
    if (!categoryId) return;
    (async () => {
      setError(null);
      try {
        await loadSubcategories(categoryId);
        await loadItems(categoryId, ""); // reset subcat
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  // quando cambia subcat -> ricarica items
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

  // quando ho PV+CAT+DATA e items caricati -> prefill inventario
  useEffect(() => {
    if (!canLoad) return;
    if (items.length === 0) return;

    (async () => {
      setMsg(null);
      setError(null);
      try {
        await loadExistingInventory(pvId, categoryId, subcategoryId || "", inventoryDate);
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, inventoryDate, items.length]);

  function setQty(itemId: string, v: string) {
    const cleaned = v.replace(/[^\d]/g, "");
    setQtyMap((prev) => ({ ...prev, [itemId]: cleaned }));
  }

  async function save() {
    if (!canSave) return;

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
          inventory_date: inventoryDate,
          rows,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Salvataggio fallito");

      setMsg(`Salvataggio OK — righe: ${json.saved}`);
    } catch (e: any) {
      setError(e?.message || "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* filtri */}
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
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={loading || subcategories.length === 0}
          >
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

      {/* azioni */}
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

        <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" disabled={!canSave || saving} onClick={save}>
          {saving ? "Salvo..." : "Salva giacenze"}
        </button>
      </div>

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* tabella items + qty */}
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

            {!loading && items.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={3}>
                  Nessun articolo.
                </td>
              </tr>
            )}

            {items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="p-3 font-medium">{it.code}</td>
                <td className="p-3">{it.description}</td>
                <td className="p-3">
                  <input
                    className="w-full rounded-xl border p-2"
                    inputMode="numeric"
                    placeholder="0"
                    value={qtyMap[it.id] ?? ""}
                    onChange={(e) => setQty(it.id, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
