"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type RowStatus = "DA_ORDINARE" | "EVASO";
type ShippingStatus = "NON_SPEDITO" | "PARZIALE" | "SPEDITO";
type OrderStatus = "DA_COMPLETARE" | "COMPLETO";

type OrderHeader = {
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

type OrderRow = {
  id: string;
  order_id: string;
  item_id: string;
  item_code: string;
  item_description: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
  row_status: RowStatus;
  created_at: string;
  updated_at: string;
};

type OrderDetailResponse = {
  ok: boolean;
  header?: OrderHeader;
  rows?: OrderRow[];
  error?: string;
};

type Props = {
  orderId: string;
};

function formatDate(value: string) {
  if (!value) return "—";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateTime(value: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

function rowStatusBadge(status: RowStatus) {
  return status === "EVASO"
    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : "bg-amber-100 text-amber-800 border-amber-200";
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

function orderStatusBadge(status: OrderStatus) {
  return status === "COMPLETO"
    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : "bg-amber-100 text-amber-800 border-amber-200";
}

function rowStatusLabel(status: RowStatus) {
  return status === "EVASO" ? "Evaso" : "Da ordinare";
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

export default function OrdinePvDetailClient({ orderId }: Props) {
  const [header, setHeader] = useState<OrderHeader | null>(null);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rowSavingId, setRowSavingId] = useState<string | null>(null);
  const [shippingSaving, setShippingSaving] = useState(false);

  const totalQtyInfo = useMemo(() => {
    let qty = 0;
    let qtyMl = 0;
    let qtyGr = 0;

    for (const row of rows) {
      qty += Number(row.qty || 0);
      qtyMl += Number(row.qty_ml || 0);
      qtyGr += Number(row.qty_gr || 0);
    }

    return { qty, qtyMl, qtyGr };
  }, [rows]);

  async function loadDetail() {
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<OrderDetailResponse>(
        `/api/pv-orders/${encodeURIComponent(orderId)}`
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      setHeader(data.header || null);
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e: any) {
      setError(e?.message || "Errore");
      setHeader(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function updateRowStatus(rowId: string, nextStatus: RowStatus) {
    setRowSavingId(rowId);
    setError(null);
    setMsg(null);

    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        `/api/pv-orders/${encodeURIComponent(orderId)}/row-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            row_id: rowId,
            row_status: nextStatus,
          }),
        }
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      setMsg("Stato riga aggiornato.");
      await loadDetail();
    } catch (e: any) {
      setError(e?.message || "Errore");
    } finally {
      setRowSavingId(null);
    }
  }

  async function updateShippingStatus(nextStatus: ShippingStatus) {
    setShippingSaving(true);
    setError(null);
    setMsg(null);

    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        `/api/pv-orders/${encodeURIComponent(orderId)}/shipping-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipping_status: nextStatus,
          }),
        }
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      setMsg("Stato spedizione aggiornato.");
      await loadDetail();
    } catch (e: any) {
      setError(e?.message || "Errore");
    } finally {
      setShippingSaving(false);
    }
  }

  function openPdf() {
    window.open(`/api/pv-orders/${encodeURIComponent(orderId)}/pdf`, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Dettaglio Ordine PV</h1>
            <p className="text-gray-600 mt-1">
              Gestione stato righe, stato spedizione e stampa PDF dell&apos;ordine.
            </p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={openPdf}
              className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
            >
              Stampa PDF
            </button>

            <button
              type="button"
              onClick={loadDetail}
              className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
            >
              Aggiorna
            </button>

            <Link
              href="/admin/ordini-pv"
              className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
            >
              Torna agli ordini
            </Link>
          </div>
        </div>

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

        {loading ? (
          <div className="rounded-2xl border bg-white p-8 text-center text-gray-500">
            Caricamento...
          </div>
        ) : !header ? (
          <div className="rounded-2xl border bg-white p-8 text-center text-gray-500">
            Ordine non trovato.
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">PV</div>
                <div className="text-lg font-semibold mt-1">
                  {header.pv_code}
                  {header.pv_name ? ` — ${header.pv_name}` : ""}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Operatore</div>
                <div className="text-lg font-semibold mt-1">{header.operatore || "—"}</div>
                {header.created_by_username && (
                  <div className="text-xs text-gray-500 mt-1">
                    utente: {header.created_by_username}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Data ordine</div>
                <div className="text-lg font-semibold mt-1">
                  {formatDate(header.order_date)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  creato: {formatDateTime(header.created_at)}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Ultimo aggiornamento</div>
                <div className="text-lg font-semibold mt-1">
                  {formatDateTime(header.updated_at)}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm text-gray-500">Stato ordine</div>
                <div className="mt-2">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${orderStatusBadge(
                      header.order_status
                    )}`}
                  >
                    {orderStatusLabel(header.order_status)}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-3">
                  Totali: {header.total_rows} · Evasi: {header.evaded_rows} · Da ordinare:{" "}
                  {header.pending_rows}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4 md:col-span-2">
                <div className="flex items-start justify-between gap-4 flex-col md:flex-row">
                  <div>
                    <div className="text-sm text-gray-500">Stato spedizione</div>
                    <div className="mt-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${shippingStatusBadge(
                          header.shipping_status
                        )}`}
                      >
                        {shippingStatusLabel(header.shipping_status)}
                      </span>
                    </div>
                  </div>

                  <div className="w-full md:w-auto">
                    <label className="block text-sm font-medium mb-2">
                      Aggiorna spedizione
                    </label>
                    <select
                      className="w-full md:w-64 rounded-xl border p-3 bg-white"
                      value={header.shipping_status}
                      disabled={shippingSaving}
                      onChange={(e) =>
                        updateShippingStatus(e.target.value as ShippingStatus)
                      }
                    >
                      <option value="NON_SPEDITO">Non spedito</option>
                      <option value="PARZIALE">Parziale</option>
                      <option value="SPEDITO">Spedito</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-4">
              <div className="flex items-start justify-between gap-4 flex-col md:flex-row">
                <div>
                  <h2 className="text-lg font-semibold">Righe ordine</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Per ogni riga puoi impostare se è evasa oppure ancora da ordinare.
                  </p>
                </div>

                <div className="text-sm text-gray-600">
                  <div>Pz totali: {totalQtyInfo.qty}</div>
                  <div>ML totali: {totalQtyInfo.qtyMl}</div>
                  <div>GR totali: {totalQtyInfo.qtyGr}</div>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-y">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Articolo</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Quantità</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Stato riga</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Aggiorna</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                          Nessuna riga presente.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row.id} className="border-b last:border-b-0">
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium">{row.item_code || "—"}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {row.item_description || "—"}
                            </div>
                          </td>

                          <td className="px-4 py-3 align-top">
                            <div>Pz: {row.qty}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              ML: {row.qty_ml} · GR: {row.qty_gr}
                            </div>
                          </td>

                          <td className="px-4 py-3 align-top">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${rowStatusBadge(
                                row.row_status
                              )}`}
                            >
                              {rowStatusLabel(row.row_status)}
                            </span>
                          </td>

                          <td className="px-4 py-3 align-top">
                            <select
                              className="w-full md:w-48 rounded-xl border p-2 bg-white"
                              value={row.row_status}
                              disabled={rowSavingId === row.id}
                              onChange={(e) =>
                                updateRowStatus(row.id, e.target.value as RowStatus)
                              }
                            >
                              <option value="DA_ORDINARE">Da ordinare</option>
                              <option value="EVASO">Evaso</option>
                            </select>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}