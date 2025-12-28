"use client";

import { useEffect, useMemo, useState } from "react";

type Pv = { id: string; code: string; name: string; is_active?: boolean };
type Category = { id: string; name: string; slug?: string; is_active?: boolean };
type Subcategory = { id: string; category_id: string; name: string; slug?: string; is_active?: boolean };

type InventoryGroup = {
  key: string;
  pv_id: string;
  pv_code: string;
  pv_name: string;
  category_id: string;
  category_name: string;
  subcategory_id: string | null;
  subcategory_name: string;
  inventory_date: string;
  created_by_username: string | null;
  created_at: string | null;
  lines_count: number;
  qty_sum: number;
};

type InventoryLine = {
  id: string;
  item_id: string;
  code: string;
  description: string;
  qty: number;
};

export default function InventoryHistoryClient() {
  const [pvs, setPvs] = useState<Pv[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  const [pvId, setPvId] = useState<string>(""); // "" = tutti
  const [categoryId, setCategoryId] = useState<string>(""); // "" = tutte
  const [subcategoryId, setSubcategoryId] = useState<string>(""); // "" = tutte/nessuna

  const [rows, setRows] = useState<InventoryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // dettaglio selezionato
  const [selected, setSelected] = useState<InventoryGroup | null>(null);
  const [detail, setDetail] = useState<InventoryLine[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // subcategorie: le mostriamo solo se esiste una categoria selezionata
  const canUseSubcategories = useMemo(() => !!categoryId, [categoryId]);

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento PV");
    setPvs(json.rows || []);
  }

  async function loadCategories() {
    const res = await fetch("/api/categories/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento categorie");
    setCategories(json.rows || []);
    // ✅ NON setto più una categoria di default: vogliamo poter vedere “tutte”
  }

  async function loadSubcategories(catId: string) {
    setSubcategories([]);
    setSubcategoryId("");
    if (!catId) return;

    const res = await fetch(`/api/subcategories/list?category_id=${encodeURIComponent(catId)}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento sottocategorie");
    setSubcategories(json.rows || []);
  }

  async function loadList() {
    setLoading(true);
    setError(null);
    setRows([]);
    setSelected(null);
    setDetail([]);
    setDetailError(null);

    try {
      const params = new URLSearchParams();

      // ✅ category_id opzionale
      if (categoryId) params.set("category_id", categoryId);

      // ✅ pv_id opzionale
      if (pvId) params.set("pv_id", pvId);

      // ✅ subcategory ha senso solo se category è selezionata
      if (categoryId && subcategoryId) params.set("subcategory_id", subcategoryId);

      const qs = params.toString();
      const res = await fetch(`/api/inventories/list${qs ? `?${qs}` : ""}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento inventari");

      setRows(json.rows || []);
    } catch (e: any) {
      setError(e?.message || "Errore");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(g: InventoryGroup) {
    setSelected(g);
    setDetail([]);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("pv_id", g.pv_id);
      params.set("category_id", g.category_id);
      params.set("inventory_date", g.inventory_date);
      if (g.subcategory_id) params.set("subcategory_id", g.subcategory_id);

      const res = await fetch(`/api/inventories/rows?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento dettaglio");

      setDetail(json.rows || []);
    } catch (e: any) {
      setDetailError(e?.message || "Errore");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadPvs(), loadCategories()]);
      } catch (e: any) {
        setError(e?.message || "Errore");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // quando cambia categoria -> ricarica sottocategorie (o resetta se vuota)
  useEffect(() => {
    (async () => {
      try {
        setError(null);
        await loadSubcategories(categoryId); // se categoryId="" resetta e basta
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  // trigger lista quando cambiano filtri
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId]);

  return (
    <div className="space-y-4">
      {/* filtri */}
      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">Punto Vendita (opzionale)</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={pvId} onChange={(e) => setPvId(e.target.value)}>
            <option value="">— Tutti i PV —</option>
            {pvs.map((pv) => (
              <option key={pv.id} value={pv.id}>
                {pv.code} — {pv.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Se lasci “Tutti i PV”, vedrai gli inventari (eventualmente filtrati per categoria) di tutti i punti vendita.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Categoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— Tutte le categorie —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Se lasci “Tutte”, vedrai gli inventari di qualsiasi categoria (eventualmente filtrati per PV).
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Sottocategoria (opzionale)</label>
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={!canUseSubcategories || subcategories.length === 0}
          >
            <option value="">— Tutte —</option>
            {subcategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {!canUseSubcategories ? (
            <p className="text-xs text-gray-500 mt-1">Seleziona prima una categoria per usare le sottocategorie.</p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">Facoltativo: restringe l’inventario a una sola sottocategoria.</p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* lista inventari */}
      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 w-36">Data</th>
              <th className="text-left p-3">PV</th>
              <th className="text-left p-3">Categoria</th>
              <th className="text-left p-3">Sottocat</th>
              <th className="text-right p-3 w-28">Righe</th>
              <th className="text-right p-3 w-28">Pezzi</th>
              <th className="text-left p-3 w-36">Creato da</th>
              <th className="text-left p-3 w-32"></th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={8}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={8}>
                  Nessun inventario trovato con questi filtri.
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const isSel = selected?.key === r.key;
              return (
                <tr key={r.key} className={`border-t ${isSel ? "bg-yellow-50" : ""}`}>
                  <td className="p-3 font-medium">{r.inventory_date}</td>
                  <td className="p-3">
                    <div className="font-medium">{r.pv_code || r.pv_id}</div>
                    <div className="text-xs text-gray-500">{r.pv_name}</div>
                  </td>
                  <td className="p-3">{r.category_name || r.category_id}</td>
                  <td className="p-3">{r.subcategory_name || (r.subcategory_id ? r.subcategory_id : "—")}</td>
                  <td className="p-3 text-right">{r.lines_count}</td>
                  <td className="p-3 text-right font-semibold">{r.qty_sum}</td>
                  <td className="p-3">{r.created_by_username ?? "—"}</td>
                  <td className="p-3">
                    <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={() => loadDetail(r)}>
                      Dettaglio
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* dettaglio righe */}
      {selected && (
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">
                Dettaglio inventario — {selected.inventory_date} — {selected.pv_code} — {selected.category_name}
              </div>
              <div className="text-sm text-gray-600">
                Righe: <b>{selected.lines_count}</b> — Pezzi: <b>{selected.qty_sum}</b>
              </div>
            </div>

            <button
              className="rounded-xl border px-3 py-2 hover:bg-gray-50"
              onClick={() => {
                setSelected(null);
                setDetail([]);
                setDetailError(null);
              }}
            >
              Chiudi
            </button>
          </div>

          {detailLoading && <div className="text-sm text-gray-500">Carico righe...</div>}
          {detailError && <div className="text-sm text-red-600">{detailError}</div>}

          {!detailLoading && !detailError && (
            <div className="overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3 w-40">Codice</th>
                    <th className="text-left p-3">Descrizione</th>
                    <th className="text-right p-3 w-28">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((x) => (
                    <tr key={x.id} className="border-t">
                      <td className="p-3 font-medium">{x.code}</td>
                      <td className="p-3">{x.description}</td>
                      <td className="p-3 text-right font-semibold">{x.qty}</td>
                    </tr>
                  ))}
                  {detail.length === 0 && (
                    <tr className="border-t">
                      <td className="p-3 text-gray-500" colSpan={3}>
                        Nessuna riga trovata.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-xs text-gray-500">
            Prossimo step (Riscontro): qui useremo questo inventario selezionato per confrontarlo con il gestionale.
          </div>
        </div>
      )}
    </div>
  );
}

