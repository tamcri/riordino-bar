"use client";

import { useEffect, useMemo, useState } from "react";

type Category = { id: string; name: string; slug: string; is_active: boolean };
type Subcategory = { id: string; category_id: string; name: string; slug: string; is_active: boolean };

type Item = {
  id: string;
  code: string;
  description: string;
  is_active: boolean;
  category_id: string | null;
  subcategory_id: string | null;
  peso_kg?: number | null; // ✅
  conf_da?: number | null; // ✅ NEW
  prezzo_vendita_eur?: number | null; // ✅
};

function isTabacchiCategory(cat: Category | null | undefined) {
  if (!cat) return false;
  const slug = String(cat.slug || "").toLowerCase().trim();
  const name = String(cat.name || "").toLowerCase().trim();
  return slug === "tabacchi" || name.includes("tabacc");
}

function formatPesoKg(v: any) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const s = n.toFixed(n < 0.1 ? 3 : n < 1 ? 2 : 1);
  return s.replace(/\.?0+$/, "");
}

function formatEuro(v: any) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `€ ${n.toFixed(2)}`;
}

function formatConfDa(v: any) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return String(Math.trunc(n));
}

export default function ItemsClient({ isAdmin }: { isAdmin: boolean }) {
  // filtri
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [active, setActive] = useState<"1" | "0" | "all">("1");
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // modal modifica articolo
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editPesoKg, setEditPesoKg] = useState<string>("");
  const [editPrezzo, setEditPrezzo] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

  // import
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  // categorie
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  // admin: crea categoria/sottocategoria
  const [newCatName, setNewCatName] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [newSubCatId, setNewSubCatId] = useState("");

  const selectedCategory = useMemo(() => categories.find((c) => c.id === categoryId) || null, [categories, categoryId]);
  const showTabacchiCols = useMemo(() => isTabacchiCategory(selectedCategory), [selectedCategory]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (categoryId) p.set("category_id", categoryId);
    if (subcategoryId) p.set("subcategory_id", subcategoryId);
    p.set("active", active);
    if (q.trim()) p.set("q", q.trim());
    return `?${p.toString()}`;
  }, [categoryId, subcategoryId, active, q]);

  async function loadCategories() {
    const res = await fetch("/api/categories/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok && Array.isArray(json?.rows)) {
      setCategories(json.rows);
      if (!categoryId) {
        const first = json.rows.find((c: Category) => c.is_active) || json.rows[0];
        if (first?.id) setCategoryId(first.id);
      }
    }
  }

  async function loadSubcategories(catId: string) {
    if (!catId) {
      setSubcategories([]);
      return;
    }
    const res = await fetch(`/api/subcategories/list?category_id=${encodeURIComponent(catId)}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok && Array.isArray(json?.rows)) setSubcategories(json.rows);
  }

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/list${qs}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento");
      setRows(json.rows || []);
    } catch (e: any) {
      setError(e.message || "Errore");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSubcategories(categoryId);
    setSubcategoryId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  async function doImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    if (!categoryId) {
      setError("Seleziona una categoria prima di importare.");
      return;
    }

    setImporting(true);
    setMsg(null);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("category_id", categoryId);
      fd.append("subcategory_id", subcategoryId || "");
      fd.append("file", file);

      const res = await fetch("/api/items/import", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Import fallito");

      setMsg(`Import OK — Tot: ${json.total}, Inseriti: ${json.inserted}, Aggiornati: ${json.updated}`);
      setFile(null);
      await loadItems();
    } catch (e: any) {
      setError(e.message || "Errore import");
    } finally {
      setImporting(false);
    }
  }

  async function toggleActive(item: Item) {
    if (!isAdmin) return;

    const ok = confirm(`Vuoi ${item.is_active ? "disattivare" : "attivare"} ${item.code}?`);
    if (!ok) return;

    const res = await fetch("/api/items/update", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, is_active: !item.is_active }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      alert(json?.error || "Errore aggiornamento");
      return;
    }
    loadItems();
  }

  function openEditModal(item: Item) {
    if (!isAdmin) return;
    setMsg(null);
    setError(null);
    setEditItem(item);
    setEditDescription(item.description ?? "");
    setEditPesoKg(item.peso_kg == null ? "" : String(item.peso_kg));
    setEditPrezzo(item.prezzo_vendita_eur == null ? "" : String(item.prezzo_vendita_eur));
    setEditOpen(true);
  }

  function closeEditModal() {
    if (savingEdit) return;
    setEditOpen(false);
    setEditItem(null);
  }

  function normalizeNullableNumber(v: string): number | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return n;
  }

  async function saveEdit() {
    if (!isAdmin || !editItem) return;

    const nextDesc = editDescription.trim();
    if (!nextDesc) {
      setError("La descrizione non può essere vuota.");
      return;
    }

    setSavingEdit(true);
    setError(null);
    setMsg(null);

    try {
      const payload: any = {
        id: editItem.id,
        description: nextDesc,
        peso_kg: editPesoKg.trim() === "" ? null : normalizeNullableNumber(editPesoKg),
        prezzo_vendita_eur: editPrezzo.trim() === "" ? null : normalizeNullableNumber(editPrezzo),
      };

      const res = await fetch("/api/items/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore aggiornamento");

      setMsg("Articolo aggiornato.");
      setEditOpen(false);
      setEditItem(null);
      await loadItems();
    } catch (e: any) {
      setError(e.message || "Errore aggiornamento");
    } finally {
      setSavingEdit(false);
    }
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);

    const name = newCatName.trim();
    if (!name) return setError("Nome categoria obbligatorio.");

    const res = await fetch("/api/categories/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) return setError(json?.error || "Errore creazione categoria");

    setNewCatName("");
    await loadCategories();
    setMsg("Categoria creata.");
  }

  async function createSubcategory(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);

    const name = newSubName.trim();
    if (!newSubCatId) return setError("Seleziona la categoria padre.");
    if (!name) return setError("Nome sottocategoria obbligatorio.");

    const res = await fetch("/api/subcategories/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category_id: newSubCatId, name }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) return setError(json?.error || "Errore creazione sottocategoria");

    setNewSubName("");
    setMsg("Sottocategoria creata.");
    if (newSubCatId === categoryId) await loadSubcategories(categoryId);
  }

  return (
    <div className="space-y-4">
      {/* MODAL MODIFICA */}
      {editOpen && editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={closeEditModal}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Modifica articolo</div>
                <div className="text-sm text-gray-600">
                  Codice: <b>{editItem.code}</b>
                </div>
              </div>
              <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={closeEditModal} disabled={savingEdit}>
                Chiudi
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-3">
                <label className="block text-sm font-medium mb-2">Descrizione</label>
                <input className="w-full rounded-xl border p-3" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Peso (kg)</label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="decimal"
                  placeholder="Es. 0,032"
                  value={editPesoKg}
                  onChange={(e) => setEditPesoKg(e.target.value)}
                />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL.</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Prezzo di Vendita (€)</label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="decimal"
                  placeholder="Es. 6,50"
                  value={editPrezzo}
                  onChange={(e) => setEditPrezzo(e.target.value)}
                />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL.</div>
              </div>

              <div className="flex items-end">
                <button
                  className="w-full rounded-xl bg-slate-900 text-white px-4 py-3 disabled:opacity-60"
                  onClick={saveEdit}
                  disabled={savingEdit}
                >
                  {savingEdit ? "Salvo..." : "Salva"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* admin: crea categoria/sottocategoria */}
      {isAdmin && (
        <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <form onSubmit={createCategory} className="space-y-2">
            <div className="font-semibold">Crea Categoria</div>
            <input className="w-full rounded-xl border p-3" placeholder="Es. Food" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} />
            <button className="rounded-xl bg-slate-900 text-white px-4 py-2">Crea</button>
          </form>

          <form onSubmit={createSubcategory} className="space-y-2">
            <div className="font-semibold">Crea Sottocategoria</div>
            <select className="w-full rounded-xl border p-3 bg-white" value={newSubCatId} onChange={(e) => setNewSubCatId(e.target.value)}>
              <option value="">— Seleziona categoria padre —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="w-full rounded-xl border p-3" placeholder="Es. Cornetti" value={newSubName} onChange={(e) => setNewSubName(e.target.value)} />
            <button className="rounded-xl bg-slate-900 text-white px-4 py-2">Crea</button>
          </form>
        </div>
      )}

      {/* filtri */}
      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-2">Categoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— Seleziona —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-2">Sottocategoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={!categoryId}>
            <option value="">— Nessuna —</option>
            {subcategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Stato</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={active} onChange={(e) => setActive(e.target.value as any)}>
            <option value="1">Attivi</option>
            <option value="0">Disattivi</option>
            <option value="all">Tutti</option>
          </select>
        </div>

        <div className="md:col-span-5">
          <label className="block text-sm font-medium mb-2">Cerca</label>
          <input className="w-full rounded-xl border p-3" placeholder="Codice o descrizione..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {/* import (solo admin) */}
      {isAdmin && (
        <form onSubmit={doImport} className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Import articoli (Excel)</div>
              <div className="text-sm text-gray-600">Seleziona categoria/sottocategoria e importa. (Excel: Codice/Descrizione)</div>
            </div>
            <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" disabled={!file || importing}>
              {importing ? "Importo..." : "Importa"}
            </button>
          </div>

          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file && (
            <div className="text-sm text-gray-600">
              Selezionato: <b>{file.name}</b>
            </div>
          )}
        </form>
      )}

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* tabella */}
      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Codice</th>
              <th className="text-left p-3">Descrizione</th>

              {/* ✅ SOLO TABACCHI */}
              {showTabacchiCols && <th className="text-right p-3 w-32">Peso (kg)</th>}
              {showTabacchiCols && <th className="text-right p-3 w-28">Conf. da</th>}
              {showTabacchiCols && <th className="text-right p-3 w-40">Prezzo di Vendita</th>}

              <th className="text-left p-3">Attivo</th>
              <th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={showTabacchiCols ? 7 : 4}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={showTabacchiCols ? 7 : 4}>
                  Nessun articolo trovato.
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.code}</td>
                <td className="p-3">{r.description}</td>

                {/* ✅ SOLO TABACCHI */}
                {showTabacchiCols && <td className="p-3 text-right font-medium">{formatPesoKg(r.peso_kg)}</td>}
                {showTabacchiCols && <td className="p-3 text-right font-medium">{formatConfDa(r.conf_da)}</td>}
                {showTabacchiCols && <td className="p-3 text-right font-medium">{formatEuro(r.prezzo_vendita_eur)}</td>}

                <td className="p-3">{r.is_active ? "SI" : "NO"}</td>
                <td className="p-3">
                  {isAdmin ? (
                    <div className="flex gap-2">
                      <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={() => openEditModal(r)}>
                        Modifica
                      </button>
                      <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={() => toggleActive(r)}>
                        {r.is_active ? "Disattiva" : "Attiva"}
                      </button>
                    </div>
                  ) : (
                    <span className="text-gray-400">Solo admin</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}






