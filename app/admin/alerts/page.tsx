// app/admin/alerts/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PV = { id: string; code: string; name: string };

type ItemRow = {
  id: string;
  code: string;
  description: string;
  volume_ml_per_unit?: number | null;
  categories?: { id: string; slug: string; name: string } | null;
};

type ThresholdRow = {
  id: string;
  pv_id: string | null;
  item_id: string;
  min_qty: number;
  note: string | null;
  updated_at: string | null;
  items?: ItemRow | null;
};

export default function AdminAlertsPage() {
  const router = useRouter();

  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState<string>(""); // "" => globale (pv_id null)

  const [rows, setRows] = useState<ThresholdRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // search items
  const [q, setQ] = useState("");
  const [suggest, setSuggest] = useState<ItemRow[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  // add/edit
  const [selectedItem, setSelectedItem] = useState<ItemRow | null>(null);
  const [minQty, setMinQty] = useState<string>("1");
  const [note, setNote] = useState<string>("");

  const pvLabel = useMemo(() => {
    if (!pvId) return "Soglie Globali (tutti i PV)";
    const pv = pvs.find((x) => x.id === pvId);
    return pv ? `${pv.code} — ${pv.name}` : pvId;
  }, [pvId, pvs]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function loadPvs() {
    try {
      const res = await fetch("/api/pvs/list", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      const list = (json?.pvs ?? json?.rows) ?? [];
      setPvs(Array.isArray(list) ? list : []);
    } catch {
      // se fallisce, la pagina resta utile lo stesso (modalità globale)
    }
  }

  async function loadThresholds() {
    setLoading(true);
    setMsg(null);
    try {
      const url = new URL("/api/admin/alerts/thresholds", window.location.origin);
      if (pvId) url.searchParams.set("pv_id", pvId);
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore caricamento soglie");
        setRows([]);
        return;
      }
      setRows(Array.isArray(json?.rows) ? json.rows : []);
    } catch {
      setMsg("Errore caricamento soglie");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function searchItems(text: string) {
    const t = text.trim();
    if (t.length < 2) {
      setSuggest([]);
      return;
    }
    setSuggestLoading(true);
    try {
      const url = new URL("/api/admin/alerts/thresholds", window.location.origin);
      url.searchParams.set("q", t);
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setSuggest([]);
        return;
      }
      setSuggest(Array.isArray(json?.items) ? json.items : []);
    } finally {
      setSuggestLoading(false);
    }
  }

  useEffect(() => {
    loadPvs();
  }, []);

  useEffect(() => {
    loadThresholds();
    // reset add-box quando cambi PV
    setSelectedItem(null);
    setQ("");
    setSuggest([]);
    setMinQty("1");
    setNote("");
  }, [pvId]);

  async function saveThreshold() {
    setMsg(null);

    if (!selectedItem?.id) {
      setMsg("Seleziona prima un articolo.");
      return;
    }

    const n = Number(minQty);
    if (!Number.isFinite(n) || n < 0) {
      setMsg("Soglia minima non valida (>= 0).");
      return;
    }

    try {
      const res = await fetch("/api/admin/alerts/thresholds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pv_id: pvId || null,
          item_id: selectedItem.id,
          min_qty: Math.trunc(n),
          note: note.trim() || null,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore salvataggio");
        return;
      }

      setMsg("Soglia salvata.");
      await loadThresholds();
    } catch {
      setMsg("Errore salvataggio");
    }
  }

  async function deleteThreshold(id: string) {
    if (!confirm("Eliminare questa soglia?")) return;
    setMsg(null);

    try {
      const url = new URL("/api/admin/alerts/thresholds", window.location.origin);
      url.searchParams.set("id", id);
      const res = await fetch(url.toString(), { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore eliminazione");
        return;
      }
      setMsg("Soglia eliminata.");
      await loadThresholds();
    } catch {
      setMsg("Errore eliminazione");
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Soglie &amp; Alert</h1>
            <p className="text-gray-600 mt-1">
              Imposta le soglie minime per generare alert (Tabacchi e Gratta e Vinci esclusi).
            </p>

            <div className="mt-3 flex items-center gap-3 text-sm">
              <Link href="/admin" className="underline">
                ← Torna ad Admin
              </Link>
              <span className="text-gray-400">•</span>
              <span className="text-gray-700">
                Modalità: <b>{pvLabel}</b>
              </span>
            </div>
          </div>

          <button onClick={logout} className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
            Logout
          </button>
        </div>

        {msg && <div className="rounded-xl border bg-white p-3 text-sm text-gray-800">{msg}</div>}

        {/* selector PV */}
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Ambito soglia</h2>
          <p className="text-sm text-gray-600 mt-1">
            Puoi impostare soglie <b>globali</b> (valgono per tutti i PV) oppure specifiche per singolo PV.
          </p>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2">Punto vendita</label>
              <select
                className="w-full rounded-xl border p-3 bg-white"
                value={pvId}
                onChange={(e) => setPvId(e.target.value)}
              >
                <option value="">— Globale (tutti i PV) —</option>
                {pvs.map((pv) => (
                  <option key={pv.id} value={pv.id}>
                    {pv.code} — {pv.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* add threshold */}
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Aggiungi / aggiorna soglia</h2>
          <p className="text-sm text-gray-600 mt-1">
            Cerca un articolo (codice o descrizione), imposta la soglia minima e salva.
          </p>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium mb-2">Cerca articolo</label>
              <input
                className="w-full rounded-xl border p-3"
                placeholder="Es. BRANCA oppure 'AMARO'"
                value={q}
                onChange={(e) => {
                  const v = e.target.value;
                  setQ(v);
                  setSelectedItem(null);
                  searchItems(v);
                }}
              />

              <div className="mt-2 rounded-xl border bg-gray-50 p-2">
                {suggestLoading ? (
                  <div className="text-sm text-gray-600 p-2">Ricerca…</div>
                ) : suggest.length === 0 ? (
                  <div className="text-sm text-gray-600 p-2">Nessun risultato (min 2 caratteri).</div>
                ) : (
                  <div className="max-h-56 overflow-auto">
                    {suggest.map((it) => {
                      const active = selectedItem?.id === it.id;
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => {
                            setSelectedItem(it);
                            setMinQty("1");
                            setNote("");
                          }}
                          className={[
                            "w-full text-left rounded-xl border bg-white px-3 py-2 mb-2 hover:bg-gray-50",
                            active ? "ring-2 ring-black" : "",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium">{it.code}</div>
                            <div className="text-xs text-gray-500">
                              {it?.categories?.name ? it.categories.name : "—"}
                            </div>
                          </div>
                          <div className="text-sm text-gray-700 mt-1">{it.description}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedItem && (
                <div className="mt-2 text-sm text-gray-700">
                  Selezionato: <b>{selectedItem.code}</b> — {selectedItem.description}
                </div>
              )}
            </div>

            <div className="lg:col-span-1">
              <label className="block text-sm font-medium mb-2">Soglia minima (pezzi)</label>
              <input
                className="w-full rounded-xl border p-3"
                inputMode="numeric"
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
                placeholder="Es. 5"
              />
              <p className="text-xs text-gray-500 mt-1">
                Per ora la soglia è in <b>pezzi</b>. (Gestione “bottiglia aperta in ml” la facciamo dopo.)
              </p>

              <label className="block text-sm font-medium mb-2 mt-4">Nota (opzionale)</label>
              <input
                className="w-full rounded-xl border p-3"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Es. prodotto critico"
              />

              <button
                className="mt-4 w-full rounded-xl bg-black text-white p-3 disabled:opacity-60"
                onClick={saveThreshold}
                disabled={!selectedItem}
              >
                Salva soglia
              </button>
            </div>
          </div>
        </section>

        {/* list thresholds */}
        <section className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Soglie impostate</h2>
            <button
              onClick={loadThresholds}
              className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Aggiorno…" : "Ricarica"}
            </button>
          </div>

          <div className="mt-4 overflow-auto rounded-xl border">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3">Codice</th>
                  <th className="text-left p-3">Descrizione</th>
                  <th className="text-left p-3">Categoria</th>
                  <th className="text-left p-3">Min</th>
                  <th className="text-left p-3">Nota</th>
                  <th className="text-left p-3">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="p-3 text-gray-600" colSpan={6}>
                      Nessuna soglia impostata in questo ambito.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-3 font-medium">{r.items?.code ?? "—"}</td>
                      <td className="p-3">{r.items?.description ?? "—"}</td>
                      <td className="p-3 text-gray-600">{r.items?.categories?.name ?? "—"}</td>
                      <td className="p-3">{r.min_qty}</td>
                      <td className="p-3">{r.note ?? ""}</td>
                      <td className="p-3">
                        <button
                          className="rounded-xl border px-3 py-1 hover:bg-gray-50"
                          onClick={() => deleteThreshold(r.id)}
                        >
                          Elimina
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 mt-3">
            Nota: Tabacchi e Gratta e Vinci sono esclusi a monte (non puoi impostare soglie per quei prodotti).
          </p>
        </section>
      </div>
    </main>
  );
}
