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



function formatEUR(n: any) {
  const x = Number(n);
  const v = Number.isFinite(x) ? x : 0;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(v);
}

function normUm(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function isLiquid(r: DepositItemRow) {
  const v = Number(r.items?.volume_ml_per_unit ?? 0);
  return Number.isFinite(v) && v > 0;
}

function isKg(r: DepositItemRow) {
  return normUm(r.items?.um) === "KG";
}

function formatStock(r: DepositItemRow) {
  const qty = Math.max(0, Math.trunc(Number(r.stock_qty ?? 0) || 0));
  if (isLiquid(r)) return `${qty} ml`;
  if (isKg(r)) return `${qty} gr`;
  return `${qty} pz`;
}

function computeRowValueEUR(r: DepositItemRow) {
  const price = Number(r.items?.prezzo_vendita_eur ?? 0);
  if (!Number.isFinite(price) || price <= 0) return 0;

  const qty = Number(r.stock_qty ?? 0);
  if (!Number.isFinite(qty) || qty <= 0) return 0;

  if (isLiquid(r)) {
    const perUnit = Number(r.items?.volume_ml_per_unit ?? 0);
    if (!Number.isFinite(perUnit) || perUnit <= 0) return 0;
    return (qty / perUnit) * price;
  }

  if (isKg(r)) return (qty / 1000) * price;
  return qty * price;
}

function categoryLabel(r: DepositItemRow) {
  const c = r.items?.categories?.name ?? "";
  const s = r.items?.subcategories?.name ?? "";
  if (c && s) return `${c} / ${s}`;
  return c || s || "";
}

export default function AdminDepositsPage() {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState<string>("");

  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositId, setDepositId] = useState<string>("");
  

  const [items, setItems] = useState<DepositItemRow[]>([]);
  const [itemsMsg, setItemsMsg] = useState<string | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);

  const selectedPV = useMemo(() => pvs.find((p) => p.id === pvId) || null, [pvs, pvId]);
  const selectedDeposit = useMemo(() => deposits.find((d) => d.id === depositId) || null, [deposits, depositId]);

  const itemsTotals = useMemo(() => {
    let totPz = 0;
    let totGr = 0;
    let totMl = 0;
    let totValue = 0;

    for (const r of items) {
      const q = Math.max(0, Math.trunc(Number(r.stock_qty ?? 0) || 0));
      if (isLiquid(r)) totMl += q;
      else if (isKg(r)) totGr += q;
      else totPz += q;
      totValue += computeRowValueEUR(r);
    }

    return { totPz, totGr, totMl, totValue };
  }, [items]);

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    const list = (json?.pvs ?? json?.rows) ?? [];
    setPvs(Array.isArray(list) ? list : []);
  }

  async function loadDeposits(nextPvId: string) {

    setItemsMsg(null);

    setDeposits([]);
    setDepositId("");
    setItems([]);

    if (!nextPvId) return;

    const res = await fetch(`/api/deposits/list?pv_id=${encodeURIComponent(nextPvId)}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setItemsMsg(json?.error || "Errore caricamento depositi");
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


  return (
    <div className="mx-auto max-w-[1600px] p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Depositi (Magazzini)</h1>
        <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href="/admin">
          ← Admin
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Seleziona PV</h2>
          <select className="mt-3 w-full rounded-xl border p-3 bg-white" value={pvId} onChange={(e) => setPvId(e.target.value)}>
            <option value="">— Seleziona —</option>
            {pvs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          {selectedPV && (
            <p className="mt-3 text-sm text-gray-700">
              PV selezionato: <b>{selectedPV.code}</b>
            </p>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Deposito</h2>
          <select
            className="mt-3 w-full rounded-xl border p-3 bg-white"
            value={depositId}
            onChange={(e) => setDepositId(e.target.value)}
            disabled={!pvId || deposits.length === 0}
          >
            <option value="">— Seleziona —</option>
            {deposits.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name || ""}
              </option>
            ))}
          </select>
          {selectedDeposit && (
            <p className="mt-3 text-sm text-gray-700">
              Deposito selezionato: <b>{selectedDeposit.code}</b>
            </p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border bg-white p-4">
        <div className="flex items-start justify-between gap-3 flex-col lg:flex-row">
          <div>
            <h2 className="text-lg font-semibold">Articoli nel deposito</h2>
            <p className="text-sm text-gray-600 mt-1">Stock con unità corretta (pz / gr / ml) + valore (quando disponibile).</p>
          </div>

          {items.length > 0 && !itemsLoading && (
            <div className="text-sm text-gray-700 flex flex-wrap gap-3 lg:justify-end">
              <span>
                Righe: <b>{items.length}</b>
              </span>
              <span>
                Tot PZ: <b>{itemsTotals.totPz}</b>
              </span>
              <span>
                Tot GR: <b>{itemsTotals.totGr}</b>
              </span>
              <span>
                Tot ML: <b>{itemsTotals.totMl}</b>
              </span>
              <span>
                Tot valore: <b>{formatEUR(itemsTotals.totValue)}</b>
              </span>
            </div>
          )}
        </div>

        {itemsMsg && <div className="mt-3 rounded-xl border bg-white p-3 text-sm">{itemsMsg}</div>}

        <div className="mt-4">
          {itemsLoading ? (
            <div className="text-sm text-gray-600">Caricamento...</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-gray-600">Nessun articolo. Seleziona un deposito.</div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <div className="max-h-[72vh] overflow-auto">
                <table className="min-w-[1500px] w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0 z-10">
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
                        <td className="p-2 border-b font-mono whitespace-nowrap">{r.imported_code}</td>
                        <td className="p-2 border-b">{r.note_description ?? ""}</td>
                        <td className="p-2 border-b font-mono whitespace-nowrap">{r.items?.code ?? ""}</td>
                        <td className="p-2 border-b">{r.items?.description ?? ""}</td>
                        <td className="p-2 border-b text-right whitespace-nowrap">{formatStock(r)}</td>
                        <td className="p-2 border-b text-right font-mono whitespace-nowrap">{formatEUR(r.items?.prezzo_vendita_eur ?? 0)}</td>
                        <td className="p-2 border-b text-right font-mono whitespace-nowrap">{formatEUR(computeRowValueEUR(r))}</td>
                        <td className="p-2 border-b">
                          {r.item_id ? (
                            <Link
                              className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50 whitespace-nowrap inline-block"
                              href={`/admin/deposits/item-history?pv_id=${encodeURIComponent(pvId)}&item_id=${encodeURIComponent(r.item_id)}`}
                            >
                              Apri
                            </Link>
                          ) : (
                            ""
                          )}
                        </td>
                        <td className="p-2 border-b">{categoryLabel(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}


