"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Item = {
  id: string;
  code: string;
  description: string;
  barcode?: string | null;
  prezzo_vendita_eur?: number | null;
  um?: string | null;
  peso_kg?: number | null;
  volume_ml_per_unit?: number | null;
};

type MeResponse = {
  ok: boolean;
  role?: string;
  username?: string;
  pv_id?: string | null;
  pv_code?: string | null;
  pv_name?: string | null;
  error?: string;
};

type OrderRowDraft = {
  item: Item;
  qty_pz: string;
};

type OrderSaveRow = {
  item_id: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
};

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function safeInt(v: unknown) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function formatEUR(n: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(n || 0);
}

async function fetchJsonSafe<T = any>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; data: T; status: number; rawText: string }> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const status = res.status;
  const rawText = await res.text().catch(() => "");
  let data: any = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  return { ok: res.ok && !!data?.ok, data, status, rawText };
}

export default function OrdiniClient() {
  const [me, setMe] = useState<{ pv_code: string; pv_name: string; pv_id: string } | null>(null);
  const [dateISO, setDateISO] = useState(todayISO());
  const [operatore, setOperatore] = useState("");

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchRes, setSearchRes] = useState<Item[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const [rows, setRows] = useState<OrderRowDraft[]>([]);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const searchSeqRef = useRef(0);

  const totalValue = useMemo(() => {
    let sum = 0;

    for (const r of rows) {
      const it = r.item;
      const p = Number(it.prezzo_vendita_eur) || 0;
      if (p <= 0) continue;
      sum += safeInt(r.qty_pz) * p;
    }

    return sum;
  }, [rows]);

  useEffect(() => {
    (async () => {
      try {
        const { ok, data, status, rawText } = await fetchJsonSafe<MeResponse>("/api/me");
        if (!ok) throw new Error((data as any)?.error || rawText || `HTTP ${status}`);

        if (data.role !== "punto_vendita") throw new Error("Non autorizzato");
        if (!data.pv_id) throw new Error("PV non assegnato all'utente");

        setMe({
          pv_id: String(data.pv_id),
          pv_code: String(data.pv_code || ""),
          pv_name: String(data.pv_name || ""),
        });
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!searchWrapRef.current || !target) return;
      if (!searchWrapRef.current.contains(target)) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const s = q.trim();

    setError(null);
    setMsg(null);

    if (showAll) {
      return;
    }

    if (s.length < 3) {
      setSearchRes([]);
      setSearching(false);
      setShowSuggestions(false);
      return;
    }

    const currentSeq = ++searchSeqRef.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);

      try {
        const { ok, data, status, rawText } = await fetchJsonSafe<any>(
          `/api/warehouse-items/search?q=${encodeURIComponent(s)}`
        );

        if (currentSeq !== searchSeqRef.current) return;
        if (!ok) throw new Error(data?.error || rawText || `HTTP ${status}`);

        const found = Array.isArray(data.rows) ? data.rows : [];
        setSearchRes(found);
        setShowSuggestions(true);
      } catch (e: any) {
        if (currentSeq !== searchSeqRef.current) return;
        setSearchRes([]);
        setShowSuggestions(true);
        setError(e?.message || "Errore");
      } finally {
        if (currentSeq === searchSeqRef.current) {
          setSearching(false);
        }
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [q, showAll]);

  async function toggleShowAll() {
    setError(null);
    setMsg(null);

    if (showAll) {
      setShowAll(false);
      setShowSuggestions(false);
      setSearchRes([]);
      return;
    }

    setSearching(true);

    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>(
        "/api/warehouse-items/search?all=1"
      );

      if (!ok) throw new Error(data?.error || rawText || `HTTP ${status}`);

      const found = Array.isArray(data.rows) ? data.rows : [];
      setShowAll(true);
      setSearchRes(found);
      setShowSuggestions(true);
    } catch (e: any) {
      setSearchRes([]);
      setShowSuggestions(false);
      setShowAll(false);
      setError(e?.message || "Errore");
    } finally {
      setSearching(false);
    }
  }

  function addItem(it: Item) {
    setRows((prev) => {
      if (prev.some((r) => r.item.id === it.id)) return prev;
      return [...prev, { item: it, qty_pz: "" }];
    });

    setQ("");
    setSearchRes([]);
    setShowSuggestions(false);
    setShowAll(false);
    setError(null);
    setMsg(null);
  }

  function removeItem(itemId: string) {
    setRows((prev) => prev.filter((r) => r.item.id !== itemId));
  }

  function buildSaveRows(): OrderSaveRow[] {
    const out: OrderSaveRow[] = [];

    for (const r of rows) {
      const qty = safeInt(r.qty_pz);

      out.push({
        item_id: r.item.id,
        qty,
        qty_ml: 0,
        qty_gr: 0,
      });
    }

    return out.filter((r) => (r.qty || 0) > 0);
  }

  async function save() {
    setError(null);
    setMsg(null);

    if (!me) return;

    const op = operatore.trim();
    if (!op) {
      setError("Operatore mancante");
      return;
    }

    const saveRows = buildSaveRows();
    if (saveRows.length === 0) {
      setError("Inserisci almeno una riga con quantità.");
      return;
    }

    setSaving(true);
    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>("/api/pv-orders/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_date: dateISO,
          operatore: op,
          rows: saveRows,
        }),
      });

      if (!ok) throw new Error(data?.error || rawText || `HTTP ${status}`);

      setMsg("Ordine salvato correttamente.");
      setRows([]);
      setSearchRes([]);
      setQ("");
      setShowSuggestions(false);
      setShowAll(false);
    } catch (e: any) {
      setError(e?.message || "Errore");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {me && (
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm text-gray-600">Punto Vendita</div>
          <div className="text-lg font-semibold">
            {me.pv_code || me.pv_id}
            {me.pv_name ? ` — ${me.pv_name}` : ""}
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">Data ordine</label>
          <input
            type="date"
            className="w-full rounded-xl border p-3 bg-white"
            value={dateISO}
            onChange={(e) => setDateISO(e.target.value)}
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-2">Operatore</label>
          <input
            className="w-full rounded-xl border p-3 bg-white"
            value={operatore}
            onChange={(e) => setOperatore(e.target.value)}
            placeholder="Es. Roberto"
          />
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4" ref={searchWrapRef}>
        <label className="block text-sm font-medium mb-2">Cerca articolo</label>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            className="w-full rounded-xl border p-3 bg-white"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (showAll) {
                setShowAll(false);
                setSearchRes([]);
                setShowSuggestions(false);
              }
            }}
            onFocus={() => {
              if (showAll) {
                setShowSuggestions(true);
              } else if (q.trim().length >= 3) {
                setShowSuggestions(true);
              }
            }}
            placeholder="Scrivi almeno 3 lettere: codice, descrizione o barcode"
          />

          <button
            type="button"
            className="rounded-xl border px-4 py-3 hover:bg-gray-50 whitespace-nowrap"
            onClick={toggleShowAll}
            disabled={searching}
          >
            {showAll ? "Chiudi lista" : "Tutti"}
          </button>
        </div>

        <div className="relative">
          {searching && (
            <div className="mt-2 text-xs text-gray-500">
              {showAll ? "Caricamento lista completa..." : "Ricerca in corso..."}
            </div>
          )}

          {!showAll && q.trim().length > 0 && q.trim().length < 3 && (
            <div className="mt-2 text-xs text-gray-500">
              Scrivi almeno 3 lettere per vedere i suggerimenti.
            </div>
          )}

          {showSuggestions && (showAll || q.trim().length >= 3) && (
            <div className="mt-2 rounded-2xl border bg-white shadow-sm overflow-hidden">
              {searchRes.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">
                  {showAll
                    ? "Nessun articolo disponibile."
                    : "Nessun articolo trovato."}
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {searchRes.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => addItem(it)}
                      className="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{it.code}</div>
                          <div className="text-xs text-gray-600">{it.description}</div>
                          {it.barcode ? (
                            <div className="text-[11px] text-gray-400 mt-1">
                              Barcode: {it.barcode}
                            </div>
                          ) : null}
                        </div>

                        {it.um ? (
                          <div className="shrink-0 text-[11px] text-gray-400">
                            {it.um}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Righe ordine</div>
            <div className="text-xs text-gray-500">
              Inserisci le quantità da ordinare. Il valore è una stima basata sul prezzo in anagrafica.
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-gray-500">Valore stimato</div>
            <div className="text-lg font-semibold">{formatEUR(totalValue)}</div>
          </div>
        </div>

        {rows.length === 0 && (
          <div className="mt-3 text-sm text-gray-500">
            Nessuna riga. Cerca un articolo e selezionalo dai suggerimenti per aggiungerlo.
          </div>
        )}

        <div className="mt-3 space-y-3">
          {rows.map((r) => {
            const it = r.item;

            return (
              <div key={it.id} className="rounded-xl border p-3 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{it.code}</div>
                    <div className="text-xs text-gray-600">{it.description}</div>
                  </div>

                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => removeItem(it.id)}
                  >
                    Rimuovi
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Pz</label>
                    <input
                      className="w-full rounded-xl border p-2 bg-white"
                      value={r.qty_pz}
                      inputMode="numeric"
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows((prev) =>
                          prev.map((x) => (x.item.id === it.id ? { ...x, qty_pz: v } : x))
                        );
                      }}
                    />
                  </div>

                  <div className="md:col-span-1">
                    <label className="block text-xs text-gray-600 mb-1">Prezzo</label>
                    <div className="rounded-xl border p-2 bg-gray-50 text-sm">
                      {formatEUR(Number(it.prezzo_vendita_eur) || 0)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {msg && <div className="text-sm text-emerald-700">{msg}</div>}

      <div className="flex justify-end">
        <button
          className="rounded-xl px-5 py-3 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Salvataggio..." : "Salva ordine"}
        </button>
      </div>
    </div>
  );
}