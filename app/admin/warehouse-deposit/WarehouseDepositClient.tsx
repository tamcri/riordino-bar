"use client";

import { useEffect, useState } from "react";

type WarehouseDepositRow = {
  id: string;
  warehouse_item_id: string;
  code: string;
  description: string;
  um: string | null;
  stock_qty: number;
  is_active: boolean;
};

type AddForm = {
  warehouse_item_id: string;
  stock_qty: string;
};

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

export default function WarehouseDepositClient() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<"1" | "0" | "all">("1");

  const [rows, setRows] = useState<WarehouseDepositRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [addForm, setAddForm] = useState<AddForm>({
    warehouse_item_id: "",
    stock_qty: "",
  });

  async function loadRows() {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("active", active);
      if (q.trim()) params.set("q", q.trim());

      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        `/api/warehouse-deposit/list?${params.toString()}`
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      setRows(Array.isArray(data?.rows) ? data.rows : []);
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

  function openAddModal() {
    setMsg(null);
    setError(null);
    setAddForm({
      warehouse_item_id: "",
      stock_qty: "",
    });
    setModalOpen(true);
  }

  function closeAddModal() {
    if (saving) return;
    setModalOpen(false);
    setAddForm({
      warehouse_item_id: "",
      stock_qty: "",
    });
  }

  async function saveNewRow() {
  setMsg(null);
  setError(null);

  if (!addForm.warehouse_item_id.trim()) {
    setError("Selezione articolo obbligatoria.");
    return;
  }

  setSaving(true);

  try {
    const res = await fetch("/api/warehouse-deposit/add", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        warehouse_item_id: addForm.warehouse_item_id,
        stock_qty: addForm.stock_qty,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Errore inserimento");
    }

    setMsg("Articolo aggiunto al deposito.");

    closeAddModal();
    await loadRows();
  } catch (e: any) {
    setError(e?.message || "Errore salvataggio");
  } finally {
    setSaving(false);
  }
}

  async function toggleActive(row: WarehouseDepositRow) {
  setMsg(null);
  setError(null);

  try {
    const res = await fetch("/api/warehouse-deposit/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: row.id,
        is_active: !row.is_active,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Errore aggiornamento");
    }

    setMsg(
      `Articolo ${row.code} ${row.is_active ? "disattivato" : "attivato"}`
    );

    await loadRows();
  } catch (e: any) {
    setError(e?.message || "Errore aggiornamento");
  }
}

  async function changeQty(row: WarehouseDepositRow) {
  const value = prompt("Nuova quantità:", String(row.stock_qty ?? 0));

  if (value === null) return;

  setMsg(null);
  setError(null);

  try {
    const res = await fetch("/api/warehouse-deposit/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: row.id,
        stock_qty: value,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Errore aggiornamento quantità");
    }

    setMsg(`Quantità aggiornata per ${row.code}`);

    await loadRows();
  } catch (e: any) {
    setError(e?.message || "Errore aggiornamento");
  }
}

  return (
    <div className="space-y-4">
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={closeAddModal}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Aggiungi articolo al deposito</div>
                <div className="text-sm text-gray-600">
                  Deposito del magazzino centrale.
                </div>
              </div>

              <button
                className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                onClick={closeAddModal}
                disabled={saving}
              >
                Chiudi
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  ID articolo magazzino
                </label>
                <input
                  className="w-full rounded-xl border p-3"
                  value={addForm.warehouse_item_id}
                  onChange={(e) =>
                    setAddForm((prev) => ({
                      ...prev,
                      warehouse_item_id: e.target.value,
                    }))
                  }
                  placeholder="Per ora demo: inserimento manuale ID"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Quantità iniziale</label>
                <input
                  className="w-full rounded-xl border p-3"
                  value={addForm.stock_qty}
                  onChange={(e) =>
                    setAddForm((prev) => ({
                      ...prev,
                      stock_qty: e.target.value,
                    }))
                  }
                  placeholder="Es. 10"
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                className="rounded-xl bg-slate-900 px-4 py-3 text-white disabled:opacity-60"
                onClick={saveNewRow}
                disabled={saving}
              >
                {saving ? "Salvo..." : "Salva"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-lg font-semibold">Articoli presenti nel deposito</div>
            <div className="text-sm text-gray-600">
              Gestione articoli realmente presenti nel deposito centrale.
            </div>
          </div>

          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
            onClick={openAddModal}
          >
            Aggiungi articolo
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium">Cerca</label>
            <input
              className="w-full rounded-xl border p-3"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Codice o descrizione..."
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
              <th className="p-3 text-left w-[34%]">Descrizione</th>
              <th className="p-3 text-left w-20">UM</th>
              <th className="p-3 text-right w-28">Qtà</th>
              <th className="p-3 text-left w-20">Attivo</th>
              <th className="p-3 text-right w-56"></th>
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

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={6}>
                  Nessun articolo presente nel deposito.
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3 font-medium">{row.code}</td>
                <td className="p-3">{row.description}</td>
                <td className="p-3">{formatNullableText(row.um)}</td>
                <td className="p-3 text-right">{formatQty(row.stock_qty)}</td>
                <td className="p-3">{row.is_active ? "Sì" : "No"}</td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                      onClick={() => changeQty(row)}
                    >
                      Modifica quantità
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