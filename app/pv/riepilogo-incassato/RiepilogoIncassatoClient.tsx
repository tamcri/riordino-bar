"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SummaryStatus = "bozza" | "completato" | "chiuso";
type PeriodPresetKey =
  | "current_month"
  | "last_month"
  | "last_30_days"
  | "current_year"
  | "all";

type PvCashSummaryRow = {
  id: string;
  data: string;
  operatore: string;
  totale: number | null;
  da_versare: number | null;
  tot_versato: number | null;
  status?: string | null;
  is_closed: boolean;
};

type NotificationRow = {
  id: string;
  summary_id: string;
  pv_id: string;
  summary_date: string;
  message: string;
  changed_fields?: string[] | null;
  field_comments?: Record<string, string> | null;
  is_read: boolean;
  created_at: string;
  read_at?: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  incasso_totale: "Incasso Totale",
  gv_pagati: "G&V Pagati",
  lis_plus: "LIS+",
  mooney: "Mooney",
  vendita_gv: "Vendita G&V",
  vendita_tabacchi: "Vendita Tabacchi",
  pos: "POS",
  spese_extra: "Spese Extra",
  tot_versato: "Tot. Versato",
  fondo_cassa_iniziale: "Fondo Cassa Iniziale",
  parziale_1: "Parziale 1",
  parziale_2: "Parziale 2",
  parziale_3: "Parziale 3",
  fondo_cassa: "Fondo Cassa",
};

function formatEuro(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFieldLabel(fieldKey: string) {
  return FIELD_LABELS[fieldKey] ?? fieldKey;
}

function normalizeStatus(row: PvCashSummaryRow): SummaryStatus {
  if (row.is_closed || Number(row.tot_versato ?? 0) > 0) {
    return "chiuso";
  }

  const raw = String(row.status ?? "").trim().toLowerCase();

  if (raw === "bozza") return "bozza";
  if (raw === "completato") return "completato";
  if (raw === "chiuso") return "chiuso";

  return "bozza";
}

function statusBadge(status: SummaryStatus) {
  switch (status) {
    case "chiuso":
      return (
        <span className="inline-flex items-center gap-2 font-medium text-green-700">
          <span className="h-2.5 w-2.5 rounded-full bg-green-600" />
          Chiuso
        </span>
      );
    case "completato":
      return (
        <span className="inline-flex items-center gap-2 font-medium text-blue-700">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
          Completato
        </span>
      );
    case "bozza":
    default:
      return (
        <span className="inline-flex items-center gap-2 font-medium text-amber-700">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          Bozza
        </span>
      );
  }
}

function getTodayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getDateOnlyFromString(value: string) {
  const [year, month, day] = String(value ?? "").split("-").map(Number);

  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

function getPeriodPresetRange(preset: PeriodPresetKey) {
  const today = getTodayDateOnly();

  switch (preset) {
    case "current_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start, end: today };
    }

    case "last_month": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start, end };
    }

    case "last_30_days": {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { start, end: today };
    }

    case "current_year": {
      const start = new Date(today.getFullYear(), 0, 1);
      return { start, end: today };
    }

    case "all":
    default:
      return { start: null, end: null };
  }
}

