"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProgressiviReportData } from "@/lib/progressivi/report";

function formatDateIT(iso: string | null | undefined) {
  const s = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function formatNum(n: number) {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(n || 0);
}

function formatEur(n: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(n || 0);
}

function toInputValue(n: number) {
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

function parseDecimalInput(value: string) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

type DraftMap = Record<string, string>;

export default function ProgressiviReportTable({
  data,
  reportHeaderId,
  downloadHref,
}: {
  data: ProgressiviReportData;
  reportHeaderId?: string | null;
  downloadHref?: string;
}) {
  const router = useRouter();

  const [drafts, setDrafts] = useState<DraftMap>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const canEdit = Boolean(reportHeaderId);

  const initialDrafts = useMemo(() => {
    const next: DraftMap = {};
    for (const row of data.rows) {
      next[`${row.item_code}__previous`] = toInputValue(row.previous.carico_non_registrato);
      next[`${row.item_code}__current`] = toInputValue(row.current.carico_non_registrato);
    }
    return next;
  }, [data.rows]);

  useEffect(() => {
    setDrafts(initialDrafts);
  }, [initialDrafts]);

  function handlePrintPdf() {
    window.print();
  }

  function setDraft(itemCode: string, mode: "previous" | "current", value: string) {
    const key = `${itemCode}__${mode}`;
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }

  async function saveCarico(itemCode: string, mode: "previous" | "current") {
    if (!reportHeaderId) return;

    const key = `${itemCode}__${mode}`;
    const rawValue = drafts[key] ?? "0";
    const parsedValue = parseDecimalInput(rawValue);

    const row = data.rows.find((r) => r.item_code === itemCode);
    if (!row) return;

    const currentStoredValue =
      mode === "previous"
        ? row.previous.carico_non_registrato
        : row.current.carico_non_registrato;

    if (parsedValue === currentStoredValue) {
      setDrafts((prev) => ({ ...prev, [key]: toInputValue(parsedValue) }));
      return;
    }

    setSavingKey(key);
    setMsg(null);

    try {
      const res = await fetch("/api/inventories/progressivi/report/update-carico", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          report_header_id: reportHeaderId,
          item_code: itemCode,
          mode,
          value: parsedValue,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Errore salvataggio carico non registrato");
      }

      setDrafts((prev) => ({ ...prev, [key]: toInputValue(parsedValue) }));
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message || "Errore salvataggio carico non registrato");

      // ripristina il valore originale visibile
      setDrafts((prev) => ({
        ...prev,
        [key]: toInputValue(currentStoredValue),
      }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-4" data-report-header-id={reportHeaderId ?? ""}>
      <style jsx global>{`
        @media print {
          @page {
            size: landscape;
            margin: 10mm;
          }

          html,
          body {
            background: white !important;
          }

          .no-print {
            display: none !important;
          }

          .print-container {
            padding: 0 !important;
            margin: 0 !important;
          }

          .print-card {
            border: 1px solid #d1d5db !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            break-inside: avoid;
          }

          .print-table-wrap {
            overflow: visible !important;
          }

          .print-table {
            min-width: 0 !important;
            width: 100% !important;
            font-size: 10px !important;
          }

          .print-table th,
          .print-table td {
            padding: 6px !important;
          }

          .recount-row {
            background: #fef3c7 !important;
          }
        }
      `}</style>

      <div className="print-card rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Report Progressivi</h1>
            <div className="mt-1 text-sm text-gray-600">{data.pv.label}</div>
            <div className="mt-1 text-sm text-gray-600">
              Label:{" "}
              <span className="font-medium text-gray-800">
                {data.current_header.label || "—"}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Inventario corrente: {formatDateIT(data.current_header.inventory_date)} ·{" "}
              Inventario precedente: {formatDateIT(data.previous_header?.inventory_date)}
            </div>
          </div>

          <div className="no-print flex flex-wrap gap-2">
            {downloadHref ? (
              <a
                className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
                href={downloadHref}
              >
                Scarica Excel
              </a>
            ) : null}

            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
            >
              Scarica PDF
            </button>
          </div>
        </div>
      </div>

      {msg ? (
        <div className="no-print rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {msg}
        </div>
      ) : null}

      <div className="print-card rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        Nota logica:{" "}
        {canEdit
          ? "Il Carico non registrato è modificabile direttamente nel report. Il dato viene salvato e il report si ricalcola."
          : data.assumptions.carico_non_registrato}
      </div>

      <div className="print-card print-table-wrap overflow-auto rounded-2xl border bg-white">
        <table className="print-table min-w-[1650px] w-full text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th rowSpan={2} className="border-b border-r p-3 text-left">
                Codice
              </th>
              <th rowSpan={2} className="border-b border-r p-3 text-left">
                Descrizione
              </th>
              <th rowSpan={2} className="border-b border-r p-3 text-left">
                UM
              </th>
              <th rowSpan={2} className="border-b border-r p-3 text-left">
                Prezzo
              </th>

              <th colSpan={5} className="border-b border-r p-3 text-center font-semibold">
                {formatDateIT(data.previous_header?.inventory_date)}
              </th>

              <th colSpan={5} className="border-b border-r p-3 text-center font-semibold">
                {formatDateIT(data.current_header.inventory_date)}
              </th>

              <th colSpan={2} className="border-b p-3 text-center font-semibold">
                RISCONTRO
              </th>
            </tr>

            <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
              <th className="border-b border-r p-3 text-center">Inventario</th>
              <th className="border-b border-r p-3 text-center">Giacenza da gestionale</th>
              <th className="border-b border-r p-3 text-center">Carico non registrato</th>
              <th className="border-b border-r p-3 text-center">Giacenza</th>
              <th className="border-b border-r p-3 text-center">Valore giacenza</th>

              <th className="border-b border-r p-3 text-center">Inventario</th>
              <th className="border-b border-r p-3 text-center">Giacenza da gestionale</th>
              <th className="border-b border-r p-3 text-center">Carico non registrato</th>
              <th className="border-b border-r p-3 text-center">Giacenza</th>
              <th className="border-b border-r p-3 text-center">Valore giacenza</th>

              <th className="border-b border-r p-3 text-center">Differenza</th>
              <th className="border-b p-3 text-center">Valore differenza</th>
            </tr>
          </thead>

          <tbody>
            {data.rows.map((row) => {
              const isRecounted = Boolean((row as any).is_recounted);
              const prevKey = `${row.item_code}__previous`;
              const currKey = `${row.item_code}__current`;
              const isSavingPrev = savingKey === prevKey;
              const isSavingCurr = savingKey === currKey;

              return (
                <tr
                  key={row.item_code}
                  className={isRecounted ? "recount-row" : "odd:bg-white even:bg-gray-50"}
                >
                  <td className="border-b border-r p-3 font-mono">{row.item_code}</td>

                  <td className="border-b border-r p-3">
                    <div className="flex items-center gap-2">
                      <span>{row.description || "—"}</span>
                      {isRecounted ? (
                        <span className="inline-flex items-center rounded-full bg-yellow-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-900 print:bg-yellow-200">
                          Riconta
                        </span>
                      ) : null}
                    </div>
                  </td>

                  <td className="border-b border-r p-3">{row.um || "—"}</td>
                  <td className="border-b border-r p-3 text-right">
                    {formatEur(row.prezzo_vendita_eur)}
                  </td>

                  <td className="border-b border-r p-3 text-right">
                    {formatNum(row.previous.inventario)}
                  </td>
                  <td className="border-b border-r p-3 text-right">
                    {formatNum(row.previous.giacenza_da_gestionale)}
                  </td>
                  <td className="border-b border-r p-2 text-right">
                    <input
                      type="number"
                      step="0.001"
                      inputMode="decimal"
                      value={drafts[prevKey] ?? ""}
                      disabled={!canEdit || isSavingPrev}
                      onChange={(e) => setDraft(row.item_code, "previous", e.target.value)}
                      onBlur={() => saveCarico(row.item_code, "previous")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="no-print w-28 rounded-lg border bg-white px-2 py-1 text-right text-sm disabled:bg-gray-100"
                    />
                    <span className="hidden print:inline">
                      {formatNum(row.previous.carico_non_registrato)}
                    </span>
                  </td>
                  <td className="border-b border-r p-3 text-right font-medium">
                    {formatNum(row.previous.giacenza)}
                  </td>
                  <td className="border-b border-r p-3 text-right">
                    {formatEur(row.previous.valore_giacenza)}
                  </td>

                  <td className="border-b border-r p-3 text-right">
                    {formatNum(row.current.inventario)}
                  </td>
                  <td className="border-b border-r p-3 text-right">
                    {formatNum(row.current.giacenza_da_gestionale)}
                  </td>
                  <td className="border-b border-r p-2 text-right">
                    <input
                      type="number"
                      step="0.001"
                      inputMode="decimal"
                      value={drafts[currKey] ?? ""}
                      disabled={!canEdit || isSavingCurr}
                      onChange={(e) => setDraft(row.item_code, "current", e.target.value)}
                      onBlur={() => saveCarico(row.item_code, "current")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="no-print w-28 rounded-lg border bg-white px-2 py-1 text-right text-sm disabled:bg-gray-100"
                    />
                    <span className="hidden print:inline">
                      {formatNum(row.current.carico_non_registrato)}
                    </span>
                  </td>
                  <td className="border-b border-r p-3 text-right font-medium">
                    {formatNum(row.current.giacenza)}
                  </td>
                  <td className="border-b border-r p-3 text-right">
                    {formatEur(row.current.valore_giacenza)}
                  </td>

                  <td className="border-b border-r p-3 text-right font-semibold">
                    {formatNum(row.riscontro.differenza)}
                  </td>
                  <td className="border-b p-3 text-right font-semibold">
                    {formatEur(row.riscontro.valore_differenza)}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="bg-slate-100 font-semibold">
              <td className="border-t border-r p-3" colSpan={4}>
                Totali
              </td>

              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.previous.inventario)}
              </td>
              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.previous.giacenza_da_gestionale)}
              </td>
              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.previous.carico_non_registrato)}
              </td>
              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.previous.giacenza)}
              </td>
              <td className="border-t border-r p-3 text-right">
                {formatEur(data.totals.previous.valore_giacenza)}
              </td>

              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.current.inventario)}
              </td>
              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.current.giacenza_da_gestionale)}
              </td>
              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.current.carico_non_registrato)}
              </td>
              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.current.giacenza)}
              </td>
              <td className="border-t border-r p-3 text-right">
                {formatEur(data.totals.current.valore_giacenza)}
              </td>

              <td className="border-t border-r p-3 text-right">
                {formatNum(data.totals.riscontro.differenza)}
              </td>
              <td className="border-t p-3 text-right">
                {formatEur(data.totals.riscontro.valore_differenza)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
