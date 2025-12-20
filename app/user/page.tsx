"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PreviewRow = {
  codArticolo: string;
  descrizione: string;
  qtaVenduta: number;
  giacenza: number;
  qtaOrdine: number;
  pesoKg: number;
};

export default function UserPage() {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [weeks, setWeeks] = useState<number>(4); // ✅ default: 4 settimane

  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const weeksLabel = useMemo(() => {
    if (weeks === 1) return "1 settimana";
    return `${weeks} settimane`;
  }, [weeks]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function startProcess(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setJobId(null);
    setPreview([]);
    setTotalRows(0);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("weeks", String(weeks)); // ✅ invio il periodo selezionato

      const res = await fetch("/api/reorder/start", {
        method: "POST",
        body: fd,
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Errore");

      setJobId(json.jobId);
      setPreview(json.preview || []);
      setTotalRows(json.totalRows || 0);
    } catch (err: any) {
      setError(err.message || "Errore");
    } finally {
      setLoading(false);
    }
  }

  function downloadExcel() {
    if (!jobId) return;

    // ✅ passo weeks anche qui (utile se la route excel lo usa, o per coerenza)
    const url = `/api/reorder/excel?jobId=${encodeURIComponent(jobId)}&weeks=${encodeURIComponent(
      String(weeks)
    )}`;
    window.location.href = url;
  }

  return (
    <main className="p-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Calcolo Riordino</h1>
          <p className="text-gray-600 mt-1">
            Carica l’Excel, scegli il periodo, controlla l’anteprima, poi scarica il file compilato in
            Excel.
          </p>
        </div>
        <button onClick={logout} className="rounded-xl border px-4 py-2 hover:bg-gray-50">
          Logout
        </button>
      </div>

      <form onSubmit={startProcess} className="mt-6 space-y-4">
        <div className="rounded-2xl border p-4 space-y-4">
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

          {/* ✅ Dropdown settimane */}
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

            <span className="text-sm text-gray-600">
              Selezionato: <b>{weeksLabel}</b>
            </span>
          </div>
        </div>

        <button
          className="w-full rounded-xl bg-black text-white p-3 disabled:opacity-60"
          disabled={!file || loading}
        >
          {loading ? "Elaborazione..." : "Genera anteprima"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {jobId && (
        <div className="mt-6 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <p className="text-gray-700">
              Anteprima pronta ({weeksLabel}). Righe elaborate: <b>{totalRows}</b> (mostro le prime 20)
            </p>
            <button onClick={downloadExcel} className="rounded-xl bg-black text-white px-4 py-2">
              Scarica Excel
            </button>
          </div>

          <div className="overflow-auto rounded-2xl border">
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
                    <td className="p-3">{r.pesoKg.toFixed(1)}</td>
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
    </main>
  );
}




