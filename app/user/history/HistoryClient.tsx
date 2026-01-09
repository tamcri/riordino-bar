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

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("it-IT");
}

function normPvLabel(s: string) {
  return (s || "")
    .toUpperCase()
    .trim()
    .replace(/[-–—]/g, " ") // trattini diversi -> spazio
    .replace(/[^\w\s]/g, " ") // via punteggiatura
    .replace(/\s+/g, " "); // spazi multipli -> singolo
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

export default function HistoryClient() {
  const [typeFilter, setTypeFilter] = useState<"ALL" | "TAB" | "GV">("ALL");
  const [pvId, setPvId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [pvs, setPvs] = useState<PV[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/pvs/list");
        const json = await res.json().catch(() => null);
        if (res.ok && json?.ok) setPvs(json.rows || []);
      } catch {
        // ignore
      }
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
      const res = await fetch(`/api/reorder/history/list${qs}`);
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

  function periodoLabel(r: Row) {
    const d = Number(r.days);
    if (Number.isFinite(d) && d > 0) return `${d} giorno/i`;
    return `${r.weeks} sett.`;
  }

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
            <select
              className="rounded-xl border p-3 w-full bg-white"
              value={pvId}
              onChange={(e) => setPvId(e.target.value)}
            >
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
            <input
              className="rounded-xl border p-3 w-full"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">A</label>
            <input
              className="rounded-xl border p-3 w-full"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <button
              className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Carico..." : "Cerca"}
            </button>

            <button
              className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
              onClick={reset}
              disabled={loading}
            >
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

              return (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{fmtDate(r.created_at)}</td>
                  <td className="p-3">{r.pv_label || "-"}</td>
                  <td className="p-3 font-medium">{r.type}</td>
                  <td className="p-3">{periodoLabel(r)}</td>
                  <td className="p-3">{r.created_by_username || "-"}</td>
                  <td className="p-3">{r.tot_rows ?? "-"}</td>

                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <a
                        className="inline-flex items-center rounded-xl bg-orange-500 text-white px-3 py-2 hover:bg-orange-600"
                        href={`/api/reorder/history/${id}/excel`}
                      >
                        Excel
                      </a>

                      <a
                        className={`inline-flex items-center rounded-xl px-3 py-2 ${
                          isTAB
                            ? "bg-blue-600 text-white hover:bg-blue-700"
                            : "bg-gray-200 text-gray-500 pointer-events-none"
                        }`}
                        href={isTAB ? `/api/reorder/history/${id}/u88` : undefined}
                        title={isTAB ? "Scarica U88 compilato" : "U88 disponibile solo per TAB"}
                      >
                        U88
                      </a>

                      {/* ✅ PAT: MOSTRATO SOLO quando ammesso */}
                      {canPAT && (
                        <a
                          className="inline-flex items-center rounded-xl px-3 py-2 bg-violet-600 text-white hover:bg-violet-700"
                          href={`/api/reorder/history/${id}/pat`}
                          title="Scarica PAT"
                        >
                          PAT
                        </a>
                      )}

                      <a
                        className={`inline-flex items-center rounded-xl px-3 py-2 ${
                          isTAB
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-gray-200 text-gray-500 pointer-events-none"
                        }`}
                        href={isTAB ? `/api/reorder/history/${id}/order-tab` : undefined}
                        title={isTAB ? "Scarica Order Tab compilato" : "Order Tab disponibile solo per TAB"}
                      >
                        Log
                      </a>

                      <a
                        className={`inline-flex items-center rounded-xl px-3 py-2 ${
                          isTAB
                            ? "bg-emerald-700 text-white hover:bg-emerald-800"
                            : "bg-gray-200 text-gray-500 pointer-events-none"
                        }`}
                        href={isTAB ? `/api/reorder/history/${id}/log-car` : undefined}
                        title={isTAB ? "Scarica LOG CAR" : "LOG CAR disponibile solo per TAB"}
                      >
                        LOG CAR
                      </a>

                      <a
                        className="inline-flex items-center rounded-xl bg-slate-700 text-white px-3 py-2 hover:bg-slate-800"
                        href={`/api/reorder/history/${id}/log`}
                      >
                        Json
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}





