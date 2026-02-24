"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PV = { id: string; code: string; name: string };

type Deposit = {
  id: string;
  pv_id: string;
  code: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
};

type DepositItemRow = {
  id: string;
  deposit_id: string;
  item_id: string;
  imported_code: string;
  note_description: string | null;
  stock_qty: number;
  is_active: boolean;
  created_at: string;
  items?: any;
};

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatEUR(n: any) {
  const x = Number(n);
  const v = Number.isFinite(x) ? x : 0;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(v);
}

function normUm(v: any) {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

function computeRowValueEUR(r: DepositItemRow) {
  const price = Number(r.items?.prezzo_vendita_eur ?? 0);
  if (!Number.isFinite(price) || price <= 0) return 0;

  const qty = Number(r.stock_qty ?? 0);
  if (!Number.isFinite(qty) || qty <= 0) return 0;

  // ✅ Regola coerente col resto del progetto:
  // - UM=KG => stock_qty è in grammi => converto a kg
  // - altrimenti => stock_qty “vale” come unità base (PZ / CL / ecc.)
  const um = normUm(r.items?.um);
  if (um === "KG") {
    return (qty / 1000) * price;
  }
  return qty * price;
}

export default function AdminDepositsPage() {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState<string>("");

  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositId, setDepositId] = useState<string>("");

  const [depCode, setDepCode] = useState("");
  const [depName, setDepName] = useState("");
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  const [items, setItems] = useState<DepositItemRow[]>([]);
  const [itemsMsg, setItemsMsg] = useState<string | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);

  const selectedPV = useMemo(() => pvs.find((p) => p.id === pvId) || null, [pvs, pvId]);
  const selectedDeposit = useMemo(() => deposits.find((d) => d.id === depositId) || null, [deposits, depositId]);

  const itemsTotals = useMemo(() => {
    let totQty = 0;
    let totValue = 0;
    for (const r of items) {
      const q = Number(r.stock_qty ?? 0);
      totQty += Number.isFinite(q) ? q : 0;
      totValue += computeRowValueEUR(r);
    }
    return { totQty, totValue };
  }, [items]);

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    const list = (json?.pvs ?? json?.rows) ?? [];
    setPvs(Array.isArray(list) ? list : []);
  }

  async function loadDeposits(nextPvId: string) {
    setCreateMsg(null);
    setImportMsg(null);
    setItemsMsg(null);

    setDeposits([]);
    setDepositId("");
    setItems([]);

    if (!nextPvId) return;

    const res = await fetch(`/api/deposits/list?pv_id=${encodeURIComponent(nextPvId)}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setCreateMsg(json?.error || "Errore caricamento depositi");
      return;
    }

    const list = Array.isArray(json.deposits) ? (json.deposits as Deposit[]) : [];
    setDeposits(list);

    if (list.length === 1) setDepositId(list[0].id);
  }

  async function loadDepositItems(nextDepositId: string) {
    setItemsMsg(null);
    setItems([]);
    if (!nextDepositId) return;

    setItemsLoading(true);
    try {
      const res = await fetch(`/api/deposits/items?deposit_id=${encodeURIComponent(nextDepositId)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setItemsMsg(json?.error || "Errore caricamento articoli deposito");
        return;
      }

      setItems(Array.isArray(json.items) ? json.items : []);
    } finally {
      setItemsLoading(false);
    }
  }

  useEffect(() => {
    loadPvs().catch(() => null);
  }, []);

  useEffect(() => {
    if (!pvId) return;
    loadDeposits(pvId).catch(() => null);
  }, [pvId]);

  useEffect(() => {
    if (!depositId) return;
    loadDepositItems(depositId).catch(() => null);
  }, [depositId]);

  async function createDeposit(e: React.FormEvent) {
    e.preventDefault();
    setCreateMsg(null);
    setImportMsg(null);

    if (!pvId) {
      setCreateMsg("Seleziona prima un PV.");
      return;
    }

    const code = depCode.trim().toUpperCase();
    if (!code) {
      setCreateMsg("Inserisci un codice deposito (es. A1-DIVERSIVO).");
      return;
    }

    setCreateLoading(true);
    try {
      const res = await fetch("/api/deposits/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pv_id: pvId, code, name: depName.trim() ? depName.trim() : null }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setCreateMsg(json?.error || "Errore creazione deposito");
        return;
      }

      setCreateMsg(`Deposito creato: ${json.deposit.code}`);
      setDepCode("");
      setDepName("");

      await loadDeposits(pvId);
      const newId = json.deposit?.id;
      if (newId) setDepositId(newId);
    } finally {
      setCreateLoading(false);
    }
  }

  async function importExcel(e: React.FormEvent) {
    e.preventDefault();
    setImportMsg(null);

    if (!depositId) {
      setImportMsg("Seleziona prima un deposito.");
      return;
    }
    if (!file) {
      setImportMsg("Seleziona un file Excel.");
      return;
    }

    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("deposit_id", depositId);
      fd.append("file", file);

      const res = await fetch("/api/deposits/import", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setImportMsg(json?.error || "Errore import");
        return;
      }

      const notFound = Array.isArray(json.not_found) ? json.not_found.length : 0;
      const excluded = Array.isArray(json.excluded) ? json.excluded.length : 0;

      setImportMsg(
        `Import OK (${todayISO()}): righe=${json.total_rows}, mappate=${json.mapped}, non_trovate=${notFound}, escluse(TAB/GV)=${excluded}`
      );

      setFile(null);
      await loadDepositItems(depositId);
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Depositi (Magazzini)</h1>
            <p className="text-gray-600 mt-1">Crea depositi per PV, importa articoli da Excel e verifica i mapping.</p>
          </div>

          <div className="flex gap-2">
            <Link href="/admin" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
              ← Admin
            </Link>
          </div>
        </div>

        {/* shortcut */}
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Azioni rapide</h2>
          <p className="text-sm text-gray-600 mt-1">Prima seleziona PV e Deposito (sotto), poi usa i pulsanti.</p>

          <div className="mt-3 flex flex-col md:flex-row gap-2">
            <Link
              href="/admin/deposits/inventory"
              className="rounded-xl border bg-white px-4 py-3 hover:bg-gray-50 text-center"
            >
              Inventario Deposito (Tutte)
            </Link>

            <Link
              href="/admin/deposits/history"
              className="rounded-xl border bg-white px-4 py-3 hover:bg-gray-50 text-center"
            >
              Storico Inventari Deposito
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Selezione</h2>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2">Punto Vendita</label>
              <select
                className="w-full rounded-xl border p-3 bg-white"
                value={pvId}
                onChange={(e) => setPvId(e.target.value)}
              >
                <option value="">— Seleziona PV —</option>
                {pvs.map((pv) => (
                  <option key={pv.id} value={pv.id}>
                    {pv.code} — {pv.name}
                  </option>
                ))}
              </select>
              {selectedPV && <p className="text-xs text-gray-500 mt-1">PV selezionato: {selectedPV.code}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Deposito</label>
              <select
                className="w-full rounded-xl border p-3 bg-white"
                value={depositId}
                onChange={(e) => setDepositId(e.target.value)}
                disabled={!pvId}
              >
                <option value="">— Seleziona deposito —</option>
                {deposits.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code}
                    {d.name ? ` — ${d.name}` : ""}
                  </option>
                ))}
              </select>
              {selectedDeposit && (
                <p className="text-xs text-gray-500 mt-1">
                  Deposito selezionato: <b>{selectedDeposit.code}</b>
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Crea Deposito</h2>
          <p className="text-sm text-gray-600 mt-1">Esempio: A1-DIVERSIVO, A3-FLACCA…</p>

          <form onSubmit={createDeposit} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                className="w-full rounded-xl border p-3 md:col-span-1"
                placeholder="Codice deposito"
                value={depCode}
                onChange={(e) => setDepCode(e.target.value)}
                disabled={!pvId}
              />
              <input
                className="w-full rounded-xl border p-3 md:col-span-2"
                placeholder="Nome (opzionale)"
                value={depName}
                onChange={(e) => setDepName(e.target.value)}
                disabled={!pvId}
              />
            </div>

            <button
              className="w-full rounded-xl bg-black text-white p-3 disabled:opacity-60"
              disabled={createLoading || !pvId}
            >
              {createLoading ? "Creazione..." : "Crea deposito"}
            </button>

            {createMsg && <p className="text-sm">{createMsg}</p>}
          </form>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Import articoli deposito (Excel)</h2>
          <p className="text-sm text-gray-600 mt-1">
            File con 2 colonne: <b>Codice</b> + <b>Descrizione</b> (opzionale).
          </p>

          <form onSubmit={importExcel} className="mt-4 space-y-3">
            <input
              type="file"
              accept=".xlsx"
              className="w-full rounded-xl border p-3 bg-white"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={!depositId || importLoading}
            />

            <button
              className="w-full rounded-xl bg-slate-900 text-white p-3 disabled:opacity-60"
              disabled={!depositId || !file || importLoading}
            >
              {importLoading ? "Import..." : "Importa Excel"}
            </button>

            {importMsg && <p className="text-sm">{importMsg}</p>}
          </form>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Articoli nel deposito</h2>
          <p className="text-sm text-gray-600 mt-1">
            Qui vedi i mapping su Anagrafica e lo stock attuale. Mostriamo anche prezzo e valore (quando disponibili).
          </p>

          {items.length > 0 && !itemsLoading && (
            <div className="mt-2 text-sm text-gray-700 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                Righe: <b>{items.length}</b>
              </div>
              <div>
                Totale quantità: <b>{itemsTotals.totQty}</b> — Totale valore: <b>{formatEUR(itemsTotals.totValue)}</b>
              </div>
            </div>
          )}

          {itemsMsg && <div className="mt-3 rounded-xl border bg-white p-3 text-sm">{itemsMsg}</div>}

          <div className="mt-4">
            {itemsLoading ? (
              <div className="text-sm text-gray-600">Caricamento...</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-gray-600">Nessun articolo. Importa un Excel o seleziona un deposito.</div>
            ) : (
              <div className="overflow-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2 border-b">Codice import</th>
                      <th className="text-left p-2 border-b">Descr. file</th>
                      <th className="text-left p-2 border-b">Anagrafica code</th>
                      <th className="text-left p-2 border-b">Descrizione</th>
                      <th className="text-right p-2 border-b">Stock</th>
                      <th className="text-right p-2 border-b">Prezzo</th>
                      <th className="text-right p-2 border-b">Valore</th>
                      <th className="text-left p-2 border-b">Storico</th>
                      <th className="text-left p-2 border-b">Categoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                        <td className="p-2 border-b font-mono">{r.imported_code}</td>
                        <td className="p-2 border-b">{r.note_description ?? ""}</td>
                        <td className="p-2 border-b font-mono">{r.items?.code ?? ""}</td>
                        <td className="p-2 border-b">{r.items?.description ?? ""}</td>
                        <td className="p-2 border-b text-right">{Number(r.stock_qty ?? 0)}</td>
                        <td className="p-2 border-b text-right font-mono">{formatEUR(r.items?.prezzo_vendita_eur ?? 0)}</td>
                        <td className="p-2 border-b text-right font-mono">{formatEUR(computeRowValueEUR(r))}</td>
                        <td className="p-2 border-b">
                          {r.item_id ? (
                            <Link
                              className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                              href={`/admin/deposits/item-history?pv_id=${encodeURIComponent(pvId)}&item_id=${encodeURIComponent(r.item_id)}`}
                            >
                              Apri
                            </Link>
                          ) : (
                            ""
                          )}
                        </td>
                        <td className="p-2 border-b">{r.items?.category ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}


