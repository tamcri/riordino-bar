"use client";

import { useEffect, useState } from "react";

type WarehouseItemRow = {
  id: string;
  code: string;
  description: string;
  barcode: string | null;
  um: string | null;
  prezzo_vendita_eur: number | null;
  purchase_price: number | null;
  vat_rate: number | null;
  purchase_price_vat: number | null;
  peso_kg: number | null;
  volume_ml_per_unit: number | null;
  min_stock_alert: number | null;
  is_active: boolean;
};

type WarehouseItemForm = {
  code: string;
  description: string;
  barcode: string;
  um: string;
  prezzo_vendita_eur: string;
  purchase_price: string;
  vat_rate: string;
  peso_kg: string;
  volume_ml_per_unit: string;
  min_stock_alert: string;
  is_active: boolean;
};

type PreviewRow = {
  row_number: number;
  code: string;
  description: string;
  barcode: string | null;
  um: string | null;
  prezzo_vendita_eur: number | null;
  peso_kg: number | null;
  volume_ml_per_unit: number | null;
  is_active: boolean;
  status: "ok" | "duplicate" | "invalid";
  reason: string | null;
};

type PreviewResponse = {
  ok: boolean;
  total: number;
  valid: number;
  duplicates: number;
  invalid: number;
  rows: PreviewRow[];
  error?: string;
};

function formatEuroIT(v: number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";

  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const intWithThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `€\u00A0${intWithThousands},${decPart}`;
}

function formatNullableText(v: string | null | undefined) {
  const s = String(v ?? "").trim();
  return s || "—";
}

function formatPesoKg(v: number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const s = n.toFixed(n < 0.1 ? 3 : n < 1 ? 2 : n < 10 ? 2 : 1);
  return s.replace(/\.?0+$/, "");
}

function formatVolumeMl(v: number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return String(Math.trunc(n));
}

function formatMinStockAlert(v: number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return String(Math.max(0, Math.trunc(n)));
}

function calcPurchasePriceVat(
  purchasePrice: number | null | undefined,
  vatRate: number | null | undefined
) {
  if (purchasePrice == null) return null;
  const p = Number(purchasePrice);
  const v = Number(vatRate ?? 0);
  if (!Number.isFinite(p) || !Number.isFinite(v)) return null;
  return p * (1 + v / 100);
}

