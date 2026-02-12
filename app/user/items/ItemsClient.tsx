// app/user/items/ItemsClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Category = { id: string; name: string; slug: string; is_active: boolean };
type Subcategory = { id: string; category_id: string; name: string; slug: string; is_active: boolean };

type Item = {
  id: string;
  code: string;
  description: string;
  barcode?: string | null;
  um?: string | null;
  is_active: boolean;
  category_id: string | null;
  subcategory_id: string | null;
  peso_kg?: number | null;
  conf_da?: number | null;
  prezzo_vendita_eur?: number | null;
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

function formatConfDa(v: any) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return String(Math.trunc(n));
}

function formatUm(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return "—";
  return s;
}

// ✅ Euro in formato IT: € 1,30 | € 132,50 | € 1.234,56
function formatEuroIT(v: any) {
  if (v == null || v === "") return "—";
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return "—";

  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const intWithThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `€ ${intWithThousands},${decPart}`;
}

// ✅ filename safe
function slugifyFilename(v: string) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "export";
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ✅ barcode-like (8–14 cifre)
function isBarcodeLike(v: string) {
  const s = String(v ?? "").trim();
  return /^\d{8,14}$/.test(s);
}

export default function ItemsClient({ isAdmin }: { isAdmin: boolean }) {
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [active, setActive] = useState<"1" | "0" | "all">("1");
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // MODAL EDIT
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);

  // ✅ nuovo: codice editabile
  const [editCode, setEditCode] = useState("");

  const [editDescription, setEditDescription] = useState("");
  const [editBarcode, setEditBarcode] = useState<string>("");
  const [editUm, setEditUm] = useState<string>("");
  const [editPesoKg, setEditPesoKg] = useState<string>("");
  const [editConfDa, setEditConfDa] = useState<string>("");
  const [editPrezzo, setEditPrezzo] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

  // IMPORT + PREVIEW
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // CATEGORIE
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  // CREATE CAT/SUB (admin)
  const [newCatName, setNewCatName] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [newSubCatId, setNewSubCatId] = useState("");

  // ✅ EXPORT EXCEL (admin)
  const [exporting, setExporting] = useState(false);

  // ✅ ASSEGNA BARCODE (admin)
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignCode, setAssignCode] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // ✅ PREVIEW articolo per assegnazione barcode
  const [assignPreviewLoading, setAssignPreviewLoading] = useState(false);
  const [assignPreviewError, setAssignPreviewError] = useState<string | null>(null);
  const [assignPreviewItem, setAssignPreviewItem] = useState<Item | null>(null);

  const selectedCategory = useMemo(() => categories.find((c) => c.id === categoryId) || null, [categories, categoryId]);
  const selectedSubcategory = useMemo(
    () => subcategories.find((s) => s.id === subcategoryId) || null,
    [subcategories, subcategoryId]
  );

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

  // ✅ Mostra box assegnazione: solo admin, barcode-like, nessun risultato
  const qTrim = q.trim();
  const showAssignBox = useMemo(() => {
    if (!isAdmin) return false;
    if (!categoryId) return false;
    if (loading) return false;
    if (!qTrim) return false;
    if (!isBarcodeLike(qTrim)) return false;
    return rows.length === 0;
  }, [isAdmin, categoryId, loading, qTrim, rows.length]);

  useEffect(() => {
    // apre/chiude automaticamente il box quando cambiano le condizioni
    if (showAssignBox) {
      setAssignOpen(true);
    } else {
      setAssignOpen(false);
      setAssignCode("");
      setAssignError(null);
      setAssigning(false);

      // ✅ reset preview
      setAssignPreviewLoading(false);
      setAssignPreviewError(null);
      setAssignPreviewItem(null);
    }
  }, [showAssignBox]);

  // ✅ Carica preview articolo quando scrivo il codice (mostra descrizione ecc)
  useEffect(() => {
    let alive = true;

    async function fetchPreview() {
      if (!assignOpen || !showAssignBox) return;

      const code = assignCode.trim();
      if (!code) {
        setAssignPreviewError(null);
        setAssignPreviewItem(null);
        setAssignPreviewLoading(false);
        return;
      }

      setAssignPreviewLoading(true);
      setAssignPreviewError(null);
      setAssignPreviewItem(null);

      try {
        // uso l'endpoint già esistente per cercare il codice nella categoria selezionata
        const p = new URLSearchParams();
        p.set("category_id", categoryId);
        p.set("active", "all");
        p.set("q", code);

        const res = await fetch(`/api/items/list?${p.toString()}`);
        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore preview articolo");

        const list: Item[] = Array.isArray(json?.rows) ? json.rows : [];

        // preferisco match esatto sul codice (case-insensitive), altrimenti primo risultato
        const exact = list.find((r) => String(r.code).trim().toLowerCase() === code.toLowerCase()) || null;
        const picked = exact || list[0] || null;

        if (!alive) return;

        if (!picked) {
          setAssignPreviewItem(null);
          setAssignPreviewError("Nessun articolo trovato per questo codice nella categoria selezionata.");
        } else {
          setAssignPreviewItem(picked);
          setAssignPreviewError(null);
        }
      } catch (e: any) {
        if (!alive) return;
        setAssignPreviewItem(null);
        setAssignPreviewError(e?.message || "Errore preview articolo");
      } finally {
        if (!alive) return;
        setAssignPreviewLoading(false);
      }
    }

    const t = setTimeout(fetchPreview, 250); // piccolo debounce
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [assignCode, assignOpen, showAssignBox, categoryId]);

  // PREVIEW IMPORT
  async function loadImportPreview(nextFile: File | null) {
    setPreviewError(null);
    setPreviewRows([]);
    if (!nextFile) return;

    setPreviewLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", nextFile);
      fd.append("max_rows", "20");

      const res = await fetch("/api/items/preview", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Preview non disponibile");

      setPreviewRows(Array.isArray(json?.rows) ? json.rows : []);
    } catch (e: any) {
      setPreviewError(e?.message || "Errore preview");
      setPreviewRows([]);
    } finally {
      setPreviewLoading(false);
    }
  }

  // IMPORT
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

      if (json.mode === "barcode") {
        setMsg(`Import BARCODE OK — Tot: ${json.total}, Aggiornati: ${json.updated}, Non trovati: ${json.not_found}`);
      } else {
        const inserted = json.inserted ?? 0;
        const updated = json.updated ?? 0;
        setMsg(`Import OK — Tot: ${json.total}, Inseriti: ${inserted}, Aggiornati: ${updated}`);
      }

      setFile(null);
      setPreviewRows([]);
      await loadItems();
    } catch (e: any) {
      setError(e.message || "Errore import");
    } finally {
      setImporting(false);
    }
  }

  // ✅ EXPORT EXCEL
  async function exportExcel() {
    if (!isAdmin) return;

    if (!categoryId) {
      setError("Seleziona una categoria prima di esportare.");
      return;
    }

    setExporting(true);
    setMsg(null);
    setError(null);

    try {
      // export rispecchia filtri correnti (categoria/sottocategoria + stato + ricerca)
      const url = `/api/items/export${qs}`;

      const res = await fetch(url, { method: "GET" });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "Export fallito");
      }

      const blob = await res.blob();

      const catPart = slugifyFilename(selectedCategory?.slug || selectedCategory?.name || "categoria");
      const subPart = subcategoryId ? slugifyFilename(selectedSubcategory?.slug || selectedSubcategory?.name || "sottocategoria") : "";
      const datePart = todayISO();
      const fname = `anagrafica-articoli_${catPart}${subPart ? `_${subPart}` : ""}_${datePart}.xlsx`;

      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);

      setMsg("Export Excel avviato.");
    } catch (e: any) {
      setError(e?.message || "Errore export");
    } finally {
      setExporting(false);
    }
  }

  // ✅ ASSEGNA BARCODE -> CODICE (solo admin)
  async function assignBarcodeToCode() {
    if (!isAdmin) return;
    if (!categoryId) return;

    const barcode = qTrim;
    const code = assignCode.trim();

    setAssignError(null);

    if (!isBarcodeLike(barcode)) {
      setAssignError("Barcode non valido.");
      return;
    }
    if (!code) {
      setAssignError("Inserisci il codice articolo.");
      return;
    }

    setAssigning(true);
    setMsg(null);
    setError(null);

    try {
      const res = await fetch("/api/items/assign-barcode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category_id: categoryId, code, barcode }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Assegnazione fallita");

      setMsg(`Barcode ${barcode} assegnato a ${code}.`);
      setAssignCode("");
      setAssignError(null);

      // ✅ richiesto: dopo l'assegnazione, azzero il campo Cerca
      setQ("");

      // ricarico: ora cercando quel barcode dovrei vedere la riga (se l’utente lo riscrive)
      await loadItems();
    } catch (e: any) {
      setAssignError(e?.message || "Errore assegnazione barcode");
    } finally {
      setAssigning(false);
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

    setEditCode(item.code ?? "");
    setEditDescription(item.description ?? "");
    setEditBarcode(item.barcode == null ? "" : String(item.barcode));
    setEditUm(item.um == null ? "" : String(item.um));
    setEditPesoKg(item.peso_kg == null ? "" : String(item.peso_kg));
    setEditConfDa(item.conf_da == null ? "" : String(item.conf_da));
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

  function normalizeNullableInt(v: string): number | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.trunc(n));
  }

  function normalizeNullableText(v: string): string | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    return s;
  }

  async function saveEdit() {
    if (!isAdmin || !editItem) return;

    const nextCode = editCode.trim();
    if (!nextCode) {
      setError("Il codice non può essere vuoto.");
      return;
    }

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
        code: nextCode, // ✅ update codice
        description: nextDesc,
        barcode: normalizeNullableText(editBarcode),
        um: normalizeNullableText(editUm),
        peso_kg: editPesoKg.trim() === "" ? null : normalizeNullableNumber(editPesoKg),
        conf_da: editConfDa.trim() === "" ? null : normalizeNullableInt(editConfDa),
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
                  ID: <span className="font-mono text-xs">{editItem.id}</span>
                </div>
              </div>
              <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={closeEditModal} disabled={savingEdit}>
                Chiudi
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2">Codice</label>
                <input className="w-full rounded-xl border p-3" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                <div className="mt-1 text-xs text-gray-500">Il codice deve restare unico nella categoria (e sottocategoria).</div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2">UM (Unità di misura)</label>
                <input className="w-full rounded-xl border p-3" placeholder="Es. PZ, KG, LT" value={editUm} onChange={(e) => setEditUm(e.target.value)} />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL.</div>
              </div>

              <div className="md:col-span-4">
                <label className="block text-sm font-medium mb-2">Descrizione</label>
                <input className="w-full rounded-xl border p-3" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </div>

              <div className="md:col-span-4">
                <label className="block text-sm font-medium mb-2">Barcode</label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="numeric"
                  placeholder="Es. 8001234567890"
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL.</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Peso (kg)</label>
                <input className="w-full rounded-xl border p-3" inputMode="decimal" placeholder="Es. 0,032" value={editPesoKg} onChange={(e) => setEditPesoKg(e.target.value)} />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL.</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Conf. da</label>
                <input className="w-full rounded-xl border p-3" inputMode="numeric" placeholder="Es. 10" value={editConfDa} onChange={(e) => setEditConfDa(e.target.value)} />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL (default 10 nel riordino).</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Prezzo di Vendita</label>
                <input className="w-full rounded-xl border p-3" inputMode="decimal" placeholder="Es. 6,50" value={editPrezzo} onChange={(e) => setEditPrezzo(e.target.value)} />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL.</div>
              </div>

              <div className="flex items-end">
                <button className="w-full rounded-xl bg-slate-900 text-white px-4 py-3 disabled:opacity-60" onClick={saveEdit} disabled={savingEdit}>
                  {savingEdit ? "Salvo..." : "Salva"}
                </button>
              </div>
            </div>

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
          </div>
        </div>
      )}

      {/* CREATE CATEGORY / SUBCATEGORY (solo admin) */}
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

      {/* FILTRI */}
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

        {/* ✅ EXPORT EXCEL (solo admin) */}
        {isAdmin && (
          <div className="md:col-span-5 flex items-center justify-end">
            <button
              type="button"
              className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
              onClick={exportExcel}
              disabled={exporting || !categoryId}
              title={!categoryId ? "Seleziona una categoria" : "Esporta gli articoli filtrati in Excel"}
            >
              {exporting ? "Esporto..." : "Esporta Excel"}
            </button>
          </div>
        )}
      </div>

      {/* ✅ BOX ASSEGNA BARCODE (solo admin) */}
      {assignOpen && showAssignBox && (
        <div className="rounded-2xl border bg-amber-50 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-semibold">Barcode non trovato</div>
              <div className="text-sm text-gray-700">
                Barcode: <span className="font-mono">{qTrim}</span> — vuoi assegnarlo a un articolo esistente?
              </div>
              <div className="text-xs text-gray-600 mt-1">Inserisci il CODICE articolo (nella categoria selezionata) e conferma.</div>
            </div>

            <div className="flex gap-2 items-center">
              <input
                className="w-44 rounded-xl border p-3"
                placeholder="Codice articolo"
                value={assignCode}
                onChange={(e) => setAssignCode(e.target.value)}
                disabled={assigning}
              />
              <button
                type="button"
                className="rounded-xl bg-slate-900 text-white px-4 py-3 disabled:opacity-60"
                onClick={assignBarcodeToCode}
                disabled={assigning}
              >
                {assigning ? "Assegno..." : "Assegna barcode"}
              </button>
            </div>
          </div>

          {/* ✅ PREVIEW ARTICOLO */}
          <div className="mt-3">
            {assignPreviewLoading && <div className="text-sm text-gray-700">Cerco articolo...</div>}

            {!assignPreviewLoading && assignCode.trim() !== "" && assignPreviewItem && (
              <div className="rounded-xl border bg-white p-3 text-sm">
                <div className="font-semibold mb-1">Articolo selezionato</div>
                <div>
                  <b>Codice:</b> {assignPreviewItem.code}
                </div>
                <div>
                  <b>Descrizione:</b> {assignPreviewItem.description}
                </div>
                <div>
                  <b>UM:</b> {formatUm(assignPreviewItem.um)}
                </div>
                <div>
                  <b>Prezzo:</b> {formatEuroIT(assignPreviewItem.prezzo_vendita_eur)}
                </div>

                {showTabacchiCols && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <b>Peso (kg):</b> {formatPesoKg(assignPreviewItem.peso_kg)}
                    </div>
                    <div>
                      <b>Conf. da:</b> {formatConfDa(assignPreviewItem.conf_da)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!assignPreviewLoading && assignCode.trim() !== "" && !assignPreviewItem && assignPreviewError && (
              <div className="text-sm text-red-700">{assignPreviewError}</div>
            )}
          </div>

          {assignError && <div className="mt-2 text-sm text-red-700">{assignError}</div>}
        </div>
      )}

      {/* ✅ IMPORT EXCEL (solo admin) — RIPRISTINATO */}
      {isAdmin && (
        <form onSubmit={doImport} className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Carica file Excel</div>
              <div className="text-sm text-gray-600">Seleziona categoria/sottocategoria e importa. (Preview: Codice, Descrizione, Barcode, UM, Prezzo)</div>
            </div>
            <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" disabled={!file || importing}>
              {importing ? "Importo..." : "Importa"}
            </button>
          </div>

          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setFile(f);
              loadImportPreview(f);
            }}
          />

          {file && (
            <div className="text-sm text-gray-600">
              Selezionato: <b>{file.name}</b>
            </div>
          )}

          {file && (
            <div className="rounded-xl border bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Anteprima import (prime righe)</div>
                <button type="button" className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" onClick={() => loadImportPreview(file)} disabled={previewLoading}>
                  {previewLoading ? "Carico..." : "Ricarica"}
                </button>
              </div>

              <div className="mt-2 text-xs text-gray-600">Mostro solo: Codice, Descrizione, Barcode, UM, Prezzo. (La Q.tà del file viene ignorata.)</div>

              {previewError && <div className="mt-2 text-sm text-red-600">{previewError}</div>}

              {!previewError && previewRows.length === 0 && !previewLoading && <div className="mt-2 text-sm text-gray-600">Nessuna riga da mostrare.</div>}

              {previewRows.length > 0 && (
                <div className="mt-3 overflow-auto rounded-xl border bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-2">Codice</th>
                        <th className="text-left p-2">Descrizione</th>
                        <th className="text-left p-2">Barcode</th>
                        <th className="text-left p-2">UM</th>
                        <th className="text-left p-2">Prezzo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2 font-medium">{r.code || "—"}</td>
                          <td className="p-2">{r.description || "—"}</td>
                          <td className="p-2 font-mono text-xs">{r.barcode || "—"}</td>
                          <td className="p-2">{r.um || "—"}</td>
                          <td className="p-2">{r.prezzo || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* LISTA */}
      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Codice</th>
              <th className="text-left p-3">Descrizione</th>
              <th className="text-left p-3 w-48">Barcode</th>
              <th className="text-left p-3 w-20">UM</th>

              {/* ✅ PREZZO SEMPRE VISIBILE */}
              <th className="text-right p-3 w-36">Prezzo</th>

              {showTabacchiCols && <th className="text-right p-3 w-32">Peso (kg)</th>}
              {showTabacchiCols && <th className="text-right p-3 w-28">Conf. da</th>}

              <th className="text-left p-3">Attivo</th>
              <th className="text-left p-3"></th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={showTabacchiCols ? 9 : 7}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={showTabacchiCols ? 9 : 7}>
                  Nessun articolo trovato.
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.code}</td>
                <td className="p-3">{r.description}</td>
                <td className="p-3 font-mono text-xs">{r.barcode ? String(r.barcode) : "—"}</td>
                <td className="p-3">{formatUm(r.um)}</td>
                <td className="p-3 text-right">{formatEuroIT(r.prezzo_vendita_eur)}</td>

                {showTabacchiCols && <td className="p-3 text-right">{formatPesoKg(r.peso_kg)}</td>}
                {showTabacchiCols && <td className="p-3 text-right">{formatConfDa(r.conf_da)}</td>}

                <td className="p-3">{r.is_active ? "Sì" : "No"}</td>
                <td className="p-3 text-right">
                  {isAdmin && (
                    <div className="flex items-center justify-end gap-2">
                      <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={() => openEditModal(r)}>
                        Modifica
                      </button>
                      <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={() => toggleActive(r)}>
                        {r.is_active ? "Disattiva" : "Attiva"}
                      </button>
                    </div>
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
















