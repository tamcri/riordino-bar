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
  qtaVenduta: number;
  valoreVenduto: number;

  // ✅ NEW
  giacenzaBarQty: number;

  valoreGiacenzaBar: number;
  qtaDaOrdinare: number;
  valoreDaOrdinare: number;
};

type PV = { id: string; code: string; name: string };

export default function OrderGVClient() {
  const [file, setFile] = useState<File | null>(null);

  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRowGV[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

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
        // niente
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  function onPickFile(f: File | null) {
    setError(null);
    setDownloadUrl(null);
    setPreview([]);
    setTotalRows(0);

    if (!f) {
      setFile(null);
      return;
    }

    const name = (f.name || "").toLowerCase();
    if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) {
      setFile(null);
      setError("Formato non valido: carica un file .xls o .xlsx");
      return;
    }

    setFile(f);
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

      const res = await fetch("/api/reorder/gv/start", { method: "POST", body: fd });
      const text = await res.text();
      let json: any = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // non JSON
      }

      if (!res.ok || !json?.ok) {
        const msg = json?.error || `Errore server (${res.status}). Risposta: ${text?.slice(0, 160) || "vuota"}`;
        throw new Error(msg);
      }

      setDownloadUrl(json.downloadUrl || null);
      setPreview(json.preview || []);
      setTotalRows(json.totalRows || 0);
    } catch (err: any) {
      setError(err?.message || "Errore");
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
        <h1 className="text-2xl font-semibold text-slate-900">Order G&amp;V</h1>
        <p className="text-slate-600 mt-1">
          Seleziona il Punto vendita, carica l’Excel (.xls/.xlsx), genera l’anteprima e scarica l’output.
        </p>
      </div>

      <form onSubmit={startProcess} className="space-y-4">
        <div className="rounded-2xl border bg-white p-4 space-y-4">
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
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">File Excel G&amp;V (.xls / .xlsx)</label>
            <input
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
            />
            {file && (
              <p className="text-sm text-gray-600 mt-2">
                Selezionato: <b>{file.name}</b>
              </p>
            )}
          </div>
        </div>

        <button
          className="w-full rounded-xl bg-orange-500 text-white p-3 hover:bg-orange-600 disabled:opacity-60"
          disabled={!file || loading || !pvId}
        >
          {loading ? "Elaborazione..." : "Genera anteprima"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {downloadUrl && (
        <div className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <p className="text-gray-700">
              Righe elaborate: <b>{totalRows}</b> (mostro le prime 20)
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
                  <th className="text-left p-3">Valore Venduto</th>
                  <th className="text-left p-3">Giacenza Bar</th>
                  <th className="text-left p-3">Valore Giacenza Bar</th>
                  <th className="text-left p-3">QTA DA ORDINARE</th>
                  <th className="text-left p-3">VALORE DA ORDINARE</th>
                </tr>
              </thead>

              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-3">{r.codArticolo}</td>
                    <td className="p-3">{r.descrizione}</td>
                    <td className="p-3">{n0(r.qtaVenduta)}</td>
                    <td className="p-3">{eur(r.valoreVenduto)}</td>
                    <td className="p-3">{n0(r.giacenzaBarQty)}</td>
                    <td className="p-3">{eur(r.valoreGiacenzaBar)}</td>
                    <td className="p-3 font-medium">{n0(r.qtaDaOrdinare)}</td>
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
