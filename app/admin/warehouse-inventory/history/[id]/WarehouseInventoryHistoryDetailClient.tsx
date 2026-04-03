"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type HeaderDetail = {
  id: string;
  inventory_date: string;
  operatore: string | null;
  notes: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
};

type DetailRow = {
  id: string;
  warehouse_item_id: string;
  code: string;
  description: string;
  um: string | null;
  qty: number | null;
  qty_ml: number | null;
  qty_gr: number | null;
  stock_qty_before: number | null;
  difference_qty: number | null;
};

type ApiResponse = {
  ok: boolean;
  header?: HeaderDetail;
  rows?: DetailRow[];
  error?: string;
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

export default function WarehouseInventoryHistoryDetailClient({
  headerId,
}: {
  headerId: string;
}) {
  const [header, setHeader] = useState<HeaderDetail | null>(null);
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDetail() {
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<ApiResponse>(
        `/api/warehouse-inventory/history/${encodeURIComponent(headerId)}`
      );

      if (!ok) {
        throw new Error(data?.error || rawText || `HTTP ${status}`);
      }

      setHeader(data.header ?? null);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMsg(`Righe inventario: ${Array.isArray(data.rows) ? data.rows.length : 0}`);
    } catch (e: any) {
      setHeader(null);
      setRows([]);
      setError(e?.message || "Errore caricamento dettaglio inventario");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!headerId) return;
    loadDetail();
  }, [headerId]);

  const shortageRows = rows.filter((row) => Number(row.difference_qty ?? 0) < 0).length;
  const excessRows = rows.filter((row) => Number(row.difference_qty ?? 0) > 0).length;
  const equalRows = rows.filter((row) => Number(row.difference_qty ?? 0) === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/warehouse-inventory/history"
          className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          ← Torna allo Storico
        </Link>

        <Link
          href="/admin/warehouse-inventory"
          className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          ← Torna a Inventario Magazzino
        </Link>
      </div>

      {msg && <div className="text-sm text-emerald-700">{msg}</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-lg font-semibold">Testata inventario</div>
            <div className="text-sm text-gray-600">
              Dati generali dell&apos;inventario confermato.
            </div>
          </div>

          <button
            type="button"
            className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
            onClick={loadDetail}
            disabled={loading}
          >
            {loading ? "Aggiorno..." : "Aggiorna"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Data inventario</div>
            <div className="mt-1 text-sm font-semibold">
              {formatNullableText(header?.inventory_date)}
            </div>
          </div>

          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Operatore</div>
            <div className="mt-1 text-sm font-semibold">
              {formatNullableText(header?.operatore)}
            </div>
          </div>

          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Creato da</div>
            <div className="mt-1 text-sm font-semibold">
              {formatNullableText(header?.created_by_username)}
            </div>
          </div>

          <div className="rounded-xl border bg-gray-50 p-3 md:col-span-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Note</div>
            <div className="mt-1 text-sm font-semibold">
              {formatNullableText(header?.notes)}
            </div>
          </div>

          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Creato il</div>
            <div className="mt-1 text-sm font-semibold">
              {formatDateTimeIT(header?.created_at)}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="text-lg font-semibold">Riepilogo righe</div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Righe</div>
            <div className="mt-1 text-lg font-semibold">{rows.length}</div>
          </div>

          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Ammanchi</div>
            <div className="mt-1 text-lg font-semibold">{shortageRows}</div>
          </div>

          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Eccedenze</div>
            <div className="mt-1 text-lg font-semibold">{excessRows}</div>
          </div>

          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Invariate</div>
            <div className="mt-1 text-lg font-semibold">{equalRows}</div>
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
              <th className="p-3 text-right w-28">Stock prima</th>
              <th className="p-3 text-right w-28">Qtà contata</th>
              <th className="p-3 text-right w-28">Differenza</th>
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
                  Nessuna riga trovata.
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3 font-medium">{formatNullableText(row.code)}</td>
                  <td className="p-3">{formatNullableText(row.description)}</td>
                  <td className="p-3">{formatNullableText(row.um)}</td>
                  <td className="p-3 text-right">{formatQty(row.stock_qty_before)}</td>
                  <td className="p-3 text-right">{formatQty(row.qty)}</td>
                  <td
                    className={`p-3 text-right font-medium ${
                      Number(row.difference_qty ?? 0) < 0
                        ? "text-red-600"
                        : Number(row.difference_qty ?? 0) > 0
                        ? "text-emerald-700"
                        : "text-gray-700"
                    }`}
                  >
                    {formatQty(row.difference_qty)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}