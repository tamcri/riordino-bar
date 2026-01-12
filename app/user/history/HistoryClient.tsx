"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  created_at: string;
  created_by_username: string | null;
  created_by_role: string | null;
  pv_label: string;
  pv_id: string | null;
  type: "TAB" | "GV";

  weeks: number;
  days?: number | null;

  tot_rows: number | null;
  tot_order_qty: number | null;
  tot_weight_kg: number | null;
  tot_value_eur: number | null;
};

type PV = { id: string; code: string; name: string };

type MeResponse = {
  ok: boolean;
  username?: string;
  role?: "admin" | "amministrativo" | "punto_vendita";
  pv_id?: string | null;
  error?: string;
};

type PreviewMeta = {
  id: string;
  type: "TAB" | "GV";
  pv_label: string | null;
  weeks: number | null;
  days?: number | null;

  tot_rows?: number | null;
  tot_order_qty?: number | null;
  tot_weight_kg?: number | null;
  tot_value_eur?: number | null;

  created_at?: string | null;
  created_by_username?: string | null;

  preview_count?: number | null;
  totals_by_item_count?: number | null;
};

type PreviewRow = Record<string, any>;
type TotalsByItemRow = Record<string, any>;

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("it-IT");
}

function normPvLabel(s: string) {
  return (s || "")
    .toUpperCase()
    .trim()
    .replace(/[-–—]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

const PV_PAT_ALLOWED_NORM = new Set(
  [
    "A3 FLACCA",
    "C3 VELLETRI",
    "C7 ROVERETO",
    "C8 RIMINI",
    "C9 PERUGIA",
    "D1 VIAREGGIO",
    "D2 LATINA",
  ].map(normPvLabel)
);

function periodoLabel(r: Row) {
  const d = Number(r.days);
  if (Number.isFinite(d) && d > 0) return `${d} giorno/i`;
  return `${r.weeks} sett.`;
}

function n0(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function eur(v: any) {
  const n = n0(v);
  return `€ ${n.toFixed(2)}`;
}

function kg1(v: any) {
  const n = n0(v);
  return n.toFixed(1);
}

// label colonne più leggibili
function prettyCol(k: string) {
  const m: Record<string, string> = {
    codArticolo: "Cod. Articolo",
    descrizione: "Descrizione",
    qtaVenduta: "Qtà Venduta",
    valoreVenduto: "Val. Venduto",
    giacenza: "Giacenza",
    qtaTeorica: "Qtà Teorica",
    conf_da: "Conf. da",
    qtaOrdine: "Qtà Ordine",
    pesoKg: "Peso Kg",
    valoreDaOrdinare: "Val. da Ordinare",
  };
  return m[k] || k;
}

function formatCell(key: string, value: any) {
  if (value == null) return "";

  // formati “umani”
  if (key === "valoreVenduto" || key === "valoreDaOrdinare") return eur(value);
  if (key === "pesoKg") return kg1(value);
  if (key === "qtaVenduta" || key === "giacenza" || key === "qtaTeorica" || key === "conf_da" || key === "qtaOrdine") {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.trunc(n)) : String(value);
  }

  // evita decimali chilometrici se arrivano numeri strani
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  return String(value);
}

export default function HistoryClient() {
  const [typeFilter, setTypeFilter] = useState<"ALL" | "TAB" | "GV">("ALL");
  const [pvId, setPvId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [pvs, setPvs] = useState<PV[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [meRole, setMeRole] = useState<MeResponse["role"] | null>(null);

  // preview modal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<PreviewMeta | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [totalsByItem, setTotalsByItem] = useState<TotalsByItemRow[]>([]);

  // menu ...
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json: MeResponse = await res.json().catch(() => ({ ok: false }));
        if (res.ok && json?.ok) setMeRole(json.role || null);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/pvs/list");
        const json = await res.json().catch(() => null);
        if (res.ok && json?.ok) setPvs(json.rows || []);
      } catch {}
    })();
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (typeFilter !== "ALL") p.set("type", typeFilter);
    if (pvId) p.set("pvId", pvId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [typeFilter, pvId, from, to]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reorder/history/list${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Errore server (${res.status})`);
      setRows(json?.rows || []);
    } catch (e: any) {
      setError(e?.message || "Errore");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  function reset() {
    setTypeFilter("ALL");
    setPvId("");
    setFrom("");
    setTo("");
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewMeta(null);
    setPreviewRows([]);
    setTotalsByItem([]);
  }

  async function openPreview(r: Row) {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewMeta(null);
    setPreviewRows([]);
    setTotalsByItem([]);

    try {
      const id = encodeURIComponent(r.id);
      const res = await fetch(`/api/reorder/history/${id}/preview`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento anteprima");

      setPreviewMeta(json.meta || null);
      setPreviewRows(Array.isArray(json.rows) ? json.rows : []);
      setTotalsByItem(Array.isArray(json.totals_by_item) ? json.totals_by_item : []);
    } catch (e: any) {
      setPreviewError(e?.message || "Errore anteprima");
    } finally {
      setPreviewLoading(false);
    }
  }

  // ✅ colonne preview: sequenza richiesta
  const previewColumns = useMemo(() => {
    const first = previewRows?.[0];
    if (!first || typeof first !== "object") return [];

    const keys = Object.keys(first);

    const preferred = [
      "qtaVenduta",
      "valoreVenduto",
      "giacenza",
      "qtaTeorica",
      "conf_da",
      "qtaOrdine",
      "pesoKg",
      "valoreDaOrdinare",
      // (se vuoi tenere anche codice/descrizione, mettili in testa)
      "codArticolo",
      "descrizione",
    ];

    const ordered = [
      ...preferred.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !preferred.includes(k)),
    ];

    return ordered.slice(0, 12);
  }, [previewRows]);

  function renderActionLink(className: string, href: string, label: string, title?: string) {
    return (
      <a className={className} href={href} title={title}>
        {label}
      </a>
    );
  }

  // ✅ Fonte Totali: se ho totals_by_item => ordine completo (DB)
  const totalsSourceLabel = useMemo(() => {
    if (totalsByItem.length > 0) return "Ordine completo (DB)";
    if ((previewMeta?.preview_count || 0) > 0) return "Preview (parziale)";
    return "—";
  }, [totalsByItem.length, previewMeta?.preview_count]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium mb-2">Tipo</label>
            <select
              className="rounded-xl border p-3 w-full bg-white"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
            >
              <option value="ALL">Tutti</option>
              <option value="TAB">Tabacchi</option>
              <option value="GV">Gratta &amp; Vinci</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Punto vendita</label>
            <select className="rounded-xl border p-3 w-full bg-white" value={pvId} onChange={(e) => setPvId(e.target.value)}>
              <option value="">Tutti</option>
              {pvs.map((pv) => (
                <option key={pv.id} value={pv.id}>
                  {pv.code} - {pv.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Da</label>
            <input className="rounded-xl border p-3 w-full" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">A</label>
            <input className="rounded-xl border p-3 w-full" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" onClick={load} disabled={loading}>
              {loading ? "Carico..." : "Cerca"}
            </button>

            <button className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-60" onClick={reset} disabled={loading}>
              Reset
            </button>
          </div>

          <p className="text-sm text-gray-600">
            {rows.length} risultati {rows.length >= 500 ? "(limit 500)" : ""}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Data</th>
              <th className="text-left p-3">PV</th>
              <th className="text-left p-3">Tipo</th>
              <th className="text-left p-3">Periodo</th>
              <th className="text-left p-3">Utente</th>
              <th className="text-left p-3">Righe</th>
              <th className="text-left p-3">Azioni</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={7}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={7}>
                  Nessun riordino trovato con questi filtri.
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const isTAB = r.type === "TAB";
              const id = encodeURIComponent(r.id);

              const pvNorm = normPvLabel(String(r.pv_label || ""));
              const canPAT = isTAB && PV_PAT_ALLOWED_NORM.has(pvNorm);

              const isAdmin = meRole === "admin";

              const primary = [
                {
                  key: "view",
                  node: (
                    <button
                      className="inline-flex items-center rounded-xl bg-slate-900 text-white px-3 py-2 hover:bg-slate-800"
                      onClick={() => openPreview(r)}
                      title="Apri anteprima"
                    >
                      View
                    </button>
                  ),
                },
                {
                  key: "excel",
                  node: renderActionLink(
                    "inline-flex items-center rounded-xl bg-orange-500 text-white px-3 py-2 hover:bg-orange-600",
                    `/api/reorder/history/${id}/excel`,
                    "Excel"
                  ),
                },
                {
                  key: "u88",
                  node: renderActionLink(
                    `inline-flex items-center rounded-xl px-3 py-2 ${
                      isTAB ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-200 text-gray-500 pointer-events-none"
                    }`,
                    isTAB ? `/api/reorder/history/${id}/u88` : "#",
                    "U88",
                    isTAB ? "Scarica U88 compilato" : "U88 disponibile solo per TAB"
                  ),
                },
                ...(canPAT
                  ? [
                      {
                        key: "pat",
                        node: renderActionLink(
                          "inline-flex items-center rounded-xl px-3 py-2 bg-violet-600 text-white hover:bg-violet-700",
                          `/api/reorder/history/${id}/pat`,
                          "PAT",
                          "Scarica PAT"
                        ),
                      },
                    ]
                  : []),
              ];

              const secondaryBase = [
                {
                  key: "logtab",
                  node: renderActionLink(
                    `inline-flex items-center rounded-xl px-3 py-2 ${
                      isTAB ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-gray-200 text-gray-500 pointer-events-none"
                    }`,
                    isTAB ? `/api/reorder/history/${id}/order-tab` : "#",
                    "Log",
                    isTAB ? "Scarica Order Tab compilato" : "Order Tab disponibile solo per TAB"
                  ),
                },
                {
                  key: "logcar",
                  node: renderActionLink(
                    `inline-flex items-center rounded-xl px-3 py-2 ${
                      isTAB ? "bg-emerald-700 text-white hover:bg-emerald-800" : "bg-gray-200 text-gray-500 pointer-events-none"
                    }`,
                    isTAB ? `/api/reorder/history/${id}/log-car` : "#",
                    "LOG CAR",
                    isTAB ? "Scarica LOG CAR" : "LOG CAR disponibile solo per TAB"
                  ),
                },
                ...(isAdmin
                  ? [
                      {
                        key: "json",
                        node: renderActionLink(
                          "inline-flex items-center rounded-xl bg-slate-700 text-white px-3 py-2 hover:bg-slate-800",
                          `/api/reorder/history/${id}/log`,
                          "Json"
                        ),
                      },
                    ]
                  : []),
              ];

              const secondaryVisible = secondaryBase.slice(0, 3);
              const secondaryOverflow = secondaryBase.slice(3);
              const menuOpen = openMenuId === r.id;

              return (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{fmtDate(r.created_at)}</td>
                  <td className="p-3">{r.pv_label || "-"}</td>
                  <td className="p-3 font-medium">{r.type}</td>
                  <td className="p-3">{periodoLabel(r)}</td>
                  <td className="p-3">{r.created_by_username || "-"}</td>
                  <td className="p-3">{r.tot_rows ?? "-"}</td>

                  <td className="p-3">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        {primary.map((a) => (
                          <span key={a.key}>{a.node}</span>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2 items-center">
                        {secondaryVisible.map((a) => (
                          <span key={a.key}>{a.node}</span>
                        ))}

                        {secondaryOverflow.length > 0 && (
                          <div className="relative">
                            <button
                              className="inline-flex items-center rounded-xl border px-3 py-2 hover:bg-gray-50"
                              onClick={() => setOpenMenuId(menuOpen ? null : r.id)}
                              title="Altro"
                            >
                              ...
                            </button>

                            {menuOpen && (
                              <div className="absolute right-0 mt-2 w-44 rounded-xl border bg-white shadow-lg p-2 z-20">
                                <div className="flex flex-col gap-2">
                                  {secondaryOverflow.map((a) => (
                                    <span key={a.key} onClick={() => setOpenMenuId(null)}>
                                      {a.node}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ✅ MODAL PREVIEW con scrolling + totali completi (DB) */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closePreview} />

          <div className="relative w-full max-w-6xl rounded-2xl bg-white shadow-lg border">
            <div className="p-4 border-b flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Anteprima ordine</div>
                {previewMeta && (
                  <div className="text-sm text-gray-600 mt-1">
                    {previewMeta.type} — {previewMeta.pv_label || "—"} —{" "}
                    {previewMeta.days ? `${previewMeta.days} giorno/i` : `${previewMeta.weeks ?? "-"} sett.`}
                  </div>
                )}
              </div>

              <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={closePreview}>
                Chiudi
              </button>
            </div>

            <div className="p-4 space-y-4">
              {previewLoading && <div className="text-sm text-gray-500">Carico anteprima...</div>}
              {previewError && <div className="text-sm text-red-600">{previewError}</div>}

              {!previewLoading && !previewError && previewMeta && (
                <>
                  {/* ✅ Totali COMPLETI dal DB */}
                  <div className="rounded-2xl border bg-white p-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="font-semibold">Totali</div>
                      <div className="text-xs text-gray-500">
                        Fonte Totali: <b>{totalsSourceLabel}</b>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
                      <div className="rounded-xl border p-3">
                        <div className="text-gray-500">Righe ordine</div>
                        <div className="font-semibold">{previewMeta.tot_rows ?? "—"}</div>
                      </div>
                      <div className="rounded-xl border p-3">
                        <div className="text-gray-500">Tot. Qtà Ordine</div>
                        <div className="font-semibold">{Math.trunc(n0(previewMeta.tot_order_qty))}</div>
                      </div>
                      <div className="rounded-xl border p-3">
                        <div className="text-gray-500">Tot. Peso (kg)</div>
                        <div className="font-semibold">{kg1(previewMeta.tot_weight_kg)}</div>
                      </div>
                      <div className="rounded-xl border p-3">
                        <div className="text-gray-500">Tot. Valore (€)</div>
                        <div className="font-semibold">{eur(previewMeta.tot_value_eur)}</div>
                      </div>
                    </div>
                  </div>

                  {/* ✅ Tabella ORDINE COMPLETO per articolo (se presente) */}
                  {totalsByItem.length > 0 && (
                    <div className="rounded-2xl border overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                        <div className="font-semibold text-sm">Totali per articolo (ordine completo)</div>
                        <div className="text-xs text-gray-500">
                          Righe: <b>{totalsByItem.length}</b>
                        </div>
                      </div>

                      <div className="max-h-[40vh] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              {Object.keys(totalsByItem[0] || {}).map((k) => (
                                <th key={k} className="text-left p-3 whitespace-nowrap">
                                  {prettyCol(k)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {totalsByItem.map((row, i) => (
                              <tr key={i} className="border-t">
                                {Object.keys(totalsByItem[0] || {}).map((k) => (
                                  <td key={k} className="p-3 whitespace-nowrap">
                                    {formatCell(k, row?.[k])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ✅ Preview (dettaglio righe) */}
                  <div className="rounded-2xl border overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                      <div className="font-semibold text-sm">Dettaglio righe (preview)</div>
                      <div className="text-xs text-gray-500">
                        Righe preview: <b>{previewMeta.preview_count ?? previewRows.length}</b>
                      </div>
                    </div>

                    <div className="max-h-[50vh] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            {previewColumns.map((c) => (
                              <th key={c} className="text-left p-3 whitespace-nowrap">
                                {prettyCol(c)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, i) => (
                            <tr key={i} className="border-t">
                              {previewColumns.map((c) => (
                                <td key={c} className="p-3 whitespace-nowrap">
                                  {formatCell(c, row?.[c])}
                                </td>
                              ))}
                            </tr>
                          ))}

                          {previewRows.length === 0 && (
                            <tr className="border-t">
                              <td className="p-3 text-gray-500" colSpan={Math.max(1, previewColumns.length)}>
                                Nessuna riga in anteprima.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500">
                    Nota: il dettaglio righe è una preview (max 200). I totali sono letti dal DB (ordine completo) quando disponibili.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}