function formatVatRate(v: number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(n % 1 === 0 ? 0 : 2)}%`;
}

function emptyForm(): WarehouseItemForm {
  return {
    code: "",
    description: "",
    barcode: "",
    um: "",
    prezzo_vendita_eur: "",
    purchase_price: "",
    vat_rate: "",
    peso_kg: "",
    volume_ml_per_unit: "",
    min_stock_alert: "",
    is_active: true,
  };
}

async function fetchJsonSafe<T = any>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; data: T; status: number; rawText: string }> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const status = res.status;
  const rawText = await res.text().catch(() => "");
  let data: any = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  return { ok: res.ok && !!data?.ok, data, status, rawText };
}

export default function WarehouseItemsClient() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<"1" | "0" | "all">("1");

  const [rows, setRows] = useState<WarehouseItemRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WarehouseItemForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [importing, setImporting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);

  async function loadRows() {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("active", active);
      if (q.trim()) params.set("q", q.trim());

      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        `/api/warehouse-items/list?${params.toString()}`
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      const nextRows = Array.isArray(data?.rows) ? data.rows : [];
      setRows(
        nextRows.map((row: any) => ({
          ...row,
          purchase_price_vat:
            row?.purchase_price_vat ??
            calcPurchasePriceVat(row?.purchase_price, row?.vat_rate),
        }))
      );
    } catch (e: any) {
      setRows([]);
      setError(e?.message || "Errore caricamento");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadRows();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [q, active]);

  function openCreateModal() {
    setMsg(null);
    setError(null);
    setEditingId(null);
    setForm(emptyForm());
    setModalOpen(true);
  }

  function openEditModal(row: WarehouseItemRow) {
    setMsg(null);
    setError(null);
    setEditingId(row.id);
    setForm({
      code: row.code,
      description: row.description,
      barcode: row.barcode ?? "",
      um: row.um ?? "",
      prezzo_vendita_eur:
        row.prezzo_vendita_eur == null ? "" : String(row.prezzo_vendita_eur),
      purchase_price:
        row.purchase_price == null ? "" : String(row.purchase_price),
      vat_rate: row.vat_rate == null ? "" : String(row.vat_rate),
      peso_kg: row.peso_kg == null ? "" : String(row.peso_kg),
      volume_ml_per_unit:
        row.volume_ml_per_unit == null ? "" : String(row.volume_ml_per_unit),
      min_stock_alert:
        row.min_stock_alert == null ? "" : String(row.min_stock_alert),
      is_active: row.is_active,
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  function closePreview() {
    if (previewLoading || importing) return;
    setPreviewOpen(false);
    setPreviewData(null);
    setImportFile(null);
  }

  function updateForm<K extends keyof WarehouseItemForm>(
    key: K,
    value: WarehouseItemForm[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setMsg(null);
    setError(null);

    const code = form.code.trim();
    const description = form.description.trim();

    if (!code) {
      setError("Codice obbligatorio.");
      return;
    }

    if (!description) {
      setError("Descrizione obbligatoria.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        id: editingId,
        code,
        description,
        barcode: form.barcode,
        um: form.um,
        prezzo_vendita_eur: form.prezzo_vendita_eur,
        purchase_price: form.purchase_price,
        vat_rate: form.vat_rate,
        peso_kg: form.peso_kg,
        volume_ml_per_unit: form.volume_ml_per_unit,
        min_stock_alert: form.min_stock_alert,
        is_active: form.is_active,
      };

      const url = editingId
        ? "/api/warehouse-items/update"
        : "/api/warehouse-items/create";

      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Errore salvataggio");
      }

      setMsg(
        editingId
          ? "Articolo aggiornato correttamente."
          : "Articolo creato correttamente."
      );

      closeModal();
      await loadRows();
    } catch (e: any) {
      setError(e?.message || "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: WarehouseItemRow) {
    setMsg(null);
    setError(null);

    try {
      const res = await fetch("/api/warehouse-items/update", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: row.id,
          is_active: !row.is_active,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Errore aggiornamento stato");
      }

      setMsg(
        `Articolo ${row.code} ${
          row.is_active ? "disattivato" : "attivato"
        } correttamente.`
      );

      await loadRows();
    } catch (e: any) {
      setError(e?.message || "Errore aggiornamento stato");
    }
  }

  async function handlePreview(file: File) {
    setMsg(null);
    setError(null);
    setPreviewData(null);

    if (!file) return;

    setPreviewLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/warehouse-items/import-preview", {
        method: "POST",
        body: formData,
      });

      const data: PreviewResponse = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Errore preview import");
      }

      setImportFile(file);
      setPreviewData(data);
      setPreviewOpen(true);
    } catch (e: any) {
      setError(e?.message || "Errore preview import");
      setImportFile(null);
      setPreviewData(null);
      setPreviewOpen(false);
      setFileInputKey((k) => k + 1);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmImport() {
    setMsg(null);
    setError(null);

    if (!importFile) {
      setError("File import non disponibile.");
      return;
    }

    setImporting(true);

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const res = await fetch("/api/warehouse-items/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Errore import");
      }

      setMsg(
        `Import completato: inseriti ${data.inserted}, saltati ${data.skipped_existing}, righe senza codice ${data.skipped_no_code}, righe non valide ${data.skipped_invalid}.`
      );

      closePreview();
      await loadRows();
      setFileInputKey((k) => k + 1);
    } catch (e: any) {
      setError(e?.message || "Errore import");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <input
        key={fileInputKey}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        id="warehouse-import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handlePreview(file);
        }}
      />

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={closeModal}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">
                  {editingId
                    ? "Modifica articolo magazzino"
                    : "Nuovo articolo magazzino"}
                </div>
                <div className="text-sm text-gray-600">
                  Anagrafica separata dal sistema articoli generale.
                </div>
              </div>

              <button
                className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                onClick={closeModal}
                disabled={saving}
              >
                Chiudi
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Codice</label>
                <input
                  className="w-full rounded-xl border p-3"
                  value={form.code}
                  onChange={(e) => updateForm("code", e.target.value)}
                  placeholder="Es. TEST-001"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Barcode</label>
                <input
                  className="w-full rounded-xl border p-3"
                  value={form.barcode}
                  onChange={(e) => updateForm("barcode", e.target.value)}
                  placeholder="Es. 1234567890123"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium">
                  Descrizione
                </label>
                <input
                  className="w-full rounded-xl border p-3"
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  placeholder="Es. Articolo Magazzino"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">UM</label>
                <input
                  className="w-full rounded-xl border p-3"
                  value={form.um}
                  onChange={(e) => updateForm("um", e.target.value)}
                  placeholder="Es. PZ, KG, LT"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Prezzo vendita
                </label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="decimal"
                  value={form.prezzo_vendita_eur}
                  onChange={(e) =>
                    updateForm("prezzo_vendita_eur", e.target.value)
                  }
                  placeholder="Es. 1,50"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Prezzo A. Imp
                </label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="decimal"
                  value={form.purchase_price}
                  onChange={(e) => updateForm("purchase_price", e.target.value)}
                  placeholder="Es. 0,80"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">IVA (%)</label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="decimal"
                  value={form.vat_rate}
                  onChange={(e) => updateForm("vat_rate", e.target.value)}
                  placeholder="Es. 22"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Prezzo A. Netto
                </label>
                <div className="w-full rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
                  {formatEuroIT(
                    calcPurchasePriceVat(
                      form.purchase_price === ""
                        ? null
                        : Number(String(form.purchase_price).replace(",", ".")),
                      form.vat_rate === ""
                        ? null
                        : Number(String(form.vat_rate).replace(",", "."))
                    )
                  )}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Peso (kg)
                </label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="decimal"
                  value={form.peso_kg}
                  onChange={(e) => updateForm("peso_kg", e.target.value)}
                  placeholder="Es. 0,700"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  ML per unità
                </label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="numeric"
                  value={form.volume_ml_per_unit}
                  onChange={(e) =>
                    updateForm("volume_ml_per_unit", e.target.value)
                  }
                  placeholder="Es. 700, 750, 1000"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Soglia minima riordino
                </label>
                <input
                  className="w-full rounded-xl border p-3"
                  inputMode="numeric"
                  value={form.min_stock_alert}
                  onChange={(e) =>
                    updateForm("min_stock_alert", e.target.value)
                  }
                  placeholder="Es. 10"
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 rounded-xl border px-3 py-3">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => updateForm("is_active", e.target.checked)}
                  />
                  <span className="text-sm">Articolo attivo</span>
                </label>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                className="rounded-xl bg-slate-900 px-4 py-3 text-white disabled:opacity-60"
                onClick={save}
                disabled={saving}
              >
                {saving ? "Salvo..." : "Salva"}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewOpen && previewData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={closePreview}
        >
          <div
            className="w-full max-w-6xl rounded-2xl bg-white p-5 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Preview import Excel</div>
                <div className="text-sm text-gray-600">
                  Verifica righe valide, duplicate e non valide prima
                  dell&apos;import definitivo.
                </div>
              </div>

              <button
                className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                onClick={closePreview}
                disabled={previewLoading || importing}
              >
                Chiudi
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border bg-emerald-50 p-3">
                <div className="text-xs font-medium text-emerald-700">
                  Valide
                </div>
                <div className="mt-1 text-xl font-semibold text-emerald-900">
                  {previewData.valid}
                </div>
              </div>

              <div className="rounded-xl border bg-amber-50 p-3">
                <div className="text-xs font-medium text-amber-700">
                  Duplicate
                </div>
                <div className="mt-1 text-xl font-semibold text-amber-900">
                  {previewData.duplicates}
                </div>
              </div>

              <div className="rounded-xl border bg-rose-50 p-3">
                <div className="text-xs font-medium text-rose-700">
                  Non valide
                </div>
                <div className="mt-1 text-xl font-semibold text-rose-900">
                  {previewData.invalid}
                </div>
              </div>

              <div className="rounded-xl border bg-slate-50 p-3">
                <div className="text-xs font-medium text-slate-700">Totale</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">
                  {previewData.total}
                </div>
              </div>
            </div>

            <div className="mt-4 max-h-[50vh] overflow-auto rounded-2xl border bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="w-16 p-3 text-left">Riga</th>
                    <th className="p-3 text-left">Stato</th>
                    <th className="p-3 text-left">Codice</th>
                    <th className="p-3 text-left">Descrizione</th>
                    <th className="p-3 text-left">Barcode</th>
                    <th className="p-3 text-left">UM</th>
                    <th className="p-3 text-right">Prezzo</th>
                    <th className="p-3 text-right">Peso</th>
                    <th className="p-3 text-right">ML</th>
                    <th className="p-3 text-left">Motivo</th>
                  </tr>
                </thead>

                <tbody>
                  {previewData.rows.map((row) => {
                    const rowClass =
                      row.status === "ok"
                        ? "bg-emerald-50"
                        : row.status === "duplicate"
                        ? "bg-amber-50"
                        : "bg-rose-50";

                    const statusLabel =
                      row.status === "ok"
                        ? "OK"
                        : row.status === "duplicate"
                        ? "Duplicato"
                        : "Non valida";

                    return (
                      <tr
                        key={`${row.row_number}-${row.code}`}
                        className={`border-t ${rowClass}`}
                      >
                        <td className="p-3">{row.row_number}</td>
                        <td className="p-3 font-medium">{statusLabel}</td>
                        <td className="p-3 font-medium">{row.code || "—"}</td>
                        <td className="p-3">{row.description || "—"}</td>
                        <td className="p-3 font-mono text-xs">
                          {formatNullableText(row.barcode)}
                        </td>
                        <td className="p-3">{formatNullableText(row.um)}</td>
                        <td className="p-3 text-right">
                          {formatEuroIT(row.prezzo_vendita_eur)}
                        </td>
                        <td className="p-3 text-right">
                          {formatPesoKg(row.peso_kg)}
                        </td>
                        <td className="p-3 text-right">
                          {formatVolumeMl(row.volume_ml_per_unit)}
                        </td>
                        <td className="p-3">{row.reason || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-gray-600">
                Verranno importate solo le righe con stato <b>OK</b>.
              </div>

              <div className="flex gap-2">
                <button
                  className="rounded-xl border px-4 py-2 hover:bg-gray-50"
                  onClick={closePreview}
                  disabled={importing}
                >
                  Annulla
                </button>
                <button
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
                  onClick={confirmImport}
                  disabled={importing || previewData.valid === 0}
                >
                  {importing ? "Import in corso..." : "Conferma Import"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-lg font-semibold">Articoli magazzino</div>
            <div className="text-sm text-gray-600">
              Gestione anagrafica del magazzino centrale.
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
              onClick={() => {
                const el = document.getElementById(
                  "warehouse-import-input"
                ) as HTMLInputElement | null;
                el?.click();
              }}
              disabled={previewLoading || importing}
            >
              {previewLoading
                ? "Preview..."
                : importing
                ? "Import in corso..."
                : "Importa Excel"}
            </button>

            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
              onClick={openCreateModal}
            >
              Nuovo articolo
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium">Cerca</label>
            <input
              className="w-full rounded-xl border p-3"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Codice, descrizione o barcode..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Stato</label>
            <select
              className="w-full rounded-xl border bg-white p-3"
              value={active}
              onChange={(e) => setActive(e.target.value as "1" | "0" | "all")}
            >
              <option value="1">Attivi</option>
              <option value="0">Disattivi</option>
              <option value="all">Tutti</option>
            </select>
          </div>
        </div>
      </div>

      {msg && <div className="text-sm text-emerald-700">{msg}</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-left">Codice</th>
              <th className="w-[28%] p-3 text-left">Descrizione</th>
              <th className="w-44 p-3 text-left">Barcode</th>
              <th className="w-20 p-3 text-left">UM</th>
              <th className="w-32 p-3 text-right">Prezzo</th>
              <th className="w-32 p-3 text-right">Prezzo A. Imp</th>
              <th className="w-24 p-3 text-right">IVA %</th>
              <th className="w-32 p-3 text-right">Prezzo A. Net</th>
              <th className="w-24 p-3 text-right">Peso kg</th>
              <th className="w-24 p-3 text-right">ML</th>
              <th className="w-24 p-3 text-right">Soglia</th>
              <th className="w-20 p-3 text-left">Attivo</th>
              <th className="w-40 p-3 text-right"></th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={13}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={13}>
                  Nessun articolo magazzino trovato.
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3 font-medium">{row.code}</td>
                <td className="p-3">{row.description}</td>
                <td className="p-3 font-mono text-xs">
                  {formatNullableText(row.barcode)}
                </td>
                <td className="p-3">{formatNullableText(row.um)}</td>
                <td className="p-3 text-right">
                  {formatEuroIT(row.prezzo_vendita_eur)}
                </td>
                <td className="p-3 text-right">
                  {formatEuroIT(row.purchase_price)}
                </td>
                <td className="p-3 text-right">{formatVatRate(row.vat_rate)}</td>
                <td className="p-3 text-right">
                  {formatEuroIT(
                    row.purchase_price_vat ??
                      calcPurchasePriceVat(row.purchase_price, row.vat_rate)
                  )}
                </td>
                <td className="p-3 text-right">{formatPesoKg(row.peso_kg)}</td>
                <td className="p-3 text-right">
                  {formatVolumeMl(row.volume_ml_per_unit)}
                </td>
                <td className="p-3 text-right">
                  {formatMinStockAlert(row.min_stock_alert)}
                </td>
                <td className="p-3">{row.is_active ? "Sì" : "No"}</td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                      onClick={() => openEditModal(row)}
                    >
                      Modifica
                    </button>
                    <button
                      className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                      onClick={() => toggleActive(row)}
                    >
                      {row.is_active ? "Disattiva" : "Attiva"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}