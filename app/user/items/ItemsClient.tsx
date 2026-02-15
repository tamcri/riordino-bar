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

  // ✅ NEW: per liquidi -> ml per pezzo (es. 700, 750, 1000)
  volume_ml_per_unit?: number | null;
};

type VolumeImportResult = {
  ok: boolean;
  mode?: string;
  total_rows?: number;
  codes_in_file?: number;
  updated?: number;
  skipped_already_set?: number;
  not_found?: number;
  lists_limit?: number;
  not_found_codes?: string[];
  skipped_codes?: string[];
  updated_codes?: string[];
  detected_columns?: { code?: string; um2?: string | null; litri?: string };
  error?: string;
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

function listToText(list: string[] | undefined) {
  return (Array.isArray(list) ? list : []).join("\n");
}

async function copyToClipboard(text: string) {
  const t = String(text || "");
  if (!t.trim()) return;
  try {
    await navigator.clipboard.writeText(t);
    alert("Copiato!");
  } catch {
    // fallback vecchio stile
    const ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    alert("Copiato!");
  }
}

function downloadCSV(filename: string, codes: string[]) {
  const list = (codes || []).map((c) => String(c).trim()).filter(Boolean);
  const csv = ["code", ...list].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
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

  // ✅ NEW: ML per pezzo (solo liquidi)
  const [editVolumeMl, setEditVolumeMl] = useState<string>("");

  const [savingEdit, setSavingEdit] = useState(false);

  // ✅ MULTI-BARCODE (item_barcodes)
  const [editBarcodes, setEditBarcodes] = useState<string[]>([]);
  const [barcodesLoading, setBarcodesLoading] = useState(false);
  const [barcodesError, setBarcodesError] = useState<string | null>(null);
  const [newExtraBarcode, setNewExtraBarcode] = useState("");
  const [barcodesSaving, setBarcodesSaving] = useState(false);

  // IMPORT + PREVIEW
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ✅ MODALITÀ IMPORT (standard | barcode-map)
  const [importMode, setImportMode] = useState<"standard" | "barcode-map">("standard");

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

  // ✅ IMPORT ML (solo admin)
  const [volumeFile, setVolumeFile] = useState<File | null>(null);
  const [volumeImporting, setVolumeImporting] = useState(false);

  // ✅ NEW: risultato import ML (per mostrare liste)
  const [volumeResult, setVolumeResult] = useState<VolumeImportResult | null>(null);

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
    const res = await fetch(`/api/subcategories/list?category_id=${encodeURIComponent(catId)}`, {
      cache: "no-store",
    });
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
    if (showAssignBox) {
      setAssignOpen(true);
    } else {
      setAssignOpen(false);
      setAssignCode("");
      setAssignError(null);
      setAssigning(false);

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
        const p = new URLSearchParams();
        p.set("category_id", categoryId);
        p.set("active", "all");
        p.set("q", code);

        const res = await fetch(`/api/items/list?${p.toString()}`);
        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore preview articolo");

        const list: Item[] = Array.isArray(json?.rows) ? json.rows : [];
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

    const t = setTimeout(fetchPreview, 250);
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

      if (importMode === "barcode-map") {
        fd.append("mode", "barcode-map");
      }

      const res = await fetch("/api/items/import", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Import fallito");

      if (json.mode === "barcode-map") {
        const extraInfo: string[] = [];
        if (typeof json.rows_with_no_barcode === "number" && json.rows_with_no_barcode > 0) {
          extraInfo.push(`Righe senza barcode: ${json.rows_with_no_barcode}`);
        }
        if (typeof json.skipped_no_code === "number" && json.skipped_no_code > 0) {
          extraInfo.push(`Righe senza codice: ${json.skipped_no_code}`);
        }

        setMsg(
          `Import BARCODE-MAP OK — Righe: ${json.total_rows}, Inseriti: ${json.inserted}, Già presenti: ${json.skipped_existing}, ` +
            `Conflict: ${json.conflicts}, Articoli non trovati: ${json.not_found}` +
            (extraInfo.length ? ` — ${extraInfo.join(", ")}` : "")
        );
      } else if (json.mode === "barcode") {
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

  // ✅ IMPORT ML da Excel (solo admin)
  async function importVolumeMl() {
    if (!isAdmin) return;

    if (!volumeFile) {
      setError("Seleziona il file Excel con articoli UM = LT.");
      return;
    }

    setVolumeImporting(true);
    setMsg(null);
    setError(null);
    setVolumeResult(null);

    try {
      const fd = new FormData();
      fd.append("file", volumeFile);

      const res = await fetch("/api/items/import-volume-ml", { method: "POST", body: fd });
      const json: VolumeImportResult = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error((json as any)?.error || "Import volume ML fallito");

      setVolumeResult(json);

      const u = Number(json.updated ?? 0);
      const nf = Number(json.not_found ?? 0);
      const sk = Number(json.skipped_already_set ?? 0);

      setMsg(`Aggiornati ${u} articoli. Saltati (già valorizzati): ${sk}. Non trovati: ${nf}.`);
      setVolumeFile(null);
      await loadItems();
    } catch (e: any) {
      setError(e?.message || "Errore import volume ML");
    } finally {
      setVolumeImporting(false);
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
      const url = `/api/items/export${qs}`;
      const res = await fetch(url, { method: "GET" });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "Export fallito");
      }

      const blob = await res.blob();

      const catPart = slugifyFilename(selectedCategory?.slug || selectedCategory?.name || "categoria");
      const subPart = subcategoryId
        ? slugifyFilename(selectedSubcategory?.slug || selectedSubcategory?.name || "sottocategoria")
        : "";
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
      setQ("");
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

  async function loadBarcodesForItem(itemId: string, legacyBarcode: string) {
    setBarcodesLoading(true);
    setBarcodesError(null);

    try {
      const res = await fetch(`/api/items/barcodes?item_id=${encodeURIComponent(itemId)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento barcode associati");

      const list: string[] = Array.isArray(json?.barcodes) ? json.barcodes : [];
      const uniq = Array.from(new Set(list.map((x) => String(x).trim()).filter(Boolean)));

      const legacy = String(legacyBarcode || "").trim();
      const merged = legacy ? Array.from(new Set([legacy, ...uniq])) : uniq;

      setEditBarcodes(merged);
    } catch (e: any) {
      setEditBarcodes([]);
      setBarcodesError(e?.message || "Errore caricamento barcode associati");
    } finally {
      setBarcodesLoading(false);
    }
  }

  async function addExtraBarcode() {
    if (!isAdmin || !editItem) return;

    const b = String(newExtraBarcode || "").trim();
    if (!isBarcodeLike(b)) {
      setBarcodesError("Barcode non valido (8–14 cifre consigliate, accetto 6–14).");
      return;
    }

    setBarcodesSaving(true);
    setBarcodesError(null);

    try {
      const res = await fetch("/api/items/barcodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: editItem.id, barcode: b }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore aggiunta barcode");

      setNewExtraBarcode("");
      await loadBarcodesForItem(editItem.id, editBarcode);
      await loadItems();
    } catch (e: any) {
      setBarcodesError(e?.message || "Errore aggiunta barcode");
    } finally {
      setBarcodesSaving(false);
    }
  }

  async function removeExtraBarcode(b: string) {
    if (!isAdmin || !editItem) return;

    const barcode = String(b || "").trim();
    if (!barcode) return;

    if (barcode === String(editBarcode || "").trim()) {
      alert("Questo è il barcode principale nel campo 'Barcode'. Se vuoi rimuoverlo, svuota il campo e salva.");
      return;
    }

    const ok = confirm(`Rimuovere il barcode ${barcode} da questo articolo?`);
    if (!ok) return;

    setBarcodesSaving(true);
    setBarcodesError(null);

    try {
      const res = await fetch("/api/items/barcodes", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: editItem.id, barcode }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore rimozione barcode");

      await loadBarcodesForItem(editItem.id, editBarcode);
      await loadItems();
    } catch (e: any) {
      setBarcodesError(e?.message || "Errore rimozione barcode");
    } finally {
      setBarcodesSaving(false);
    }
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

    // ✅ NEW
    setEditVolumeMl(item.volume_ml_per_unit == null ? "" : String(item.volume_ml_per_unit));

    setEditBarcodes([]);
    setNewExtraBarcode("");
    setBarcodesError(null);
    loadBarcodesForItem(item.id, item.barcode == null ? "" : String(item.barcode));

    setEditOpen(true);
  }

  function closeEditModal() {
    if (savingEdit || barcodesSaving) return;
    setEditOpen(false);
    setEditItem(null);
    setEditBarcodes([]);
    setNewExtraBarcode("");
    setBarcodesError(null);
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
        code: nextCode,
        description: nextDesc,
        barcode: normalizeNullableText(editBarcode),
        um: normalizeNullableText(editUm),
        peso_kg: editPesoKg.trim() === "" ? null : normalizeNullableNumber(editPesoKg),
        conf_da: editConfDa.trim() === "" ? null : normalizeNullableInt(editConfDa),
        prezzo_vendita_eur: editPrezzo.trim() === "" ? null : normalizeNullableNumber(editPrezzo),

        // ✅ NEW: ml per pezzo (solo liquidi). Vuoto => null
        volume_ml_per_unit: editVolumeMl.trim() === "" ? null : normalizeNullableInt(editVolumeMl),
      };

      const res = await fetch("/api/items/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore aggiornamento");

      const mainB = String(editBarcode || "").trim();
      if (mainB) {
        await fetch("/api/items/barcodes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item_id: editItem.id, barcode: mainB }),
        }).catch(() => null);
      }

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
              <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={closeEditModal} disabled={savingEdit || barcodesSaving}>
                Chiudi
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2">Codice</label>
                <input className="w-full rounded-xl border p-3" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                <div className="mt-1 text-xs text-gray-500">Il codice deve essere univoco (globale).</div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2">UM (Unità di misura)</label>
                <input
                  className="w-full rounded-xl border p-3"
                  placeholder="Es. PZ, KG, LT"
                  value={editUm}
                  onChange={(e) => setEditUm(e.target.value)}
                />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL.</div>
              </div>

              <div className="md:col-span-4">
                <label className="block text-sm font-medium mb-2">Descrizione</label>
                <input className="w-full rounded-xl border p-3" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </div>

              <div className="md:col-span-4">
                <label className="block text-sm font-medium mb-2">Barcode (principale)</label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="numeric"
                  placeholder="Es. 8001234567890"
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                />
                <div className="mt-1 text-xs text-gray-500">
                  Questo resta il barcode “principale” per compatibilità. Sotto trovi la lista completa.
                </div>
              </div>

              {/* ✅ NEW: ML per pezzo */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2">ML per pezzo (solo liquidi)</label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="numeric"
                  placeholder="Es. 700, 750, 1000"
                  value={editVolumeMl}
                  onChange={(e) => setEditVolumeMl(e.target.value)}
                />
                <div className="mt-1 text-xs text-gray-500">
                  Se valorizzato, il sistema può lavorare in ML (scarico cocktail, import gestionale coerente).
                </div>
              </div>

              <div className="md:col-span-2 rounded-xl border bg-slate-50 p-3">
                <div className="text-sm font-medium">Esempi rapidi</div>
                <div className="mt-1 text-xs text-gray-600">
                  Bottiglia 1L → <b>1000</b> • 0,75L → <b>750</b> • 0,70L → <b>700</b>
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  Se lasci vuoto: l’articolo resta “a pezzi”.
                </div>
              </div>

              {/* ✅ LISTA BARCODE ASSOCIATI */}
              <div className="md:col-span-4 rounded-xl border bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">Barcode associati (tutti)</div>
                  {barcodesLoading && <div className="text-xs text-gray-600">Carico...</div>}
                </div>

                {barcodesError && <div className="mt-2 text-sm text-red-600">{barcodesError}</div>}

                {!barcodesLoading && editBarcodes.length === 0 && <div className="mt-2 text-sm text-gray-600">Nessun barcode associato.</div>}

                {editBarcodes.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {editBarcodes.map((b) => (
                      <div key={b} className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2">
                        <div className="font-mono text-xs">{b}</div>
                        <button
                          type="button"
                          className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
                          onClick={() => removeExtraBarcode(b)}
                          disabled={barcodesSaving}
                          title={b === String(editBarcode || "").trim() ? "È il barcode principale" : "Rimuovi"}
                        >
                          Rimuovi
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <input
                    className="w-full rounded-xl border p-3"
                    inputMode="numeric"
                    placeholder="Aggiungi barcode extra..."
                    value={newExtraBarcode}
                    onChange={(e) => setNewExtraBarcode(e.target.value)}
                    disabled={barcodesSaving}
                  />
                  <button
                    type="button"
                    className="rounded-xl bg-slate-900 text-white px-4 py-3 disabled:opacity-60"
                    onClick={addExtraBarcode}
                    disabled={barcodesSaving}
                  >
                    {barcodesSaving ? "..." : "Aggiungi"}
                  </button>
                </div>

                <div className="mt-1 text-xs text-gray-500">
                  Se provi ad aggiungere un barcode già assegnato a un altro articolo, ti blocca.
                </div>
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
                <label className="block text-sm font-medium mb-2">Conf. da</label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="numeric"
                  placeholder="Es. 10"
                  value={editConfDa}
                  onChange={(e) => setEditConfDa(e.target.value)}
                />
                <div className="mt-1 text-xs text-gray-500">Lascia vuoto per NULL (default 10 nel riordino).</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Prezzo di Vendita</label>
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
                  disabled={savingEdit || barcodesSaving}
                >
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
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={!categoryId}
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

      {/* ✅ IMPORT ML (solo admin) */}
      {isAdmin && (
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">🔄 Aggiorna anagrafica: LT → ML</div>
              <div className="text-sm text-gray-600">
                Carica l’Excel del gestionale con i prodotti in <b>UM = LT</b>. Il backend calcola e salva <b>volume_ml_per_unit</b>.
              </div>
            </div>

            <button
              type="button"
              className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
              onClick={importVolumeMl}
              disabled={!volumeFile || volumeImporting}
              title={!volumeFile ? "Seleziona un file" : "Aggiorna ML"}
            >
              {volumeImporting ? "Importo..." : "Aggiorna ML"}
            </button>
          </div>

          <input type="file" accept=".xlsx,.xls" onChange={(e) => setVolumeFile(e.target.files?.[0] || null)} />

          {volumeFile && (
            <div className="text-sm text-gray-600">
              Selezionato: <b>{volumeFile.name}</b>
            </div>
          )}

          <div className="text-xs text-gray-500">Esempio: 0,7 LT → 700 ML • 0,75 LT → 750 ML • 1 LT → 1000 ML</div>

          {/* ✅ RISULTATI DETTAGLIATI */}
          {volumeResult?.ok && (
            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* UPDATED */}
              <div className="rounded-xl border bg-emerald-50 p-3">
                <div className="font-semibold">✅ Aggiornati</div>
                <div className="text-sm text-gray-700 mt-1">
                  {Number(volumeResult.updated ?? 0)} / {Number(volumeResult.codes_in_file ?? 0)}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                    onClick={() => copyToClipboard(listToText(volumeResult.updated_codes))}
                    disabled={!volumeResult.updated_codes?.length}
                  >
                    Copia
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                    onClick={() =>
                      downloadCSV(`ml_updated_${todayISO()}.csv`, volumeResult.updated_codes || [])
                    }
                    disabled={!volumeResult.updated_codes?.length}
                  >
                    Scarica CSV
                  </button>
                </div>

                <textarea
                  className="mt-2 w-full rounded-lg border p-2 font-mono text-xs bg-white"
                  rows={6}
                  readOnly
                  value={listToText(volumeResult.updated_codes)}
                />
              </div>

              {/* SKIPPED */}
              <div className="rounded-xl border bg-amber-50 p-3">
                <div className="font-semibold">⚠️ Saltati (già valorizzati)</div>
                <div className="text-sm text-gray-700 mt-1">{Number(volumeResult.skipped_already_set ?? 0)}</div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                    onClick={() => copyToClipboard(listToText(volumeResult.skipped_codes))}
                    disabled={!volumeResult.skipped_codes?.length}
                  >
                    Copia
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                    onClick={() =>
                      downloadCSV(`ml_skipped_${todayISO()}.csv`, volumeResult.skipped_codes || [])
                    }
                    disabled={!volumeResult.skipped_codes?.length}
                  >
                    Scarica CSV
                  </button>
                </div>

                <textarea
                  className="mt-2 w-full rounded-lg border p-2 font-mono text-xs bg-white"
                  rows={6}
                  readOnly
                  value={listToText(volumeResult.skipped_codes)}
                />
              </div>

              {/* NOT FOUND */}
              <div className="rounded-xl border bg-rose-50 p-3">
                <div className="font-semibold">❌ Non trovati</div>
                <div className="text-sm text-gray-700 mt-1">{Number(volumeResult.not_found ?? 0)}</div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                    onClick={() => copyToClipboard(listToText(volumeResult.not_found_codes))}
                    disabled={!volumeResult.not_found_codes?.length}
                  >
                    Copia
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                    onClick={() =>
                      downloadCSV(`ml_not_found_${todayISO()}.csv`, volumeResult.not_found_codes || [])
                    }
                    disabled={!volumeResult.not_found_codes?.length}
                  >
                    Scarica CSV
                  </button>
                </div>

                <textarea
                  className="mt-2 w-full rounded-lg border p-2 font-mono text-xs bg-white"
                  rows={6}
                  readOnly
                  value={listToText(volumeResult.not_found_codes)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* LISTA */}
      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Codice</th>
              <th className="text-left p-3 w-[30%]">Descrizione</th>
              <th className="text-left p-3 w-48">Barcode</th>
              <th className="text-left p-3 w-20">UM</th>
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






















