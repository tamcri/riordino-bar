"use client";

import { useEffect, useMemo, useState } from "react";

type PreviewRow = {
  codArticolo: string;
  descrizione: string;
  qtaVenduta: number;
  giacenza: number;
  qtaOrdine: number;
  valoreDaOrdinare?: number; // ✅ NEW (opzionale per compatibilità)
  pesoKg: number;
};

type PV = {
  id: string;
  code: string;
  name: string;
};

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function n0(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function eur(v: any): string {
  return `€ ${n0(v).toFixed(2)}`;
}

export default function OrderTabPage() {
  const [file, setFile] = useState<File | null>(null);

  // ✅ settimane (fallback)
  const [weeks, setWeeks] = useState<number>(4);

  // ✅ NEW: giorni (prioritario se valorizzato)
  // stringa per gestire bene input vuoto / parziale
  const [days, setDays] = useState<string>("");

  const daysInt = useMemo(() => {
    const t = days.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return clampInt(n, 1, 21);
  }, [days]);

  const usingDays = daysInt != null;

  // ✅ PV
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // per UI: cosa è stato usato davvero dal server
  const [periodLabel, setPeriodLabel] = useState<string | null>(null);

  // ✅ carica PV al mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/pvs/list");
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) return;

        const rows: PV[] = json.rows || [];
        setPvs(rows);

        // seleziona il primo PV di default
        if (!pvId && rows.length > 0) setPvId(rows[0].id);
      } catch {
        // silenzioso
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  async function startProcess(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setDownloadUrl(null);
    setPreview([]);
    setTotalRows(0);
    setPeriodLabel(null);

    try {
      if (!pvId) throw new Error("Seleziona un Punto vendita");

      const fd = new FormData();
      fd.append("file", file);
      fd.append("pvId", pvId);

      // ✅ priorità: days → se valido lo invio
      if (daysInt != null) {
        fd.append("days", String(daysInt));
      } else {
        // ✅ fallback: weeks
        fd.append("weeks", String(weeks));
      }

      const res = await fetch("/api/reorder/start", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore");

      setDownloadUrl(json.downloadUrl || null);
      setPreview(json.preview || []);
      setTotalRows(json.totalRows || 0);

      // ✅ badge periodo usato (server ritorna days oppure null)
      if (json?.days) setPeriodLabel(`${json.days} giorno/i`);
      else if (json?.weeks) setPeriodLabel(`${json.weeks} settimana/e`);
      else setPeriodLabel(null);
    } catch (err: any) {
      setError(err.message || "Errore");
    } finally {
      setLoading(false);
    }
  }

  function downloadExcel() {
    if (!downloadUrl) return;
    window.location.href = downloadUrl;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Calcolo Riordino Tabacchi</h1>
        <p className="text-slate-600 mt-1">
          Seleziona il Punto vendita, carica l’Excel e scegli il periodo. Puoi usare settimane oppure
          inserire giorni (utile per 2 settimane e mezzo, festivi, ecc.).
        </p>
      </div>

      <form onSubmit={startProcess} className="space-y-4">
        <div className="rounded-2xl border bg-white p-4 space-y-4">
          {/* ✅ PV dropdown */}
          <div>
            <label className="block text-sm font-medium mb-2">Punto vendita</label>
            <select
              className="w-full rounded-xl border p-3 bg-white"
              value={pvId}
              onChange={(e) => setPvId(e.target.value)}
              disabled={pvs.length === 0}
            >
              {pvs.length === 0 ? (
                <option value="">Nessun PV disponibile (crealo in Admin)</option>
              ) : (
                pvs.map((pv) => (
                  <option key={pv.id} value={pv.id}>
                    {pv.code} - {pv.name}
                  </option>
                ))
              )}
            </select>
            {pvs.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">Vai in Admin → “Crea PV”, poi torna qui.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">File Excel (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file && (
              <p className="text-sm text-gray-600 mt-2">
                Selezionato: <b>{file.name}</b>
              </p>
            )}
          </div>

          {/* ✅ Periodo: Weeks + Days */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Weeks */}
            <div className="flex flex-col gap-2">
              <label className="block text-sm font-medium">Settimane (standard)</label>
              <select
                className="rounded-xl border p-3 w-full"
                value={weeks}
                onChange={(e) => setWeeks(Number(e.target.value))}
                disabled={usingDays}
                title={
                  usingDays
                    ? "Stai usando i Giorni: svuota Giorni per riabilitare le Settimane"
                    : undefined
                }
              >
                <option value={1}>1 Settimana</option>
                <option value={2}>2 Settimane</option>
                <option value={3}>3 Settimane</option>
                <option value={4}>4 Settimane</option>
              </select>
              <p className="text-xs text-gray-500">
                Usa questo se ragioni “a settimane”. Se compili Giorni, questo viene ignorato.
              </p>
            </div>

            {/* Days */}
            <div className="flex flex-col gap-2">
              <label className="block text-sm font-medium">Giorni (override)</label>
              <input
                className="rounded-xl border p-3 w-full"
                inputMode="numeric"
                placeholder="Es. 18 (max 21)"
                value={days}
                onChange={(e) => {
                  const v = e.target.value;
                  // accetta vuoto o cifre
                  if (v === "" || /^\d+$/.test(v)) setDays(v);
                }}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  Consigliato per periodi tipo “2 settimane e mezzo”, festivi, ecc.
                </p>
                {days.trim() !== "" && (
                  <button
                    type="button"
                    onClick={() => setDays("")}
                    className="text-xs underline text-slate-700 hover:text-slate-900"
                  >
                    Svuota
                  </button>
                )}
              </div>
              {days.trim() !== "" && daysInt == null && (
                <p className="text-xs text-red-600">Inserisci un numero valido (1..21).</p>
              )}
              {daysInt != null && (
                <p className="text-xs text-green-700">
                  Periodo giorni attivo: <b>{daysInt}</b>
                </p>
              )}
            </div>
          </div>
        </div>

        <button
          className="w-full rounded-xl bg-blue-600 text-white p-3 hover:bg-blue-700 disabled:opacity-60"
          disabled={!file || loading || !pvId || (days.trim() !== "" && daysInt == null)}
          title={!pvId ? "Seleziona un Punto vendita" : undefined}
        >
          {loading ? "Elaborazione..." : "Genera anteprima"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {downloadUrl && (
        <div className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="space-y-1">
              <p className="text-gray-700">
                Anteprima pronta. Righe elaborate: <b>{totalRows}</b> (mostro le prime 20)
              </p>
              {periodLabel && (
                <p className="text-xs text-gray-500">
                  Periodo usato: <b>{periodLabel}</b>
                </p>
              )}
            </div>

            <button onClick={downloadExcel} className="rounded-xl bg-slate-900 text-white px-4 py-2">
              Scarica Excel
            </button>
          </div>

          <div className="overflow-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3">Cod. Articolo</th>
                  <th className="text-left p-3">Descrizione</th>
                  <th className="text-left p-3">Qtà Venduta</th>
                  <th className="text-left p-3">Giacenza</th>
                  <th className="text-left p-3">Qtà da ordinare</th>
                  {/* ✅ NEW colonna qui */}
                  <th className="text-left p-3">Valore da ordinare</th>
                  <th className="text-left p-3">Qtà in peso (kg)</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-3">{r.codArticolo}</td>
                    <td className="p-3">{r.descrizione}</td>
                    <td className="p-3">{r.qtaVenduta}</td>
                    <td className="p-3">{r.giacenza}</td>
                    <td className="p-3 font-medium">{r.qtaOrdine}</td>
                    {/* ✅ NEW valore */}
                    <td className="p-3 font-medium">{eur(r.valoreDaOrdinare)}</td>
                    <td className="p-3">{Number(r.pesoKg || 0).toFixed(1)}</td>
                  </tr>
                ))}

                {preview.length === 0 && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-500" colSpan={7}>
                      Nessuna riga da mostrare
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}




