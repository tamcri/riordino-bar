"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PV = {
  id: string;
  code: string;
  name: string;
};

type OrderStatus = "DA_COMPLETARE" | "COMPLETO";
type ShippingStatus = "NON_SPEDITO" | "PARZIALE" | "SPEDITO";

type OrderRow = {
  id: string;
  pv_id: string;
  order_date: string;
  operatore: string;
  created_by_username: string | null;
  shipping_status: ShippingStatus;
  created_at: string;
  updated_at: string;
  pv_code: string;
  pv_name: string;
  order_status: OrderStatus;
  total_rows: number;
  pending_rows: number;
  evaded_rows: number;
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

function formatDate(value: string) {
  if (!value) return "—";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function orderStatusBadge(status: OrderStatus) {
  if (status === "COMPLETO") {
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function shippingStatusBadge(status: ShippingStatus) {
  switch (status) {
    case "SPEDITO":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "PARZIALE":
      return "bg-sky-100 text-sky-800 border-sky-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function shippingStatusLabel(status: ShippingStatus) {
  switch (status) {
    case "SPEDITO":
      return "Spedito";
    case "PARZIALE":
      return "Parziale";
    default:
      return "Non spedito";
  }
}

function orderStatusLabel(status: OrderStatus) {
  return status === "COMPLETO" ? "Completo" : "Da completare";
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

export default function OrdiniPvAdminClient() {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [rows, setRows] = useState<OrderRow[]>([]);

  const [pvId, setPvId] = useState("");
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [shippingStatus, setShippingStatus] = useState("");

  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalOrders = rows.length;
  const totalPending = useMemo(
    () => rows.filter((r) => r.order_status === "DA_COMPLETARE").length,
    [rows]
  );
  const totalNotShipped = useMemo(
    () => rows.filter((r) => r.shipping_status !== "SPEDITO").length,
    [rows]
  );

  async function loadPvs() {
    const { ok, data, status, rawText } = await fetchJsonSafe<any>("/api/pvs/list");
    if (!ok) {
      throw new Error(data?.error || rawText || `HTTP ${status}`);
    }

    const list = (data?.pvs ?? data?.rows ?? []) as any[];
    setPvs(Array.isArray(list) ? list : []);
  }

  async function loadOrders() {
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      const params = new URLSearchParams();

      if (pvId) params.set("pv_id", pvId);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (shippingStatus) params.set("shipping_status", shippingStatus);

      const query = params.toString();
      const url = query ? `/api/pv-orders/list?${query}` : "/api/pv-orders/list";

      const { ok, data, status, rawText } = await fetchJsonSafe<any>(url);
      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      const nextRows = Array.isArray(data?.rows) ? data.rows : [];
      setRows(nextRows);
      setMsg(nextRows.length === 0 ? "Nessun ordine trovato con i filtri selezionati." : null);
    } catch (e: any) {
      setError(e?.message || "Errore");
      setRows([]);
    } finally {
      setLoading(false);
      setBootLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadPvs();
        await loadOrders();
      } catch (e: any) {
        setError(e?.message || "Errore");
        setBootLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFilters() {
    setPvId("");
    setDateFrom(firstDayOfMonthISO());
    setDateTo(todayISO());
    setShippingStatus("");
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Ordini PV</h1>
            <p className="text-gray-600 mt-1">
              Elenco ordini inviati dai punti vendita, con stato ordine e stato spedizione.
            </p>
          </div>

          <Link
            href="/admin"
            className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
          >
            Torna ad Admin
          </Link>
        </div>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-gray-500">Ordini trovati</div>
            <div className="text-2xl font-semibold mt-1">{totalOrders}</div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-gray-500">Ordini da completare</div>
            <div className="text-2xl font-semibold mt-1">{totalPending}</div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-gray-500">Ordini non spediti / parziali</div>
            <div className="text-2xl font-semibold mt-1">{totalNotShipped}</div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2">Punto Vendita</label>
              <select
                className="w-full rounded-xl border p-3 bg-white"
                value={pvId}
                onChange={(e) => setPvId(e.target.value)}
              >
                <option value="">Tutti</option>
                {pvs.map((pv) => (
                  <option key={pv.id} value={pv.id}>
                    {pv.code} — {pv.name}
                  </option>
                ))}
              </select>
            </div>

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

            <div>
              <label className="block text-sm font-medium mb-2">Stato spedizione</label>
              <select
                className="w-full rounded-xl border p-3 bg-white"
                value={shippingStatus}
                onChange={(e) => setShippingStatus(e.target.value)}
              >
                <option value="">Tutti</option>
                <option value="NON_SPEDITO">Non spedito</option>
                <option value="PARZIALE">Parziale</option>
                <option value="SPEDITO">Spedito</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
              disabled={loading}
              onClick={loadOrders}
            >
              {loading ? "Caricamento..." : "Aggiorna elenco"}
            </button>

            <button
              type="button"
              className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
              onClick={() => {
                resetFilters();
                setTimeout(() => {
                  loadOrders();
                }, 0);
              }}
            >
              Reset filtri
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {msg && (
          <div className="rounded-xl border bg-white p-3 text-sm text-gray-700">
            {msg}
          </div>
        )}

        <section className="rounded-2xl border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Data</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">PV</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Operatore</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Righe</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Stato ordine</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Spedizione</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Azioni</th>
                </tr>
              </thead>

              <tbody>
                {bootLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      Caricamento...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      Nessun ordine disponibile.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3 align-top">{formatDate(row.order_date)}</td>

                      <td className="px-4 py-3 align-top">
                        <div className="font-medium">
                          {row.pv_code}
                          {row.pv_name ? ` — ${row.pv_name}` : ""}
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div>{row.operatore || "—"}</div>
                        {row.created_by_username && (
                          <div className="text-xs text-gray-500 mt-1">
                            utente: {row.created_by_username}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div>Totali: {row.total_rows}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Evasi: {row.evaded_rows} · Da ordinare: {row.pending_rows}
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${orderStatusBadge(
                            row.order_status
                          )}`}
                        >
                          {orderStatusLabel(row.order_status)}
                        </span>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${shippingStatusBadge(
                            row.shipping_status
                          )}`}
                        >
                          {shippingStatusLabel(row.shipping_status)}
                        </span>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/admin/ordini-pv/${row.id}`}
                          className="inline-flex rounded-xl border px-3 py-2 hover:bg-gray-50"
                        >
                          Apri dettaglio
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}