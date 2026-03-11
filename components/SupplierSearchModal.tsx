"use client";

import { useEffect, useRef, useState } from "react";

type Supplier = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
};

export default function SupplierSearchModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (supplier: Supplier) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  const requestIdRef = useRef(0);

  async function runSearch(q: string, requestId: number) {
    setLoading(true);

    try {
      const res = await fetch(`/api/suppliers/search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (requestId !== requestIdRef.current) return;

      if (!res.ok || !json?.rows) {
        setResults([]);
        return;
      }

      const activeOnly = (Array.isArray(json.rows) ? json.rows : []).filter(
        (r: Supplier) => r.is_active !== false
      );

      setResults(activeOnly);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setResults([]);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!open) return;

    const q = search.trim();
    setTouched(true);

    if (q.length < 2) {
      requestIdRef.current += 1;
      setResults([]);
      setLoading(false);
      return;
    }

    const nextId = requestIdRef.current + 1;
    requestIdRef.current = nextId;

    const timer = setTimeout(() => {
      runSearch(q, nextId);
    }, 300);

    return () => clearTimeout(timer);
  }, [search, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white p-6 rounded-xl w-full max-w-md space-y-4">
        <h3 className="font-semibold text-lg">Ricerca Fornitore</h3>

        <input
          placeholder="Cerca per codice o nome..."
          className="border p-2 w-full rounded-lg"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {search.trim().length > 0 && search.trim().length < 2 && (
          <div className="text-xs text-slate-500">
            Scrivi almeno 2 caratteri.
          </div>
        )}

        {loading && (
          <div className="border rounded p-2 text-sm text-slate-500 bg-slate-50">
            Ricerca fornitori...
          </div>
        )}

        {!loading &&
          touched &&
          search.trim().length >= 2 &&
          results.length > 0 && (
            <div className="border rounded max-h-40 overflow-y-auto">
              {results.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="w-full text-left p-2 hover:bg-gray-100 text-sm border-b last:border-b-0"
                  onClick={() => {
                    onSelect(s);
                    setSearch("");
                    setResults([]);
                    onClose();
                  }}
                >
                  {s.code} — {s.name}
                </button>
              ))}
            </div>
          )}

        {!loading &&
          touched &&
          search.trim().length >= 2 &&
          results.length === 0 && (
            <div className="border rounded p-2 text-sm text-slate-500 bg-slate-50">
              Nessun fornitore trovato.
            </div>
          )}

        <div className="flex justify-end">
          <button
            onClick={() => {
              setSearch("");
              setResults([]);
              onClose();
            }}
            className="px-4 py-2 border rounded"
            type="button"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}