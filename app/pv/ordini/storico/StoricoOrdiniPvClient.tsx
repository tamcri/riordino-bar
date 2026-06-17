"use client";

import { useEffect, useMemo, useState } from "react";

type OrderRow = {
  id: string;
  order_date: string;
  operatore: string;
  total_rows: number;
};

const PAGE_SIZE = 10;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function firstDayOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function formatDate(value: string) {
  const [yyyy, mm, dd] = String(value || "").split("-");
  if (!yyyy || !mm || !dd) return value || "—";
  return `${dd}/${mm}/${yyyy}`;
}

async function fetchJsonSafe<T = any>(
  url: string
): Promise<{ ok: boolean; data: T; rawText: string; status: number }> {
  const res = await fetch(url, { cache: "no-store" });
  const rawText = await res.text().catch(() => "");
  let data: any = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  return { ok: res.ok && !!data?.ok, data, rawText, status: res.status };
}

export default function StoricoOrdiniPvClient() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const totalOrders = rows.length;
  const totalRowsOrdered = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.total_rows || 0), 0),
    [rows]
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const visibleRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  async function loadOrders() {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);

      const { ok, data, rawText, status } = await fetchJsonSafe<any>(
        `/api/pv-orders/list?${params.toString()}`
      );

      if (!ok) throw new Error(data?.error || rawText || `HTTP ${status}`);

      setRows(Array.isArray(data.rows) ? data.rows : []);
      setPage(1);
    } catch (e: any) {
      setError(e?.message || "Errore caricamento storico ordini");
      setRows([]);
      setPage(1);
    } finally {
      setLoading(false);
      setBootLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPdf(orderId: string) {
    window.open(
      `/api/pv-orders/${encodeURIComponent(orderId)}/pdf?view=pv`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  const firstVisible = rows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(page * PAGE_SIZE, rows.length);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Storico Ordini</h1>
        <p className="text-gray-600 mt-1">Consulta gli ordini inviati e stampa il PDF.</p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">Ordini trovati</div>
          <div className="text-2xl font-semibold mt-1">{totalOrders}</div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">Totale righe ordinate</div>
          <div className="text-2xl font-semibold mt-1">{totalRowsOrdered}</div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-2">Data da</label>
            <input
              type="date"
              className="w-full rounded-xl border p-3 bg-white"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Data a</label>
            <input
              type="date"
              className="w-full rounded-xl border p-3 bg-white"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={loadOrders}
              disabled={loading}
              className="w-full rounded-xl bg-slate-900 text-white px-4 py-3 font-semibold disabled:opacity-60"
            >
              {loading ? "Caricamento..." : "Aggiorna"}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Data ordine</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Operatore</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">N. righe</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">PDF</th>
              </tr>
            </thead>

            <tbody>
              {bootLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    Caricamento...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    Nessun ordine trovato.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-4 py-4">{formatDate(row.order_date)}</td>
                    <td className="px-4 py-4">{row.operatore || "—"}</td>
                    <td className="px-4 py-4">{row.total_rows}</td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => openPdf(row.id)}
                        className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
                      >
                        Stampa PDF
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t bg-white">
            <div className="text-sm text-gray-700">
              {firstVisible}-{lastVisible} di {rows.length} ordini
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-xl border px-3 py-2 disabled:opacity-40 hover:bg-gray-50"
              >
                ‹
              </button>

              <div className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-semibold">
                {page}
              </div>

              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-xl border px-3 py-2 disabled:opacity-40 hover:bg-gray-50"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}