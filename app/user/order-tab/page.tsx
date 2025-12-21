"use client";

import { useEffect, useState } from "react";

type PreviewRow = {
  codArticolo: string;
  descrizione: string;
  qtaVenduta: number;
  giacenza: number;
  qtaOrdine: number;
  pesoKg: number;
};

type PV = {
  id: string;
  code: string;
  name: string;
};

export default function OrderTabPage() {
  const [file, setFile] = useState<File | null>(null);
  const [weeks, setWeeks] = useState<number>(4);

  // ✅ PV
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
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

        // seleziona il primo PV di default
        if (!pvId && rows.length > 0) setPvId(rows[0].id);
      } catch {
        // silenzioso: se fallisce lo vediamo da UI
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

    try {
      if (!pvId) throw new Error("Seleziona un Punto vendita");

      const fd = new FormData();
      fd.append("file", file);
      fd.append("weeks", String(weeks));
      fd.append("pvId", pvId); // ✅ NEW

      const res = await fetch("/api/reorder/start", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore");

      setDownloadUrl(json.downloadUrl || null);
      setPreview(json.preview || []);
      setTotalRows(json.totalRows || 0);
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
          Seleziona il Punto vendita, carica l’Excel, scegli il periodo, controlla l’anteprima, poi
          scarica il file compilato.
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
              <p className="text-xs text-gray-500 mt-1">
                Vai in Admin → “Crea PV”, poi torna qui.
              </p>
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

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="block text-sm font-medium min-w-[180px]">Periodo di calcolo</label>
            <select
              className="rounded-xl border p-3 w-full sm:w-[260px]"
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
            >
              <option value={1}>1 Settimana</option>
              <option value={2}>2 Settimane</option>
              <option value={3}>3 Settimane</option>
              <option value={4}>4 Settimane</option>
            </select>
          </div>
        </div>

        <button
          className="w-full rounded-xl bg-blue-600 text-white p-3 hover:bg-blue-700 disabled:opacity-60"
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
                  <th className="text-left p-3">Giacenza</th>
                  <th className="text-left p-3">Qtà da ordinare</th>
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
                    <td className="p-3">{Number(r.pesoKg || 0).toFixed(1)}</td>
                  </tr>
                ))}

                {preview.length === 0 && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-500" colSpan={6}>
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


