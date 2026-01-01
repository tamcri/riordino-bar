"use client";

import { useEffect, useState } from "react";

function n0(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function eur(v: any): string {
  return `€ ${n0(v).toFixed(2)}`;
}

type PreviewRowGV = {
  codArticolo: string;
  descrizione: string;
  qtaVenduta: number | null;
  valoreVenduto: number | null;
  giacenzaBar: number | null;
  qtaOrdineBar: number | null;
  qtaConf: number | null;
  valoreDaOrdinare: number | null;
};

type PV = {
  id: string;
  code: string;
  name: string;
};

export default function OrderGVClient() {
  const [file, setFile] = useState<File | null>(null);

  // ✅ NEW: giorni liberi (1..21)
  const [days, setDays] = useState<number>(7);

  // ✅ PV
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRowGV[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // ✅ carica PV al mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/pvs/list");
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) return;

        const rows: PV[] = json.rows || [];
        setPvs(rows);

        if (!pvId && rows.length > 0) setPvId(rows[0].id);
      } catch {
        // silenzioso
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  function clampDays(v: number) {
    if (!Number.isFinite(v)) return 7;
    const n = Math.trunc(v);
    if (n < 1) return 1;
    if (n > 21) return 21;
    return n;
  }

  async function startProcess(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setDownloadUrl(null);
    setPreview([]);
    setTotalRows(0);

    try {
      if (!pvId) throw new Error("Seleziona un Punto vendita");

      const fd = new FormData();
      fd.append("file", file);
      fd.append("pvId", pvId);

      // ✅ NEW: days
      fd.append("days", String(clampDays(days)));

      const res = await fetch("/api/reorder/gv/start", { method: "POST", body: fd });
      const text = await res.text();
      let json: any = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // non è JSON
      }

      if (!res.ok || !json?.ok) {
        const msg =
          json?.error ||
          `Errore server (${res.status}). Risposta non-JSON: ${text?.slice(0, 120) || "vuota"}`;
        throw new Error(msg);
      }

      setDownloadUrl(json.downloadUrl || null);
      setPreview(json.preview || []);
      setTotalRows(json.totalRows || 0);

      // se il server ritorna days, riallineo (evita valori fuori range)
      if (typeof json.days === "number") setDays(clampDays(json.days));
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
        <h1 className="text-2xl font-semibold text-slate-900">Calcolo Riordino Gratta &amp; Vinci</h1>
        <p className="text-slate-600 mt-1">
          Seleziona il Punto vendita, carica l’Excel G&amp;V, imposta i giorni di copertura, controlla l’anteprima,
          poi scarica il file compilato.
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
            <label className="block text-sm font-medium mb-2">File Excel G&amp;V (.xlsx)</label>
            <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            {file && (
              <p className="text-sm text-gray-600 mt-2">
                Selezionato: <b>{file.name}</b>
              </p>
            )}
          </div>

          {/* ✅ NEW: giorni liberi */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="block text-sm font-medium min-w-[180px]">Periodo di calcolo (giorni)</label>

            <input
              type="number"
              min={1}
              max={21}
              step={1}
              className="rounded-xl border p-3 w-full sm:w-[260px]"
              value={days}
              onChange={(e) => setDays(clampDays(Number(e.target.value)))}
            />
          </div>

          <p className="text-xs text-gray-500">
            Nota: per G&amp;V consideriamo anche <b>+1 giorno</b> di consegna (ordine entro le 11, arriva il giorno dopo).
          </p>
        </div>

        <button
          className="w-full rounded-xl bg-orange-500 text-white p-3 hover:bg-orange-600 disabled:opacity-60"
          disabled={!file || loading || !pvId}
          title={!pvId ? "Seleziona un Punto vendita" : undefined}
        >
          {loading ? "Elaborazione..." : "Genera anteprima"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {downloadUrl && (
        <div className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <p className="text-gray-700">
              Anteprima pronta. Righe elaborate: <b>{totalRows}</b> (mostro le prime 20)
            </p>
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
                  <th className="text-left p-3">Valore Venduto (€)</th>
                  <th className="text-left p-3">Giacenza BAR</th>
                  <th className="text-left p-3">Qtà da ordinare BAR</th>
                  <th className="text-left p-3">Qtà Conf.</th>
                  <th className="text-left p-3">Valore da ordinare (€)</th>
                </tr>
              </thead>

              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-3">{r.codArticolo || ""}</td>
                    <td className="p-3">{r.descrizione || ""}</td>
                    <td className="p-3">{n0(r.qtaVenduta)}</td>
                    <td className="p-3">{eur(r.valoreVenduto)}</td>
                    <td className="p-3">{n0(r.giacenzaBar)}</td>
                    <td className="p-3 font-medium">{n0(r.qtaOrdineBar)}</td>
                    <td className="p-3">{n0(r.qtaConf)}</td>
                    <td className="p-3 font-medium">{eur(r.valoreDaOrdinare)}</td>
                  </tr>
                ))}

                {preview.length === 0 && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-500" colSpan={8}>
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
