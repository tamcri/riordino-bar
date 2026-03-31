"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type ParsedRow = {
  riga: string;
  codice: string;
  quantita: string;
};

type ApiSuccessResponse = {
  ok: true;
  rows: ParsedRow[];
  count: number;
  debugTokens?: string[];
  debugRowsPreview?: ParsedRow[];
};

type ApiErrorResponse = {
  ok: false;
  error: string;
};

type ApiResponse = ApiSuccessResponse | ApiErrorResponse;

export default function AdminLogistaExcelPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);

  const selectedFileInfo = useMemo(() => {
    if (!selectedFile) return null;

    const sizeKb = selectedFile.size / 1024;
    const formattedSize =
      sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(2)} MB` : `${sizeKb.toFixed(2)} KB`;

    return {
      name: selectedFile.name,
      type: selectedFile.type || "non disponibile",
      size: formattedSize,
    };
  }, [selectedFile]);

  function resetMessages() {
    setMsg(null);
    setErrorMsg(null);
  }

  function resetResults() {
    setRows([]);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    resetMessages();
    resetResults();

    const file = e.target.files?.[0] ?? null;

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isPdfMime = file.type === "application/pdf";
    const isPdfName = lowerName.endsWith(".pdf");

    if (!isPdfMime && !isPdfName) {
      setSelectedFile(null);
      setErrorMsg("Seleziona un file PDF valido.");
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetMessages();
    resetResults();

    if (!selectedFile) {
      setErrorMsg("Seleziona prima un file PDF.");
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/admin/logista-excel", {
        method: "POST",
        body: formData,
      });

      const json = (await res.json().catch(() => null)) as ApiResponse | null;

      if (!res.ok || !json) {
        setErrorMsg("Errore durante l'invio del PDF.");
        return;
      }

      if (!json.ok) {
        setErrorMsg(json.error || "Errore durante l'elaborazione del PDF.");
        return;
      }

      setRows(Array.isArray(json.rows) ? json.rows : []);
      setMsg(`PDF elaborato correttamente. Righe trovate: ${json.count}`);
    } catch {
      setErrorMsg("Errore di rete o server non raggiungibile.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadExcel() {
    resetMessages();

    if (!selectedFile) {
      setErrorMsg("Seleziona prima un file PDF.");
      return;
    }

    setExcelLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/admin/logista-excel/export", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setErrorMsg(json?.error || "Errore durante la generazione dell'Excel.");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const contentDisposition = res.headers.get("content-disposition");
      const match = contentDisposition?.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || "logista_excel.xlsx";

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();

      window.URL.revokeObjectURL(url);
      setMsg("Download Excel avviato.");
    } catch {
      setErrorMsg("Errore di rete o server non raggiungibile.");
    } finally {
      setExcelLoading(false);
    }
  }

  const hasRows = rows.length > 0;

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">LOGISTA EXCEL</h1>
            <p className="text-gray-600 mt-1">
              Funzione dedicata per caricare un PDF Logista, verificare l&apos;estrazione e scaricare
              l&apos;Excel con intestazioni: Riga, Cod. AAMS, Quantità(Kgc).
            </p>
          </div>

          <Link href="/admin" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
            Torna ad Admin
          </Link>
        </div>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Caricamento PDF Logista</h2>
          <p className="text-sm text-gray-600 mt-2">
            Prima analizzi il PDF, poi scarichi l&apos;Excel solo dopo aver verificato l&apos;anteprima.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Seleziona file PDF</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
                className="block w-full rounded-xl border bg-white p-3 text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white"
              />
              <p className="text-xs text-gray-500 mt-2">File ammesso: PDF standard Logista.</p>
            </div>

            {selectedFileInfo && (
              <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-700 space-y-1">
                <div>
                  <span className="font-medium">Nome file:</span> {selectedFileInfo.name}
                </div>
                <div>
                  <span className="font-medium">Tipo:</span> {selectedFileInfo.type}
                </div>
                <div>
                  <span className="font-medium">Dimensione:</span> {selectedFileInfo.size}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading || excelLoading}
                className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
              >
                {loading ? "Elaborazione in corso..." : "Analizza PDF"}
              </button>

              <button
                type="button"
                disabled={!hasRows || excelLoading || loading}
                onClick={handleDownloadExcel}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {excelLoading ? "Genero Excel..." : "Scarica Excel"}
              </button>

              <button
                type="button"
                disabled={loading || excelLoading}
                onClick={() => {
                  setSelectedFile(null);
                  resetMessages();
                  resetResults();
                }}
                className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
              >
                Reset
              </button>
            </div>

            {msg && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                {msg}
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {errorMsg}
              </div>
            )}
          </form>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Anteprima righe estratte</h2>
              <p className="text-sm text-gray-600 mt-1">
                L&apos;Excel conterrà esattamente queste tre colonne: Riga, Cod. AAMS, Quantità(Kgc).
              </p>
            </div>

            <div className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700">
              Righe: <span className="font-semibold">{rows.length}</span>
            </div>
          </div>

          {!hasRows ? (
            <div className="mt-4 rounded-xl border border-dashed bg-gray-50 p-4 text-sm text-gray-600">
              Nessuna riga da mostrare. Carica un PDF e avvia l&apos;analisi per vedere l&apos;anteprima.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="border-b px-4 py-3 text-left font-medium text-gray-700">Riga</th>
                    <th className="border-b px-4 py-3 text-left font-medium text-gray-700">Cod. AAMS</th>
                    <th className="border-b px-4 py-3 text-left font-medium text-gray-700">Quantità(Kgc)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.riga}-${row.codice}-${index}`} className="odd:bg-white even:bg-gray-50">
                      <td className="border-b px-4 py-3 text-gray-800">{row.riga}</td>
                      <td className="border-b px-4 py-3 text-gray-800">{row.codice}</td>
                      <td className="border-b px-4 py-3 text-gray-800">{row.quantita}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Stato funzione</h2>
          <div className="mt-3 rounded-xl border border-dashed p-4 bg-gray-50">
            <p className="text-sm text-gray-700">
              Flusso finale attivo: analisi PDF con anteprima e download Excel con intestazioni
              Riga, Cod. AAMS, Quantità(Kgc).
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}