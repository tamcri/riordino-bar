"use client";

import { useEffect, useState } from "react";

type HistoryRow = {
  id: string;
  inventory_date: string;
  operatore: string | null;
  notes: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
  rows_count: number;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function firstDayOfMonthISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function formatNullableText(v: string | null | undefined) {
  const s = String(v ?? "").trim();
  return s || "—";
}

function formatDateTimeIT(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
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

export default function WarehouseInventoryHistoryClient() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadRows() {
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (q.trim()) params.set("q", q.trim());

      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        `/api/warehouse-inventory/history?${params.toString()}`
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      const nextRows = Array.isArray(data?.rows) ? data.rows : [];
      setRows(nextRows);
      setMsg(`Inventari trovati: ${nextRows.length}`);
    } catch (e: any) {
      setRows([]);
      setError(e?.message || "Errore caricamento storico");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadRows();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [dateFrom, dateTo, q]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-lg font-semibold">Filtri storico</div>
            <div className="text-sm text-gray-600">
              Ricerca inventari confermati del magazzino centrale.
            </div>
          </div>

          <button
            type="button"
            className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
            onClick={loadRows}
            disabled={loading}
          >
            {loading ? "Carico..." : "Aggiorna"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Data da</label>
            <input
              type="date"
              className="w-full rounded-xl border p-3 bg-white"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Data a</label>
            <input
              type="date"
              className="w-full rounded-xl border p-3 bg-white"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium">Cerca</label>
            <input
              className="w-full rounded-xl border p-3"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Operatore, note o utente creatore..."
            />
          </div>
        </div>
      </div>

      {msg && <div className="text-sm text-emerald-700">{msg}</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-left w-32">Data inv.</th>
              <th className="p-3 text-left w-44">Operatore</th>
              <th className="p-3 text-left">Note</th>
              <th className="p-3 text-left w-40">Creato da</th>
              <th className="p-3 text-right w-24">Righe</th>
              <th className="p-3 text-left w-40">Creato il</th>
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
                  Nessun inventario trovato.
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3 font-medium">{row.inventory_date}</td>
                  <td className="p-3">{formatNullableText(row.operatore)}</td>
                  <td className="p-3">{formatNullableText(row.notes)}</td>
                  <td className="p-3">{formatNullableText(row.created_by_username)}</td>
                  <td className="p-3 text-right">{row.rows_count}</td>
                  <td className="p-3">{formatDateTimeIT(row.created_at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}