"use client";

import { useEffect, useState } from "react";
import { generatePvCashSummaryPdf } from "@/lib/pdf/generatePvCashSummaryPdf";

type Row = {
  id: string;
  data: string;
  operatore: string | null;
  totale: number | null;
  incasso_totale: number | null;
  lis_plus: number | null;
  mooney: number | null;
  vendita_gv: number | null;
  vendita_tabacchi: number | null;
  gv_pagati: number | null;
  pos: number | null;
  versamento: number | null;
  da_versare: number | null;
  tot_versato: number | null;
  fondo_cassa: number | null;
  status: string | null;
  is_closed: boolean;
};
type Detail = { summary: any; suppliers: Array<{ supplier_code?: string | null; supplier_name?: string | null; amount?: number | null }> };

const euro = (value: unknown) => Number(value ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const dateLabel = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : value;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const firstOfMonth = () => `${today().slice(0, 7)}-01`;

const numberValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function AmountTable({ title, fields, summary, total }: {
  title: string;
  fields: Array<[string, string]>;
  summary: Record<string, any>;
  total?: { label: string; amount: number };
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
      <h3 className="bg-blue-800 px-4 py-3 text-sm font-semibold text-white">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {fields.map(([key, label]) => (
            <tr className="border-b border-slate-100 last:border-b-0" key={key}>
              <th scope="row" className="px-4 py-3 text-left font-medium text-slate-700">{label}</th>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{euro(summary[key])}</td>
            </tr>
          ))}
          {total && (
            <tr className="bg-blue-50">
              <th scope="row" className="px-4 py-3 text-left font-bold text-blue-950">{total.label}</th>
              <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums text-blue-950">{euro(total.amount)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ReservedCashClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [pvLabel, setPvLabel] = useState("");
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadRows() {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("date_from", from);
      if (to) params.set("date_to", to);
      const res = await fetch(`/api/reserved-cash/list?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Errore caricamento");
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setPvLabel([json.pv?.code, json.pv?.name].filter(Boolean).join(" - "));
    } catch (e) { setRows([]); setError(e instanceof Error ? e.message : "Errore di rete"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadRows(); /* caricamento iniziale */ }, []);

  async function openDetail(id: string) {
    setDetailLoading(true); setDetail(null); setError("");
    try {
      const res = await fetch(`/api/reserved-cash/detail?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.summary) throw new Error(json.error || "Dettaglio non disponibile");
      setDetail({ summary: json.summary, suppliers: Array.isArray(json.suppliers) ? json.suppliers : [] });
    } catch (e) { setError(e instanceof Error ? e.message : "Errore di rete"); }
    finally { setDetailLoading(false); }
  }

  async function downloadPdf() {
    if (!detail) return;
    setPdfLoading(true); setError("");
    try { generatePvCashSummaryPdf({ summary: detail.summary, suppliers: detail.suppliers }); }
    catch { setError("Impossibile generare il PDF"); }
    finally { setPdfLoading(false); }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 p-5 text-white">
          <div><p className="text-xs uppercase tracking-wider text-slate-300">3M CONTROL · Area riservata</p><h1 className="mt-1 text-2xl font-semibold">Riepiloghi Incassato</h1><p className="mt-1 text-sm text-slate-200">{pvLabel || "Punto vendita assegnato"} · Sola consultazione</p></div>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await fetch("/api/auth/logout", { method: "POST" });
                if (!res.ok) throw new Error("Logout non riuscito");
                window.location.replace("/login");
              } catch {
                alert("Errore durante il logout. Riprova.");
              }
            }}
            className="rounded-lg border border-slate-500 px-3 py-2 text-sm hover:bg-slate-800"
          >Esci</button>
        </header>
        <section className="rounded-2xl border bg-white p-5">
          <form onSubmit={(event) => { event.preventDefault(); void loadRows(); }} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">Dal<input type="date" className="mt-1 block rounded-lg border p-2" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-sm">Al<input type="date" className="mt-1 block rounded-lg border p-2" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-white">Applica filtri</button>
            <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="rounded-lg border px-4 py-2">Tutto il periodo</button>
          </form>
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </section>
        <section className="min-w-0 rounded-2xl border bg-white p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">Storico riepiloghi</h2><span className="text-sm text-slate-500">{rows.length} risultati</span></div>
          {loading ? <p className="text-sm text-slate-600">Caricamento...</p> : (
            <>
              <table className="hidden w-full table-fixed text-[10px] leading-tight sm:table lg:text-xs">
                <colgroup>
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "8%" }} />
                </colgroup>
                <thead>
                  <tr className="border-b bg-slate-50 text-slate-700">
                    <th className="px-1 py-2 text-center">Data</th>
                    <th className="px-1 py-2 text-center">Operatore</th>
                    <th className="px-1 py-2 text-center">Incasso<br />Totale</th>
                    <th className="px-1 py-2 text-center">LIS+</th>
                    <th className="px-1 py-2 text-center">Mooney</th>
                    <th className="px-1 py-2 text-center">Vendita<br />G&amp;V</th>
                    <th className="px-1 py-2 text-center">Vendita<br />Tabacchi</th>
                    <th className="px-1 py-2 text-center">G&amp;V<br />Pagati</th>
                    <th className="px-1 py-2 text-center">POS</th>
                    <th className="px-1 py-2 text-center">Tot.<br />Versato</th>
                    <th className="px-1 py-2 text-center">Dettaglio</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr className="border-b hover:bg-slate-50" key={r.id}>
                      <td className="whitespace-nowrap px-1 py-2 text-center font-medium">{dateLabel(r.data)}</td>
                      <td className="break-words px-1 py-2 text-center">{r.operatore || "—"}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-center tabular-nums">{euro(r.incasso_totale)}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-center tabular-nums">{euro(r.lis_plus)}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-center tabular-nums">{euro(r.mooney)}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-center tabular-nums">{euro(r.vendita_gv)}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-center tabular-nums">{euro(r.vendita_tabacchi)}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-center tabular-nums">{euro(r.gv_pagati)}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-center tabular-nums">{euro(r.pos)}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-center font-semibold tabular-nums">{euro(r.tot_versato)}</td>
                      <td className="px-1 py-2 text-center">
                        <button type="button" onClick={() => void openDetail(r.id)} className="rounded border px-1.5 py-1 hover:bg-slate-100">Apri</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-3 sm:hidden">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-xl border p-3 text-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div><strong>{dateLabel(r.data)}</strong><p className="text-xs text-slate-500">{r.operatore || "—"}</p></div>
                      <button type="button" onClick={() => void openDetail(r.id)} className="rounded-lg border px-3 py-1.5 text-xs">Dettaglio</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {([
                        ["Incasso Totale", r.incasso_totale], ["LIS+", r.lis_plus],
                        ["Mooney", r.mooney], ["Vendita G&V", r.vendita_gv],
                        ["Vendita Tabacchi", r.vendita_tabacchi], ["G&V Pagati", r.gv_pagati],
                        ["POS", r.pos], ["Tot. Versato", r.tot_versato],
                      ] as Array<[string, number | null]>).map(([label, value]) => (
                        <div key={label} className="rounded bg-slate-50 p-2">
                          <div className="text-slate-500">{label}</div>
                          <div className="font-semibold tabular-nums">{euro(value)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {!loading && rows.length === 0 && <p className="mt-4 text-sm text-slate-500">Nessun riepilogo trovato.</p>}
        </section>
        {detailLoading && <p className="rounded-xl border bg-white p-4">Caricamento dettaglio...</p>}
        {detail && (() => {
          const summary = detail.summary;
          const totaleEntrate = ["incasso_totale", "vendita_gv", "vendita_tabacchi", "lis_plus", "mooney"].reduce((sum, key) => sum + numberValue(summary[key]), 0);
          const totaleUscite = ["pagamento_fornitori", "gv_pagati", "pos"].reduce((sum, key) => sum + numberValue(summary[key]), 0);
          const initial = numberValue(summary.fondo_cassa_iniziale);
          const current = numberValue(summary.fondo_cassa);
          const delta = initial === 0 ? "—" : `${current > initial ? "+" : ""}${(((current - initial) / initial) * 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
          return (
            <section className="space-y-5 rounded-2xl border bg-white p-4 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Riepilogo Incassato — {dateLabel(summary.data)}</h2>
                  <p className="mt-1 text-sm text-slate-600">PV: {summary.pv_label || pvLabel} · Operatore: {summary.operatore || "—"} · Stato: {summary.is_closed ? "Chiuso" : summary.status || "Bozza"}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void downloadPdf()} disabled={pdfLoading} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">{pdfLoading ? "Genero..." : "Scarica PDF"}</button>
                  <button type="button" onClick={() => setDetail(null)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">Chiudi</button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <AmountTable title="Entrate" summary={summary} fields={[
                  ["incasso_totale", "Incasso Totale"], ["vendita_gv", "Vendita G&V"],
                  ["vendita_tabacchi", "Vendita Tabacchi"], ["lis_plus", "LIS+"],
                  ["mooney", "Mooney"],
                ]} total={{ label: "Totale Entrate", amount: totaleEntrate }} />
                <AmountTable title="Uscite" summary={summary} fields={[
                  ["pagamento_fornitori", "Pagamento Fornitori"], ["gv_pagati", "G&V Pagati"], ["pos", "POS"],
                ]} total={{ label: "Totale Uscite", amount: totaleUscite }} />
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <h3 className="bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Versamenti</h3>
                <table className="w-full text-sm"><tbody>
                  {[
                    ["Versamento", numberValue(summary.versamento) + numberValue(summary.spese_extra)],
                    ["Prelievo", numberValue(summary.spese_extra)],
                    ["Tot. da Versare", numberValue(summary.versamento)],
                  ].map(([label, amount]) => (
                    <tr key={String(label)} className="border-b border-slate-100 last:border-b-0">
                      <th scope="row" className="px-4 py-3 text-left font-medium text-slate-700">{label}</th>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{euro(amount)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <h3 className="bg-blue-800 px-4 py-3 text-sm font-semibold text-white">Pagamenti Fornitori</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] text-sm">
                    <thead className="bg-slate-50 text-left"><tr><th className="px-4 py-3">Codice</th><th className="px-4 py-3">Ragione sociale</th><th className="px-4 py-3 text-right">Importo</th></tr></thead>
                    <tbody>{detail.suppliers.map((supplier, index) => (
                      <tr key={index} className="border-t"><td className="px-4 py-3">{supplier.supplier_code || "—"}</td><td className="px-4 py-3">{supplier.supplier_name || "—"}</td><td className="px-4 py-3 text-right tabular-nums">{euro(supplier.amount)}</td></tr>
                    ))}</tbody>
                  </table>
                  {detail.suppliers.length === 0 && <p className="px-4 pb-4 text-sm text-slate-500">Nessun pagamento fornitore.</p>}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <h3 className="bg-blue-800 px-4 py-3 text-sm font-semibold text-white">Fondo Cassa</h3>
                <div className="grid gap-3 p-4 sm:grid-cols-3">
                  <div><p className="text-xs text-slate-500">Fondo Cassa Iniziale</p><p className="mt-1 text-lg font-bold tabular-nums">{euro(summary.fondo_cassa_iniziale)}</p></div>
                  <div><p className="text-xs text-slate-500">Fondo Cassa</p><p className="mt-1 text-lg font-bold tabular-nums">{euro(summary.fondo_cassa)}</p></div>
                  <div><p className="text-xs text-slate-500">Differenza %</p><p className="mt-1 text-lg font-bold tabular-nums">{delta}</p></div>
                </div>
              </div>
              <p className="text-xs text-slate-500">Consultazione in sola lettura. Nessun dato viene modificato.</p>
            </section>
          );
        })()}
      </div>
    </main>
  );
}
