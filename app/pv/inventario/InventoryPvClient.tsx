"use client";

import { useEffect, useMemo, useState } from "react";

type Category = { id: string; name: string };
type Subcategory = { id: string; category_id: string; name: string };
type Item = { id: string; code: string; description: string };

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

export default function InventoryPvClient() {
  const [pvId, setPvId] = useState<string>("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [inventoryDate, setInventoryDate] = useState(todayISO()); // ISO per input date

  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});

  // ✅ filtro ricerca (client-side)
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSave = useMemo(() => !!pvId && !!categoryId && items.length > 0, [pvId, categoryId, items.length]);

  const filteredItems = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return items;

    return items.filter((it) => {
      const code = String(it.code || "").toLowerCase();
      const desc = String(it.description || "").toLowerCase();
      return code.includes(t) || desc.includes(t);
    });
  }, [items, search]);

  /* =========================
     AUTH / PV
  ========================== */
  async function loadMe() {
    const res = await fetch("/api/me", { cache: "no-store" });
    const json: MeResponse = await res.json();

    if (!json.ok) throw new Error(json.error || "Errore autenticazione");
    if (json.role !== "punto_vendita") throw new Error("Accesso non consentito");
    if (!json.pv_id) throw new Error("PV non associato");

    setPvId(json.pv_id);
  }

  /* =========================
     LOADERS
  ========================== */
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
    setQtyMap({}); // 🔥 reset TOTALE
    setSearch(""); // ✅ reset ricerca quando ricarico dataset

    if (!catId) return;

    const params = new URLSearchParams();
    params.set("category_id", catId);
    if (subId) params.set("subcategory_id", subId);

    const res = await fetch(`/api/items/list?${params}`, {
      cache: "no-store",
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Errore articoli");

    const rows: Item[] = json.rows || [];
    setItems(rows);

    // inizializza tutto vuoto
    const m: Record<string, string> = {};
    rows.forEach((it) => (m[it.id] = ""));
    setQtyMap(m);
  }

  /* =========================
     PREFILL INVENTARIO (SOLO PV)
  ========================== */
  async function prefillInventory() {
    if (!pvId || !categoryId || items.length === 0) return;

    const params = new URLSearchParams();
    params.set("category_id", categoryId);
    params.set("inventory_date", inventoryDate); // ISO
    if (subcategoryId) params.set("subcategory_id", subcategoryId);

    const res = await fetch(`/api/inventories/rows?${params}`, {
      cache: "no-store",
    });
    const json = await res.json();
    if (!json.ok) return; // se non c’è inventario → rimane vuoto

    const map = new Map<string, number>();
    (json.rows || []).forEach((r: InventoryLine) => {
      map.set(r.item_id, Number(r.qty ?? 0));
    });

    setQtyMap((prev) => {
      const next = { ...prev };
      items.forEach((it) => {
        if (map.has(it.id)) {
          next[it.id] = String(map.get(it.id));
        }
      });
      return next;
    });
  }

  /* =========================
     EFFECTS
  ========================== */
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
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
        await prefillInventory();
      } catch {}
    })();
  }, [items.length, inventoryDate]);

  /* =========================
     SAVE
  ========================== */
  async function save() {
    if (!canSave) return;

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

      if (rows.length === 0) {
        throw new Error("Inserisci almeno una quantità");
      }

      const res = await fetch("/api/inventories/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pv_id: pvId,
          category_id: categoryId,
          subcategory_id: subcategoryId || null,
          inventory_date: inventoryDate, // ISO
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

  /* =========================
     RENDER
  ========================== */
  if (loading) return <p className="text-gray-500">Caricamento…</p>;

  return (
    <div className="space-y-4">
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
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={subcategories.length === 0}
          >
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
          <input
            type="date"
            className="w-full rounded-xl border p-3 bg-white"
            value={inventoryDate}
            onChange={(e) => setInventoryDate(e.target.value)}
          />
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

      {/* ✅ ricerca (client-side) */}
      <div className="rounded-2xl border bg-white p-4">
        <label className="block text-sm font-medium mb-2">Cerca</label>
        <input
          className="w-full rounded-xl border p-3"
          placeholder="Cerca per codice o descrizione..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mt-2 text-sm text-gray-600">
          Visualizzati: <b>{filteredItems.length}</b> / {items.length}
        </div>
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
                  <input
                    className="w-24 rounded-xl border p-2 text-right"
                    inputMode="numeric"
                    placeholder="(vuoto)"
                    value={qtyMap[it.id] ?? ""}
                    onChange={(e) =>
                      setQtyMap((prev) => ({
                        ...prev,
                        [it.id]: onlyDigits(e.target.value),
                      }))
                    }
                  />
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






