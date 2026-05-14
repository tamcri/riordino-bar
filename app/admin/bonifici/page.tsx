"use client";

import { useState } from "react";

export default function AdminBonificiPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!file) {
      setError("Seleziona un file XML prima di procedere.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);

    try {
      const res = await fetch("/api/admin/bonifici/xml-ricevute", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Errore durante la generazione delle ricevute.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "ricevute-bonifici.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Errore imprevisto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Ricevute bonifici</h1>

      <p>
        Carica il file XML della ricevuta bonifico massivo per generare uno ZIP
        con una ricevuta PDF per ogni dipendente.
      </p>

      <form onSubmit={handleSubmit}>
        <div style={{ marginTop: 24, marginBottom: 16 }}>
          <input
            type="file"
            accept=".xml,.txt,text/xml,application/xml,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {error ? (
          <p style={{ color: "red", marginBottom: 16 }}>
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={loading}>
          {loading ? "Generazione in corso..." : "Genera ZIP ricevute"}
        </button>
      </form>
    </main>
  );
}