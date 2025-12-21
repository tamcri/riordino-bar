"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  category: "TAB" | "GV";
  code: string;
  description: string;
  is_active: boolean;
};

export default function ItemsClient({ isAdmin }: { isAdmin: boolean }) {
  const [category, setCategory] = useState<"TAB" | "GV">("TAB");
  const [active, setActive] = useState<"1" | "0" | "all">("1");
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // import
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("category", category);
    p.set("active", active);
    if (q.trim()) p.set("q", q.trim());
    return `?${p.toString()}`;
  }, [category, active, q]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/list${qs}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento");
      setRows(json.rows || []);
    } catch (e: any) {
      setError(e.message || "Errore");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  async function doImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setImporting(true);
    setMsg(null);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("category", category);
      fd.append("file", file);

      const res = await fetch("/api/items/import", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Import fallito");

      setMsg(`Import OK (${category}) — Tot: ${json.total}, Inseriti: ${json.inserted}, Aggiornati: ${json.updated}`);
      setFile(null);
      await load();
    } catch (e: any) {
      setError(e.message || "Errore import");
    } finally {
      setImporting(false);
    }
  }

  async function toggleActive(item: Item) {
    if (!isAdmin) return;

    const ok = confirm(`Vuoi ${item.is_active ? "disattivare" : "attivare"} ${item.code}?`);
    if (!ok) return;

    const res = await fetch("/api/items/update", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, is_active: !item.is_active }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      alert(json?.error || "Errore aggiornamento");
      return;
    }
    load();
  }

  async function editDescription(item: Item) {
    if (!isAdmin) return;

    const next = prompt(`Modifica descrizione per ${item.code}`, item.description);
    if (next === null) return;

    const res = await fetch("/api/items/update", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, description: next }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      alert(json?.error || "Errore aggiornamento");
      return;
    }
    load();
  }

  return (
    <div className="space-y-4">
      {/* filtri */}
      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">Categoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={category} onChange={(e) => setCategory(e.target.value as any)}>
            <option value="TAB">TAB</option>
            <option value="GV">GV</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Stato</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={active} onChange={(e) => setActive(e.target.value as any)}>
            <option value="1">Attivi</option>
            <option value="0">Disattivi</option>
            <option value="all">Tutti</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-2">Cerca</label>
          <input className="w-full rounded-xl border p-3" placeholder="Codice o descrizione..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {/* import (solo admin) */}
      {isAdmin && (
        <form onSubmit={doImport} className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Import articoli (Excel)</div>
              <div className="text-sm text-gray-600">
                Supporta Excel pulito (colonne Codice/Descrizione) e gestionale (auto-detect; TAB ha fallback robusto).
              </div>
            </div>
            <button
              className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
              disabled={!file || importing}
            >
              {importing ? "Importo..." : "Importa"}
            </button>
          </div>

          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file && <div className="text-sm text-gray-600">Selezionato: <b>{file.name}</b></div>}
        </form>
      )}

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* tabella */}
      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Codice</th>
              <th className="text-left p-3">Descrizione</th>
              <th className="text-left p-3">Attivo</th>
              <th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={4}>Caricamento...</td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={4}>Nessun articolo trovato.</td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.code}</td>
                <td className="p-3">{r.description}</td>
                <td className="p-3">{r.is_active ? "SI" : "NO"}</td>
                <td className="p-3">
                  {isAdmin ? (
                    <div className="flex gap-2">
                      <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={() => editDescription(r)}>
                        Modifica
                      </button>
                      <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={() => toggleActive(r)}>
                        {r.is_active ? "Disattiva" : "Attiva"}
                      </button>
                    </div>
                  ) : (
                    <span className="text-gray-400">Solo admin</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
