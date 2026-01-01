"use client";

import { useEffect, useMemo, useState } from "react";

type Pv = { id: string; code: string; name: string; is_active?: boolean };
type Category = { id: string; name: string; slug?: string; is_active?: boolean };
type Subcategory = { id: string; category_id: string; name: string; slug?: string; is_active?: boolean };

type InventoryGroup = {
  key: string;
  pv_id: string;
  pv_code: string;
  pv_name: string;
  category_id: string;
  category_name: string;
  subcategory_id: string | null;
  subcategory_name: string;
  inventory_date: string;
  created_by_username: string | null;
  created_at: string | null;
  lines_count: number;
  qty_sum: number;
};

type InventoryLine = {
  id: string;
  item_id: string;
  code: string;
  description: string;
  qty: number;
};

type MeResponse = {
  ok: boolean;
  username?: string;
  role?: string;
  pv_id?: string | null;
  error?: string;
};

type MeState = {
  role: "admin" | "amministrativo" | "punto_vendita" | null;
  username: string | null;
  pv_id: string | null;
  isPv: boolean;
};

export default function InventoryHistoryClient() {
  const [me, setMe] = useState<MeState>({
    role: null,
    username: null,
    pv_id: null,
    isPv: false,
  });

  const [pvs, setPvs] = useState<Pv[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  // filtri
  const [pvId, setPvId] = useState<string>(""); // "" = tutti (solo admin/amministrativo)
  const [categoryId, setCategoryId] = useState<string>(""); // "" = tutte
  const [subcategoryId, setSubcategoryId] = useState<string>(""); // "" = tutte/nessuna

  const [rows, setRows] = useState<InventoryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // dettaglio selezionato
  const [selected, setSelected] = useState<InventoryGroup | null>(null);
  const [detail, setDetail] = useState<InventoryLine[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // modal compare
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState<InventoryGroup | null>(null);
  const [compareFile, setCompareFile] = useState<File | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareMsg, setCompareMsg] = useState<string | null>(null);
  const [compareDownloadUrl, setCompareDownloadUrl] = useState<string | null>(null);

  const canUseSubcategories = useMemo(() => !!categoryId, [categoryId]);

  const canCompare = me.role === "admin" || me.role === "amministrativo";

  async function fetchMe(): Promise<MeState> {
    const res = await fetch("/api/me", { cache: "no-store" });
    const json: MeResponse = await res.json().catch(() => ({ ok: false, error: "Errore parsing" }));

    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore autenticazione");

    const role = (json.role || "").toString() as MeState["role"];
    const pv_id = json.pv_id ?? null;

    const isPv = role === "punto_vendita";
    if (isPv && !pv_id) throw new Error("Utente punto vendita senza PV assegnato (pv_id mancante).");

    return {
      role: role ?? null,
      username: json.username ?? null,
      pv_id,
      isPv,
    };
  }

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento PV");
    setPvs(json.rows || []);
  }

  async function loadCategories() {
    const res = await fetch("/api/categories/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento categorie");
    setCategories(json.rows || []);
  }

  async function loadSubcategories(catId: string) {
    setSubcategories([]);
    setSubcategoryId("");
    if (!catId) return;

    const res = await fetch(`/api/subcategories/list?category_id=${encodeURIComponent(catId)}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento sottocategorie");
    setSubcategories(json.rows || []);
  }

  async function loadList(effectiveMe: MeState) {
    setLoading(true);
    setError(null);
    setRows([]);
    setSelected(null);
    setDetail([]);
    setDetailError(null);

    try {
      const params = new URLSearchParams();

      if (categoryId) params.set("category_id", categoryId);

      // PV:
      // - PV mode: pv_id forzato
      // - admin/amministrativo: pv_id opzionale
      if (effectiveMe.isPv) {
        if (effectiveMe.pv_id) params.set("pv_id", effectiveMe.pv_id);
      } else {
        if (pvId) params.set("pv_id", pvId);
      }

      if (categoryId && subcategoryId) params.set("subcategory_id", subcategoryId);

      const qs = params.toString();
      const res = await fetch(`/api/inventories/list${qs ? `?${qs}` : ""}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento inventari");

      setRows(json.rows || []);
    } catch (e: any) {
      setError(e?.message || "Errore");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(g: InventoryGroup, effectiveMe: MeState) {
    setSelected(g);
    setDetail([]);
    setDetailError(null);
    setDetailLoading(true);

    try {
      // extra sicurezza
      if (effectiveMe.isPv && effectiveMe.pv_id && g.pv_id !== effectiveMe.pv_id) {
        throw new Error("Non autorizzato.");
      }

      const params = new URLSearchParams();
      params.set("pv_id", g.pv_id);
      params.set("category_id", g.category_id);
      params.set("inventory_date", g.inventory_date);
      if (g.subcategory_id) params.set("subcategory_id", g.subcategory_id);

      const res = await fetch(`/api/inventories/rows?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento dettaglio");

      setDetail(json.rows || []);
    } catch (e: any) {
      setDetailError(e?.message || "Errore");
    } finally {
      setDetailLoading(false);
    }
  }

  function openCompare(g: InventoryGroup) {
    setCompareTarget(g);
    setCompareFile(null);
    setCompareOpen(true);
    setCompareError(null);
    setCompareMsg(null);
    setCompareDownloadUrl(null);
  }

  function closeCompare() {
    setCompareOpen(false);
    setCompareTarget(null);
    setCompareFile(null);
    setCompareError(null);
    setCompareMsg(null);
    setCompareDownloadUrl(null);
    setCompareLoading(false);
  }

  async function startCompare() {
    if (!compareTarget) return;
    if (!compareFile) {
      setCompareError("Carica prima il file del gestionale.");
      return;
    }

    setCompareLoading(true);
    setCompareError(null);
    setCompareMsg(null);
    setCompareDownloadUrl(null);

    try {
      // Placeholder: domani lo implementiamo davvero
      // L’idea: carichi il file gestionale, e il server confronta vs inventario PV già salvato in DB.
      const fd = new FormData();
      fd.append("file", compareFile);

      // chiavi inventario da confrontare
      fd.append("pv_id", compareTarget.pv_id);
      fd.append("category_id", compareTarget.category_id);
      fd.append("inventory_date", compareTarget.inventory_date);
      if (compareTarget.subcategory_id) fd.append("subcategory_id", compareTarget.subcategory_id);

      const res = await fetch("/api/inventories/compare", { method: "POST", body: fd });
      const text = await res.text();
      let json: any = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // non json
      }

      if (!res.ok || !json?.ok) {
        const msg = json?.error || `Comparazione non disponibile (endpoint /api/inventories/compare).`;
        throw new Error(msg);
      }

      // ci aspettiamo: { ok:true, downloadUrl:"/api/.../excel" }
      setCompareMsg("Comparazione completata.");
      setCompareDownloadUrl(json.downloadUrl || null);
    } catch (e: any) {
      setCompareError(e?.message || "Errore comparazione");
    } finally {
      setCompareLoading(false);
    }
  }

  // bootstrap
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const meState = await fetchMe();
        setMe(meState);

        // se PV, filtro PV “implicito”: teniamo pvId come stringa (solo per UI, ma non mostriamo select)
        if (meState.isPv && meState.pv_id) setPvId(meState.pv_id);

        await loadCategories();

        if (!meState.isPv) {
          await loadPvs();
        }

        // prima lista
        await loadList(meState);
      } catch (e: any) {
        setError(e?.message || "Errore");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // quando cambia categoria -> ricarica sottocategorie
  useEffect(() => {
    (async () => {
      try {
        if (!me.role) return;
        setError(null);
        await loadSubcategories(categoryId);
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, me.role]);

  // trigger lista quando cambiano filtri (usa me in state, niente fetchMe ripetuto)
  useEffect(() => {
    (async () => {
      try {
        if (!me.role) return;
        await loadList(me);
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, me.role]);

  return (
    <div className="space-y-4">
      {/* filtri */}
      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* PV filter: SOLO admin/amministrativo */}
        {!me.isPv ? (
          <div>
            <label className="block text-sm font-medium mb-2">Punto Vendita (opzionale)</label>
            <select
              className="w-full rounded-xl border p-3 bg-white"
              value={pvId}
              onChange={(e) => setPvId(e.target.value)}
            >
              <option value="">— Tutti i PV —</option>
              {pvs.map((pv) => (
                <option key={pv.id} value={pv.id}>
                  {pv.code} — {pv.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-2">Punto Vendita</label>
            <div className="w-full rounded-xl border p-3 bg-gray-50 text-gray-700">
              Il tuo Punto Vendita (filtro automatico)
            </div>
            <p className="text-xs text-gray-500 mt-1">Non puoi cambiare PV.</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-2">Categoria</label>
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">— Tutte le categorie —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Sottocategoria (opzionale)</label>
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={!canUseSubcategories || subcategories.length === 0}
          >
            <option value="">— Tutte —</option>
            {subcategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* lista inventari */}
      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 w-36">Data</th>
              <th className="text-left p-3">PV</th>
              <th className="text-left p-3">Categoria</th>
              <th className="text-left p-3">Sottocat</th>
              <th className="text-right p-3 w-28">Righe</th>
              <th className="text-right p-3 w-28">Pezzi</th>
              <th className="text-left p-3 w-36">Creato da</th>
              <th className="text-left p-3 w-32"></th>
              {canCompare && <th className="text-left p-3 w-32"></th>}
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={canCompare ? 9 : 8}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={canCompare ? 9 : 8}>
                  Nessun inventario trovato con questi filtri.
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const isSel = selected?.key === r.key;
              return (
                <tr key={r.key} className={`border-t ${isSel ? "bg-yellow-50" : ""}`}>
                  <td className="p-3 font-medium">{r.inventory_date}</td>
                  <td className="p-3">
                    <div className="font-medium">{r.pv_code || r.pv_id}</div>
                    <div className="text-xs text-gray-500">{r.pv_name}</div>
                  </td>
                  <td className="p-3">{r.category_name || r.category_id}</td>
                  <td className="p-3">{r.subcategory_name || (r.subcategory_id ? r.subcategory_id : "—")}</td>
                  <td className="p-3 text-right">{r.lines_count}</td>
                  <td className="p-3 text-right font-semibold">{r.qty_sum}</td>
                  <td className="p-3">{r.created_by_username ?? "—"}</td>

                  <td className="p-3">
                    <button
                      className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                      onClick={async () => {
                        await loadDetail(r, me);
                      }}
                    >
                      Dettaglio
                    </button>
                  </td>

                  {canCompare && (
                    <td className="p-3">
                      <button
                        className="rounded-xl bg-slate-900 text-white px-3 py-2 hover:bg-slate-800 disabled:opacity-60"
                        onClick={() => openCompare(r)}
                        disabled={!canCompare}
                        title="Carica file del gestionale e compara"
                      >
                        Compara
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* dettaglio */}
      {selected && (
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">
                Dettaglio inventario — {selected.inventory_date} — {selected.pv_code} — {selected.category_name}
              </div>
              <div className="text-sm text-gray-600">
                Righe: <b>{selected.lines_count}</b> — Pezzi: <b>{selected.qty_sum}</b>
              </div>
            </div>

            <button
              className="rounded-xl border px-3 py-2 hover:bg-gray-50"
              onClick={() => {
                setSelected(null);
                setDetail([]);
                setDetailError(null);
              }}
            >
              Chiudi
            </button>
          </div>

          {detailLoading && <div className="text-sm text-gray-500">Carico righe...</div>}
          {detailError && <div className="text-sm text-red-600">{detailError}</div>}

          {!detailLoading && !detailError && (
            <div className="overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3 w-40">Codice</th>
                    <th className="text-left p-3">Descrizione</th>
                    <th className="text-right p-3 w-28">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((x) => (
                    <tr key={x.id} className="border-t">
                      <td className="p-3 font-medium">{x.code}</td>
                      <td className="p-3">{x.description}</td>
                      <td className="p-3 text-right font-semibold">{x.qty}</td>
                    </tr>
                  ))}
                  {detail.length === 0 && (
                    <tr className="border-t">
                      <td className="p-3 text-gray-500" colSpan={3}>
                        Nessuna riga trovata.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL COMPARA */}
      {compareOpen && compareTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeCompare} />

          <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-lg border p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Compara inventario</div>
                <div className="text-sm text-gray-600 mt-1">
                  {compareTarget.inventory_date} — {compareTarget.pv_code} — {compareTarget.category_name}
                  {compareTarget.subcategory_name ? ` — ${compareTarget.subcategory_name}` : ""}
                </div>
              </div>

              <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={closeCompare}>
                Chiudi
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-2">File gestionale (.xlsx)</label>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => setCompareFile(e.target.files?.[0] || null)}
                />
                {compareFile && (
                  <p className="text-xs text-gray-600 mt-2">
                    Selezionato: <b>{compareFile.name}</b>
                  </p>
                )}
              </div>

              {compareError && <p className="text-sm text-red-600">{compareError}</p>}
              {compareMsg && <p className="text-sm text-green-700">{compareMsg}</p>}

              <div className="flex items-center justify-between gap-3">
                <button
                  className="rounded-xl bg-slate-900 text-white px-4 py-2 hover:bg-slate-800 disabled:opacity-60"
                  disabled={!compareFile || compareLoading}
                  onClick={startCompare}
                >
                  {compareLoading ? "Comparo..." : "Avvia comparazione"}
                </button>

                {compareDownloadUrl && (
                  <button
                    className="rounded-xl border px-4 py-2 hover:bg-gray-50"
                    onClick={() => (window.location.href = compareDownloadUrl)}
                  >
                    Scarica risultato
                  </button>
                )}
              </div>

              <p className="text-xs text-gray-500">
                Nota: domani implementiamo l’endpoint <b>/api/inventories/compare</b> in base al formato del file gestionale.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




