"use client";

import { useEffect, useMemo, useState } from "react";

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

type WasteRowDraft = {
  item: Item;
  qty_pz: string; // input
  qty_ml_open: string; // input (solo ML)
  qty_gr_open: string; // input (solo KG)
};

type WasteSaveRow = {
  item_id: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
};

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function safeInt(v: any) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function safeGr(v: any) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function isMlItem(it: Item) {
  const ml = Number(it.volume_ml_per_unit ?? 0) || 0;
  return ml > 0;
}

function isKgItem(it: Item) {
  return String(it.um ?? "").trim().toUpperCase() === "KG";
}

function formatEUR(n: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);
}

async function fetchJsonSafe<T = any>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T; status: number; rawText: string }>
{
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

export default function ScaricoRimanenzeClient() {
  const [me, setMe] = useState<{ pv_code: string; pv_name: string; pv_id: string } | null>(null);
  const [dateISO, setDateISO] = useState(todayISO());
  const [operatore, setOperatore] = useState("");

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchRes, setSearchRes] = useState<Item[]>([]);

  const [rows, setRows] = useState<WasteRowDraft[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalValue = useMemo(() => {
    let sum = 0;
    for (const r of rows) {
      const it = r.item;
      const p = Number(it.prezzo_vendita_eur) || 0;
      if (p <= 0) continue;

      if (isMlItem(it)) {
        const perUnit = Number(it.volume_ml_per_unit) || 0;
        if (perUnit <= 0) continue;
        const pz = safeInt(r.qty_pz);
        const open = safeInt(r.qty_ml_open);
        const totalMl = pz * perUnit + open;
        sum += (totalMl / perUnit) * p;
        continue;
      }

      if (isKgItem(it)) {
        const pz = safeInt(r.qty_pz);
        const gr = safeGr(r.qty_gr_open);
        const pesoKg = Number(it.peso_kg ?? 0) || 0;
        if (pesoKg > 0) {
          const kg = pz * pesoKg + gr / 1000;
          sum += kg * p;
        }
        continue;
      }

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

  async function doSearch() {
    const s = q.trim();
    setError(null);
    setMsg(null);
    setSearchRes([]);
    if (s.length < 2) return;

    setSearching(true);
    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>(`/api/items/search?q=${encodeURIComponent(s)}`);
      if (!ok) throw new Error(data?.error || rawText || `HTTP ${status}`);
      setSearchRes(data.rows || []);
    } catch (e: any) {
      setError(e?.message || "Errore");
    } finally {
      setSearching(false);
    }
  }

  function addItem(it: Item) {
    setRows((prev) => {
      if (prev.some((r) => r.item.id === it.id)) return prev;
      return [...prev, { item: it, qty_pz: "", qty_ml_open: "", qty_gr_open: "" }];
    });
  }

  function removeItem(itemId: string) {
    setRows((prev) => prev.filter((r) => r.item.id !== itemId));
  }

  function onPickPhotos(files: FileList | null) {
    setError(null);
    setMsg(null);
    if (!files) return;
    const incoming = Array.from(files);
    const next = [...photos, ...incoming].slice(0, 6);
    setPhotos(next);
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  function buildSaveRows(): WasteSaveRow[] {
    const out: WasteSaveRow[] = [];

    for (const r of rows) {
      const it = r.item;
      const qty = safeInt(r.qty_pz);

      if (isMlItem(it)) {
        const perUnit = Number(it.volume_ml_per_unit) || 0;
        const open = safeInt(r.qty_ml_open);
        const qty_ml = perUnit > 0 ? qty * perUnit + open : 0;
        out.push({ item_id: it.id, qty, qty_ml, qty_gr: 0 });
        continue;
      }

      if (isKgItem(it)) {
        const qty_gr = safeGr(r.qty_gr_open);
        out.push({ item_id: it.id, qty, qty_ml: 0, qty_gr });
        continue;
      }

      out.push({ item_id: it.id, qty, qty_ml: 0, qty_gr: 0 });
    }

    // tolgo righe completamente vuote
    return out.filter((r) => (r.qty || 0) > 0 || (r.qty_ml || 0) > 0 || (r.qty_gr || 0) > 0);
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

    if (photos.length > 6) {
      setError("Massimo 6 foto.");
      return;
    }

    setSaving(true);
    try {
      const { ok, data, status, rawText } = await fetchJsonSafe<any>("/api/waste/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waste_date: dateISO, operatore: op, rows: saveRows }),
      });

      if (!ok) throw new Error(data?.error || rawText || `HTTP ${status}`);

      const header_id = String(data.header_id || "");
      if (!header_id) throw new Error("Salvataggio riuscito ma header_id mancante");

      // upload foto (se presenti)
      for (const f of photos) {
        const fd = new FormData();
        fd.append("header_id", header_id);
        fd.append("file", f);

        const up = await fetch("/api/waste/upload", { method: "POST", body: fd });
        const txt = await up.text().catch(() => "");
        let j: any = null;
        try {
          j = txt ? JSON.parse(txt) : null;
        } catch {
          j = null;
        }
        if (!up.ok || !j?.ok) {
          throw new Error(j?.error || txt || `Upload fallito (${up.status})`);
        }
      }

      setMsg("Scarico salvato. Giacenze PV-STOCK aggiornate.");
      setRows([]);
      setPhotos([]);
      // non azzero operatore (di solito resta uguale)
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
          <div className="text-lg font-semibold">{me.pv_code || me.pv_id}{me.pv_name ? ` — ${me.pv_name}` : ""}</div>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">Data</label>
          <input type="date" className="w-full rounded-xl border p-3 bg-white" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-2">Operatore</label>
          <input className="w-full rounded-xl border p-3 bg-white" value={operatore} onChange={(e) => setOperatore(e.target.value)} placeholder="Es. Roberto" />
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="flex-1 rounded-xl border p-3 bg-white"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca per codice o descrizione (o barcode)"
          />
          <button
            className="rounded-xl px-4 py-3 text-sm font-medium bg-slate-900 text-white disabled:opacity-50"
            disabled={searching || q.trim().length < 2}
            onClick={doSearch}
          >
            {searching ? "Cercando..." : "Cerca"}
          </button>
        </div>

        {searchRes.length > 0 && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {searchRes.map((it) => (
              <button
                key={it.id}
                onClick={() => addItem(it)}
                className="text-left rounded-xl border p-3 bg-white hover:bg-gray-50"
              >
                <div className="text-sm font-semibold">{it.code}</div>
                <div className="text-xs text-gray-600">{it.description}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Righe scarico</div>
            <div className="text-xs text-gray-500">Inserisci le quantità. Il valore è una stima in base al prezzo in anagrafica.</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Totale valore</div>
            <div className="text-lg font-semibold">{formatEUR(totalValue)}</div>
          </div>
        </div>

        {rows.length === 0 && <div className="mt-3 text-sm text-gray-500">Nessuna riga. Cerca un articolo e cliccalo per aggiungerlo.</div>}

        <div className="mt-3 space-y-3">
          {rows.map((r) => {
            const it = r.item;
            const ml = isMlItem(it);
            const kg = isKgItem(it);
            return (
              <div key={it.id} className="rounded-xl border p-3 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{it.code}</div>
                    <div className="text-xs text-gray-600">{it.description}</div>
                  </div>
                  <button className="text-xs text-red-600 hover:underline" onClick={() => removeItem(it.id)}>
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
                        setRows((prev) => prev.map((x) => (x.item.id === it.id ? { ...x, qty_pz: v } : x)));
                      }}
                    />
                  </div>

                  {ml && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">ML aperti</label>
                      <input
                        className="w-full rounded-xl border p-2 bg-white"
                        value={r.qty_ml_open}
                        inputMode="numeric"
                        onChange={(e) => {
                          const v = e.target.value;
                          setRows((prev) => prev.map((x) => (x.item.id === it.id ? { ...x, qty_ml_open: v } : x)));
                        }}
                      />
                    </div>
                  )}

                  {kg && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">GR aperti</label>
                      <input
                        className="w-full rounded-xl border p-2 bg-white"
                        value={r.qty_gr_open}
                        inputMode="numeric"
                        onChange={(e) => {
                          const v = e.target.value;
                          setRows((prev) => prev.map((x) => (x.item.id === it.id ? { ...x, qty_gr_open: v } : x)));
                        }}
                      />
                    </div>
                  )}

                  <div className="md:col-span-1">
                    <label className="block text-xs text-gray-600 mb-1">Prezzo</label>
                    <div className="rounded-xl border p-2 bg-gray-50 text-sm">{formatEUR(Number(it.prezzo_vendita_eur) || 0)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="text-lg font-semibold">Foto (max 6)</div>
        <div className="text-xs text-gray-500 mt-1">Scatta o carica fino a 6 foto per questo scarico.</div>

        <div className="mt-3 flex flex-col md:flex-row gap-3 items-start md:items-center">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => onPickPhotos(e.target.files)}
            className="block"
          />
          <div className="text-sm text-gray-600">Selezionate: {photos.length}/6</div>
        </div>

        {photos.length > 0 && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {photos.map((f, idx) => (
              <div key={idx} className="rounded-xl border p-3 bg-white flex items-center justify-between gap-3">
                <div className="text-xs text-gray-700 break-all">{f.name}</div>
                <button className="text-xs text-red-600 hover:underline" onClick={() => removePhoto(idx)}>
                  Rimuovi
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {msg && <div className="text-sm text-emerald-700">{msg}</div>}

      <div className="flex justify-end">
        <button
          className="rounded-xl px-5 py-3 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Salvataggio..." : "Salva scarico"}
        </button>
      </div>
    </div>
  );
}
