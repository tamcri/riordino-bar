"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type InventoryInputRow = {
  id: string;
  warehouse_item_id: string;
  code: string;
  description: string;
  barcode: string | null;
  um: string | null;
  stock_qty: number;
  counted_qty: string;
  is_active: boolean;
};

type InventoryPreviewRow = {
  warehouse_item_id: string;
  code: string;
  description: string;
  um: string | null;
  stock_qty_before: number;
  counted_qty: number;
  difference_qty: number;
  shortage_qty: number;
  excess_qty: number;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatNullableText(v: string | null | undefined) {
  const s = String(v ?? "").trim();
  return s || "—";
}

function formatQty(v: number | null | undefined) {
  if (v == null) return "0";
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return String(n).replace(".", ",");
}

function hasCountedQty(v: string | null | undefined) {
  return String(v ?? "").trim() !== "";
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

export default function WarehouseInventoryClient() {
  const [inventoryDate, setInventoryDate] = useState(todayISO());
  const [operatore, setOperatore] = useState("");
  const [note, setNote] = useState("");

  const [search, setSearch] = useState("");
  const [onlyCompiled, setOnlyCompiled] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);

  const [rows, setRows] = useState<InventoryInputRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [searchRows, setSearchRows] = useState<InventoryInputRow[]>([]);
  const [searchQtyMap, setSearchQtyMap] = useState<Record<string, string>>({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [previewRows, setPreviewRows] = useState<InventoryPreviewRow[] | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const hasRows = rows.length > 0;
  const inPreview = previewRows !== null;

  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [assignResults, setAssignResults] = useState<InventoryInputRow[]>([]);

  const compiledCount = useMemo(() => {
    return rows.filter((row) => hasCountedQty(row.counted_qty)).length;
  }, [rows]);

  const filteredRows = useMemo(() => {
    let next = [...rows];

    if (onlyCompiled) {
      next = next.filter((row) => hasCountedQty(row.counted_qty));
    }

    next.sort((a, b) => {
      const aCompiled = hasCountedQty(a.counted_qty) ? 1 : 0;
      const bCompiled = hasCountedQty(b.counted_qty) ? 1 : 0;

      if (aCompiled !== bCompiled) {
        return bCompiled - aCompiled;
      }

      return 0;
    });

    return next;
  }, [rows, onlyCompiled]);

  const visibleRows = useMemo(() => {
    if (showAllRows) return filteredRows;
    return filteredRows.slice(0, 10);
  }, [filteredRows, showAllRows]);

  const canVerify = useMemo(() => {
    if (!inventoryDate.trim()) return false;
    if (!operatore.trim()) return false;
    if (!rows.length) return false;

    return rows.some((row) => hasCountedQty(row.counted_qty));
  }, [inventoryDate, operatore, rows]);

  const previewSummary = useMemo(() => {
    if (!previewRows) {
      return {
        totalRows: 0,
        shortageRows: 0,
        excessRows: 0,
        equalRows: 0,
      };
    }

    return {
      totalRows: previewRows.length,
      shortageRows: previewRows.filter((row) => row.shortage_qty > 0).length,
      excessRows: previewRows.filter((row) => row.excess_qty > 0).length,
      equalRows: previewRows.filter((row) => row.difference_qty === 0).length,
    };
  }, [previewRows]);

  useEffect(() => {
    const q = search.trim();

    if (q.length < 3) {
      setSearchRows([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);

      try {
        const params = new URLSearchParams();
        params.set("q", q);

        const { ok, data, status, rawText } = await fetchJsonSafe<any>(
          `/api/warehouse-inventory/search?${params.toString()}`
        );

        if (!ok) {
          throw new Error(data?.error || rawText || `HTTP ${status}`);
        }

        const apiRows = Array.isArray(data?.rows) ? data.rows : [];

        const nextRows: InventoryInputRow[] = apiRows.map((row: any) => {
          const existing = rows.find(
            (r) => r.warehouse_item_id === row.warehouse_item_id
          );

          return {
            id: row.id,
            warehouse_item_id: row.warehouse_item_id,
            code: row.code ?? "",
            description: row.description ?? "",
            barcode: row.barcode ?? null,
            um: row.um ?? null,
            stock_qty: Number(row.stock_qty ?? 0) || 0,
            counted_qty: existing?.counted_qty ?? "",
            is_active: row.is_active ?? true,
          };
        });

        setSearchRows(nextRows);
      } catch (e: any) {
        setSearchRows([]);
        setSearchError(e?.message || "Errore ricerca articolo");
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search, rows]);

  useEffect(() => {
  if (!showAssignModal) return;

  const q = assignSearch.trim();

  if (q.length < 3) {
    setAssignResults([]);
    return;
  }

  const timer = setTimeout(async () => {
    try {
      const params = new URLSearchParams();
      params.set("q", q);

      const res = await fetch(`/api/warehouse-inventory/search?${params}`);
      const json = await res.json();

      setAssignResults(json?.rows || []);
    } catch {
      setAssignResults([]);
    }
  }, 250);

  return () => clearTimeout(timer);
}, [assignSearch, showAssignModal]);

  useEffect(() => {
    if (!activeRowId) return;

    const timer = window.setTimeout(() => {
      const el = qtyInputRefs.current[activeRowId];
      if (el) {
        el.focus();
        el.select();
      }
    }, 50);

    return () => window.clearTimeout(timer);
  }, [activeRowId, rows]);

  function addRowToInventory(row: InventoryInputRow) {
    setRows((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.warehouse_item_id === row.warehouse_item_id
      );

      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const nextRow: InventoryInputRow = {
          ...existing,
          code: row.code,
          description: row.description,
          barcode: row.barcode,
          um: row.um,
          stock_qty: row.stock_qty,
          is_active: row.is_active,
        };

        const withoutCurrent = prev.filter(
          (item) => item.warehouse_item_id !== row.warehouse_item_id
        );

        return [nextRow, ...withoutCurrent];
      }

      return [
        {
          ...row,
          counted_qty: row.counted_qty ?? "",
        },
        ...prev,
      ];
    });

    setActiveRowId(row.warehouse_item_id);
    setShowAllRows(false);
    setSearch("");
    setSearchRows([]);
    setSearchError(null);
    setMsg(null);
    setError(null);

    window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  }

  function handleCountedQtyChange(warehouseItemId: string, value: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.warehouse_item_id === warehouseItemId
          ? {
              ...row,
              counted_qty: value,
            }
          : row
      )
    );

    setSearchRows((prev) =>
      prev.map((row) =>
        row.warehouse_item_id === warehouseItemId
          ? {
              ...row,
              counted_qty: value,
            }
          : row
      )
    );
  }

  function setSearchQty(id: string, value: string) {
  setSearchQtyMap((prev) => ({
    ...prev,
    [id]: value,
  }));
}

  function confirmSearchRow(row: InventoryInputRow) {
  const qty = (searchQtyMap[row.warehouse_item_id] || "").trim();

  if (!qty) return;

  setRows((prev) => {
    const existingIndex = prev.findIndex(
      (item) => item.warehouse_item_id === row.warehouse_item_id
    );

    if (existingIndex >= 0) {
      const existing = prev[existingIndex];

      const updated = {
        ...existing,
        counted_qty: qty,
        stock_qty: row.stock_qty,
      };

      const others = prev.filter(
        (item) => item.warehouse_item_id !== row.warehouse_item_id
      );

      return [updated, ...others];
    }

    return [
      {
        ...row,
        counted_qty: qty,
      },
      ...prev,
    ];
  });

  setSearch("");
  setSearchRows([]);
  setSearchQtyMap({});
  setActiveRowId(null);

  setTimeout(() => {
    searchInputRef.current?.focus();
  }, 0);
}

  function confirmFastEntry() {
    setActiveRowId(null);
    window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  }

  async function handleVerifyPreview() {
    setMsg(null);
    setError(null);

    if (!inventoryDate.trim()) {
      setError("Data inventario obbligatoria.");
      return;
    }

    if (!operatore.trim()) {
      setError("Operatore obbligatorio.");
      return;
    }

    if (!rows.length) {
      setError("Nessun articolo da inventariare.");
      return;
    }

    const payloadRows = rows
      .filter((row) => hasCountedQty(row.counted_qty))
      .map((row) => ({
        warehouse_item_id: row.warehouse_item_id,
        counted_qty: row.counted_qty,
      }));

    if (payloadRows.length === 0) {
      setError("Inserisci almeno una quantità contata prima della verifica.");
      return;
    }

    setPreviewLoading(true);

    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        "/api/warehouse-inventory/preview",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inventory_date: inventoryDate,
            operatore,
            rows: payloadRows,
          }),
        }
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      const apiRows = Array.isArray(data?.rows) ? data.rows : [];
      setPreviewRows(apiRows);
    } catch (e: any) {
      setPreviewRows(null);
      setError(e?.message || "Errore preview inventario.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleBackToEdit() {
    setMsg(null);
    setError(null);
    setPreviewRows(null);
  }

  async function handleConfirmInventory() {
    if (confirmLoading) return;

    setMsg(null);
    setError(null);

    if (!inventoryDate.trim()) {
      setError("Data inventario obbligatoria.");
      return;
    }

    if (!operatore.trim()) {
      setError("Operatore obbligatorio.");
      return;
    }

    const payloadRows = rows
      .filter((row) => hasCountedQty(row.counted_qty))
      .map((row) => ({
        warehouse_item_id: row.warehouse_item_id,
        counted_qty: row.counted_qty,
      }));

    if (payloadRows.length === 0) {
      setError("Nessuna riga valida da confermare.");
      return;
    }

    const ok = window.confirm(
      `Stai per confermare l'inventario.\n\n` +
        `Righe da salvare: ${payloadRows.length}\n` +
        `Operatore: ${operatore}\n` +
        `Data: ${inventoryDate}\n\n` +
        `Dopo la conferma verrà aggiornato il deposito centrale.`
    );

    if (!ok) return;

    setConfirmLoading(true);

    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        "/api/warehouse-inventory/confirm",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inventory_date: inventoryDate,
            operatore,
            notes: note,
            rows: payloadRows,
          }),
        }
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      const savedRows = Number(data?.saved_rows ?? 0) || 0;
      const shortageRows = Number(data?.shortage_rows ?? 0) || 0;
      const excessRows = Number(data?.excess_rows ?? 0) || 0;
      const equalRows = Number(data?.equal_rows ?? 0) || 0;

      setPreviewRows(null);
      setSearch("");
      setSearchRows([]);
      setOnlyCompiled(false);
      setShowAllRows(false);
      setNote("");
      setOperatore("");
      setActiveRowId(null);

      setMsg(
        `Inventario confermato. Righe salvate: ${savedRows}. Ammanchi: ${shortageRows}. Eccedenze: ${excessRows}. Invariate: ${equalRows}.`
      );

      await handleLoadRows();
    } catch (e: any) {
      setError(e?.message || "Errore conferma inventario.");
    } finally {
      setConfirmLoading(false);
    }
  }

  async function assignBarcodeToItem(item: InventoryInputRow) {
  try {
    const res = await fetch("/api/warehouse-items/assign-barcode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        warehouse_item_id: item.warehouse_item_id,
        barcode: search,
      }),
    });

    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error);
    }

    setShowAssignModal(false);
    setAssignSearch("");
    setAssignResults([]);

    setMsg("Barcode associato con successo.");

  } catch (e: any) {
    setError(e.message || "Errore associazione barcode");
  }
}

  async function handleLoadRows() {
    setMsg(null);
    setError(null);
    setLoading(true);

    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        "/api/warehouse-inventory/list"
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      const apiRows = Array.isArray(data?.rows) ? data.rows : [];

      const nextRows: InventoryInputRow[] = apiRows.map((row: any) => ({
        id: row.id,
        warehouse_item_id: row.warehouse_item_id,
        code: row.code ?? "",
        description: row.description ?? "",
        barcode: row.barcode ?? null,
        um: row.um ?? null,
        stock_qty: Number(row.stock_qty ?? 0) || 0,
        counted_qty: "",
        is_active: row.is_active ?? true,
      }));

      setRows(nextRows);
      setPreviewRows(null);
      setShowAllRows(false);
      setMsg(`Articoli caricati: ${nextRows.length}`);
    } catch (e: any) {
      setRows([]);
      setPreviewRows(null);
      setError(e?.message || "Errore caricamento.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-lg font-semibold">Testata inventario</div>
            <div className="text-sm text-gray-600">
              Compila i dati generali e carica gli articoli attivi del deposito centrale.
            </div>
          </div>

          <button
            type="button"
            className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
            onClick={handleLoadRows}
            disabled={loading || previewLoading || confirmLoading || inPreview}
          >
            {loading ? "Carico..." : "Carica articoli"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium">Data inventario</label>
            <input
              type="date"
              className="w-full rounded-xl border p-3 bg-white"
              value={inventoryDate}
              onChange={(e) => setInventoryDate(e.target.value)}
              disabled={inPreview || previewLoading || confirmLoading}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Operatore</label>
            <input
              className="w-full rounded-xl border p-3"
              value={operatore}
              onChange={(e) => setOperatore(e.target.value)}
              placeholder="Es. Mario Rossi"
              disabled={inPreview || previewLoading || confirmLoading}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Nota</label>
            <input
              className="w-full rounded-xl border p-3"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Facoltativa"
              disabled={inPreview || previewLoading || confirmLoading}
            />
          </div>
        </div>
      </div>

      {!inPreview && (
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold">Ricerca articolo</div>
              <div className="text-sm text-gray-600">
                Cerca per codice, descrizione o barcode. Da 3 caratteri in su i risultati compaiono automaticamente.
              </div>
            </div>

            <div className="text-sm text-gray-600">
              Risultati: <b>{searchRows.length}</b>
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium">Cerca articolo</label>
            <input
              ref={searchInputRef}
              className="w-full rounded-xl border p-3"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Scrivi almeno 3 caratteri..."
              disabled={previewLoading || confirmLoading}
            />
          </div>

          {search.length > 0 && search.length < 3 && (
            <div className="mt-3 text-sm text-gray-500">
              Inserisci almeno 3 caratteri per avviare la ricerca.
            </div>
          )}

          {searchLoading && (
            <div className="mt-3 text-sm text-gray-500">Ricerca in corso...</div>
          )}

          {searchError && (
            <div className="mt-3 text-sm text-red-600">{searchError}</div>
          )}

          {!searchLoading && search.length >= 3 && !searchError && (
            <div className="mt-4 overflow-auto rounded-2xl border bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-3 text-left">Codice</th>
                    <th className="p-3 text-left w-[30%]">Descrizione</th>
                    <th className="p-3 text-left w-44">Barcode</th>
                    <th className="p-3 text-left w-20">UM</th>
                    <th className="p-3 text-right w-28">Qtà attuale</th>
                    <th className="p-3 text-right w-40"></th>
                  </tr>
                </thead>

                <tbody>
  {searchRows.length === 0 ? (
  <tr className="border-t">
    <td className="p-3 text-gray-500" colSpan={6}>
      Nessun articolo trovato.

      {search.length >= 3 && (
        <div className="mt-2">
          <button
            className="rounded-xl border px-3 py-2 hover:bg-gray-50"
            onClick={() => setShowAssignModal(true)}
          >
            Associa barcode a articolo
          </button>
        </div>
      )}
    </td>
  </tr>
) : (
    searchRows.map((row) => {
      const qty = searchQtyMap[row.warehouse_item_id] || "";

      return (
        <tr key={row.warehouse_item_id} className="border-t">
          <td className="p-3 font-medium">{row.code}</td>
          <td className="p-3">{row.description}</td>
          <td className="p-3 font-mono text-xs">
            {formatNullableText(row.barcode)}
          </td>
          <td className="p-3">{formatNullableText(row.um)}</td>
          <td className="p-3 text-right">{formatQty(row.stock_qty)}</td>

          <td className="p-3 text-right">
            <input
              className="w-28 rounded-xl border p-2 text-right"
              inputMode="decimal"
              placeholder="Qtà"
              value={qty}
              onChange={(e) =>
                setSearchQty(row.warehouse_item_id, e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmSearchRow(row);
                }
              }}
              autoFocus={searchRows.length === 1}
            />
          </td>
        </tr>
      );
    })
  )}
</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {msg && <div className="text-sm text-emerald-700">{msg}</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}

      {!inPreview && (
        <>
          <div className="rounded-2xl border bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-lg font-semibold">Lista inventario</div>
                <div className="text-sm text-gray-600">
                  Per default vedi gli ultimi 10 articoli inseriti o aggiornati.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                <div>
                  Articoli in lista: <b>{rows.length}</b> · Compilati: <b>{compiledCount}</b>
                </div>

                {filteredRows.length > 10 && (
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                    onClick={() => setShowAllRows((prev) => !prev)}
                  >
                    {showAllRows ? "Mostra ultimi 10" : "Tutti"}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyCompiled}
                  onChange={(e) => setOnlyCompiled(e.target.checked)}
                  disabled={previewLoading || confirmLoading}
                />
                <span>Mostra solo articoli compilati</span>
              </label>
            </div>
          </div>

          <div className="overflow-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Codice</th>
                  <th className="p-3 text-left w-[30%]">Descrizione</th>
                  <th className="p-3 text-left w-44">Barcode</th>
                  <th className="p-3 text-left w-20">UM</th>
                  <th className="p-3 text-right w-28">Qtà attuale</th>
                  <th className="p-3 text-right w-40">Qtà contata</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-500" colSpan={6}>
                      Caricamento...
                    </td>
                  </tr>
                )}

                {!loading && !hasRows && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-500" colSpan={6}>
                      Nessun articolo in lista inventario.
                    </td>
                  </tr>
                )}

                {!loading && hasRows && visibleRows.length === 0 && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-500" colSpan={6}>
                      Nessun articolo trovato con i filtri attuali.
                    </td>
                  </tr>
                )}

                {!loading &&
                  visibleRows.map((row) => {
                    const compiled = hasCountedQty(row.counted_qty);
                    const isActive = row.warehouse_item_id === activeRowId;

                    return (
                      <tr
                        key={row.warehouse_item_id}
                        className={`border-t ${
                          isActive
                            ? "bg-sky-50"
                            : compiled
                            ? "bg-amber-50/40"
                            : ""
                        }`}
                      >
                        <td className="p-3 font-medium">{row.code}</td>
                        <td className="p-3">{row.description}</td>
                        <td className="p-3 font-mono text-xs">{formatNullableText(row.barcode)}</td>
                        <td className="p-3">{formatNullableText(row.um)}</td>
                        <td className="p-3 text-right">{formatQty(row.stock_qty)}</td>
                        <td className="p-3">
                          <div className="flex justify-end">
                            <input
                              ref={(el) => {
                                qtyInputRefs.current[row.warehouse_item_id] = el;
                              }}
                              className={`w-32 rounded-xl border p-2 text-right ${
                                isActive
                                  ? "border-sky-500 bg-white ring-2 ring-sky-100"
                                  : compiled
                                  ? "border-amber-400 bg-white"
                                  : ""
                              }`}
                              inputMode="decimal"
                              placeholder="0"
                              value={row.counted_qty}
                              onChange={(e) =>
                                handleCountedQtyChange(row.warehouse_item_id, e.target.value)
                              }
                              onFocus={() => setActiveRowId(row.warehouse_item_id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  confirmFastEntry();
                                }
                              }}
                              disabled={previewLoading || confirmLoading}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
                onClick={handleVerifyPreview}
                disabled={!canVerify || previewLoading || confirmLoading}
              >
                {previewLoading ? "Verifico..." : "Verifica inventario"}
              </button>
            </div>
          </div>
        </>
      )}

      {inPreview && previewRows && (
        <>
          <div className="rounded-2xl border bg-white p-4">
            <div className="text-lg font-semibold">Preview verifica inventario</div>
            <div className="mt-1 text-sm text-gray-600">
              Controlla i dati prima della conferma finale.
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Righe</div>
                <div className="mt-1 text-lg font-semibold">{previewSummary.totalRows}</div>
              </div>

              <div className="rounded-xl border bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Ammanchi</div>
                <div className="mt-1 text-lg font-semibold">{previewSummary.shortageRows}</div>
              </div>

              <div className="rounded-xl border bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Eccedenze</div>
                <div className="mt-1 text-lg font-semibold">{previewSummary.excessRows}</div>
              </div>

              <div className="rounded-xl border bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Invariate</div>
                <div className="mt-1 text-lg font-semibold">{previewSummary.equalRows}</div>
              </div>
            </div>
          </div>

          <div className="overflow-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Codice</th>
                  <th className="p-3 text-left w-[28%]">Descrizione</th>
                  <th className="p-3 text-left w-20">UM</th>
                  <th className="p-3 text-right w-28">Qtà attuale</th>
                  <th className="p-3 text-right w-28">Qtà contata</th>
                  <th className="p-3 text-right w-28">Differenza</th>
                  <th className="p-3 text-right w-28">Ammanco</th>
                  <th className="p-3 text-right w-28">Eccedenza</th>
                </tr>
              </thead>

              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.warehouse_item_id} className="border-t">
                    <td className="p-3 font-medium">{row.code}</td>
                    <td className="p-3">{row.description}</td>
                    <td className="p-3">{formatNullableText(row.um)}</td>
                    <td className="p-3 text-right">{formatQty(row.stock_qty_before)}</td>
                    <td className="p-3 text-right">{formatQty(row.counted_qty)}</td>
                    <td
                      className={`p-3 text-right font-medium ${
                        row.difference_qty < 0
                          ? "text-red-600"
                          : row.difference_qty > 0
                          ? "text-emerald-700"
                          : "text-gray-700"
                      }`}
                    >
                      {formatQty(row.difference_qty)}
                    </td>
                    <td className="p-3 text-right text-red-600">
                      {row.shortage_qty > 0 ? formatQty(row.shortage_qty) : "—"}
                    </td>
                    <td className="p-3 text-right text-emerald-700">
                      {row.excess_qty > 0 ? formatQty(row.excess_qty) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
              <button
                type="button"
                className="rounded-xl border px-4 py-2 hover:bg-gray-50"
                onClick={handleBackToEdit}
                disabled={confirmLoading}
              >
                Torna alla modifica
              </button>

              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
                onClick={handleConfirmInventory}
                disabled={confirmLoading}
              >
                {confirmLoading ? "Confermo..." : "Conferma inventario"}
              </button>
            </div>
          </div>
        </>
      )}
       {showAssignModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4">
        <div className="text-lg font-semibold">Associa barcode</div>

        <div className="mt-2 text-sm text-gray-600">
          Barcode: <b>{search}</b>
        </div>

        <input
          className="mt-4 w-full rounded-xl border p-3"
          placeholder="Cerca articolo..."
          value={assignSearch}
          onChange={(e) => setAssignSearch(e.target.value)}
        />

        <div className="mt-4 max-h-64 overflow-auto border rounded-xl">
          {assignResults.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">
              Nessun risultato
            </div>
          ) : (
            assignResults.map((row) => (
              <div
                key={row.warehouse_item_id}
                className="flex justify-between border-b p-3"
              >
                <div>
                  <div className="font-medium">{row.code}</div>
                  <div className="text-xs text-gray-500">{row.description}</div>
                </div>

                <button
                  className="rounded-xl border px-3 py-1"
                  onClick={() => assignBarcodeToItem(row)}
                >
                  Associa
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            className="rounded-xl border px-4 py-2"
            onClick={() => setShowAssignModal(false)}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )}

    </div>
  );
}