export default function RiepilogoIncassatoClient() {
  const router = useRouter();

  const [rows, setRows] = useState<PvCashSummaryRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [activePeriodPreset, setActivePeriodPreset] =
    useState<PeriodPresetKey>("current_month");

  async function loadRows() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/cash-summary/pv-list", {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setRows([]);
        setMsg(json?.error || "Errore caricamento riepiloghi");
        return;
      }

      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch {
      setRows([]);
      setMsg("Errore di rete");
    } finally {
      setLoading(false);
    }
  }

  async function loadNotifications() {
    setNotificationsLoading(true);

    try {
      const res = await fetch("/api/cash-summary/pv-notifications", {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setNotifications([]);
        return;
      }

      setNotifications(Array.isArray(json.rows) ? json.rows : []);
    } catch {
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function markNotificationAsRead(id: string) {
    setMarkingReadId(id);

    try {
      const res = await fetch("/api/cash-summary/pv-notifications/read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore aggiornamento notifica");
        return;
      }

      setNotifications((prev) => prev.filter((row) => row.id !== id));
    } catch {
      setMsg("Errore di rete");
    } finally {
      setMarkingReadId(null);
    }
  }

  useEffect(() => {
    loadRows();
    loadNotifications();
  }, []);

  const filteredRows = useMemo(() => {
    if (activePeriodPreset === "all") return rows;

    const { start, end } = getPeriodPresetRange(activePeriodPreset);

    if (!start || !end) return rows;

    return rows.filter((row) => {
      const rowDate = getDateOnlyFromString(row.data);
      if (!rowDate) return false;
      return rowDate >= start && rowDate <= end;
    });
  }, [rows, activePeriodPreset]);

  return (
    <div className="space-y-6">
      {msg && (
        <div className="rounded-xl border bg-white p-3 text-sm text-gray-700">
          {msg}
        </div>
      )}

      {!notificationsLoading && notifications.length > 0 && (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const changedFields = Array.isArray(notification.changed_fields)
              ? notification.changed_fields
              : [];

            const fieldComments =
              notification.field_comments && typeof notification.field_comments === "object"
                ? notification.field_comments
                : {};

            return (
              <div
                key={notification.id}
                className="rounded-2xl border border-blue-200 bg-blue-50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-blue-900">
                      Riepilogo modificato dall’amministrazione
                    </h2>
                    <p className="mt-1 text-sm text-blue-800">
                      Il riepilogo del <strong>{formatDate(notification.summary_date)}</strong> è stato modificato dall’amministrazione il{" "}
                      <strong>{formatDateTime(notification.created_at)}</strong>.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => markNotificationAsRead(notification.id)}
                    disabled={markingReadId === notification.id}
                    className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {markingReadId === notification.id ? "Salvo..." : "Segna come letta"}
                  </button>
                </div>

                {changedFields.length > 0 && (
                  <div className="mt-3">
                    <div className="text-sm font-medium text-blue-900">Campi aggiornati:</div>
                    <ul className="mt-1 list-disc pl-5 text-sm text-blue-800">
                      {changedFields.map((field, index) => (
                        <li key={`${notification.id}-${field}-${index}`}>
                          {getFieldLabel(field)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {Object.keys(fieldComments).length > 0 && (
                  <div className="mt-3 rounded-xl border border-blue-200 bg-white p-3">
                    <div className="text-sm font-medium text-slate-900">Note amministrazione</div>
                    <div className="mt-2 space-y-2 text-sm text-slate-700">
                      {Object.entries(fieldComments).map(([fieldKey, commentText]) => (
                        <div key={`${notification.id}-${fieldKey}`}>
                          <span className="font-medium">{getFieldLabel(fieldKey)}:</span>{" "}
                          {String(commentText)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Riepilogo Incassato
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Qui trovi tutti i riepiloghi inseriti.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/pv/riepilogo-incassato/new")}
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
          >
            Nuovo Riepilogo
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActivePeriodPreset("current_month")}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                activePeriodPreset === "current_month"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
              }`}
            >
              Mese corrente
            </button>

            <button
              type="button"
              onClick={() => setActivePeriodPreset("last_month")}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                activePeriodPreset === "last_month"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
              }`}
            >
              Mese scorso
            </button>

            <button
              type="button"
              onClick={() => setActivePeriodPreset("last_30_days")}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                activePeriodPreset === "last_30_days"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
              }`}
            >
              Ultimi 30 giorni
            </button>

            <button
              type="button"
              onClick={() => setActivePeriodPreset("current_year")}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                activePeriodPreset === "current_year"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
              }`}
            >
              Anno corrente
            </button>

            <button
              type="button"
              onClick={() => setActivePeriodPreset("all")}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                activePeriodPreset === "all"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
              }`}
            >
              Tutto
            </button>
          </div>

          <div className="rounded-xl border bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Righe visualizzate: <span className="font-semibold">{filteredRows.length}</span>
          </div>
        </div>

        {loading && <div className="text-sm text-gray-500">Caricamento...</div>}

        {!loading && filteredRows.length === 0 && (
          <div className="text-sm text-gray-500">
            Nessun riepilogo presente.
          </div>
        )}

        {!loading && filteredRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2 text-left">Data</th>
                  <th className="p-2 text-left">Operatore</th>
                  <th className="p-2 text-right">Totale</th>
                  <th className="p-2 text-right">Da Versare</th>
                  <th className="p-2 text-center">Stato</th>
                  <th className="p-2 text-center">Azioni</th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((row) => {
                  const status = normalizeStatus(row);
                  const isClosed = status === "chiuso";

                  return (
                    <tr key={row.id} className="border-t">
                      <td className="p-2">{row.data}</td>
                      <td className="p-2">{row.operatore}</td>
                      <td className="p-2 text-right">{formatEuro(row.totale)}</td>
                      <td className="p-2 text-right">{formatEuro(row.da_versare)}</td>

                      <td className="p-2 text-center">{statusBadge(status)}</td>

                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              router.push(`/pv/riepilogo-incassato/${row.id}?mode=view`)
                            }
                            className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                          >
                            Dettaglio
                          </button>

                          {!isClosed && (
                            <button
                              type="button"
                              onClick={() =>
                                router.push(`/pv/riepilogo-incassato/${row.id}`)
                              }
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
                            >
                              Apri
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}