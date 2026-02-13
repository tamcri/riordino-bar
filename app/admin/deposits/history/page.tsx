"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PV = { id: string; code: string; name: string };
type Deposit = { id: string; pv_id: string; code: string; name: string | null };

type DepositInventory = {
  id: string;
  deposit_id: string;
  pv_id: string;
  inventory_date: string; // YYYY-MM-DD
  operator_name: string | null;
  notes: string | null;
  created_at: string;

  // ✅ nuovi campi (se include_totals=1)
  tot_qty?: number;
  tot_value_eur?: number;
};

function fmtDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

function fmtEur(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(v);
  } catch {
    return `${v.toFixed(2)} €`;
  }
}

export default function AdminDepositInventoriesHistoryPage() {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState("");

  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositId, setDepositId] = useState("");

  const [inventories, setInventories] = useState<DepositInventory[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedPV = useMemo(() => pvs.find((p) => p.id === pvId) || null, [pvs, pvId]);

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    const list = (json?.pvs ?? json?.rows) ?? [];
    setPvs(Array.isArray(list) ? list : []);
  }

  async function loadDeposits(nextPvId: string) {
    setDeposits([]);
    setDepositId("");
    setInventories([]);
    setMsg(null);

    if (!nextPvId) return;

    const res = await fetch(`/api/deposits/list?pv_id=${encodeURIComponent(nextPvId)}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "Errore caricamento depositi");
      return;
    }

    setDeposits(Array.isArray(json.deposits) ? json.deposits : []);
  }

  async function loadHistory(nextDepositId: string) {
    setInventories([]);
    setMsg(null);

    if (!nextDepositId) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/deposit-inventories/list?deposit_id=${encodeURIComponent(nextDepositId)}&include_totals=1`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore caricamento storico inventari deposito");
        return;
      }

      setInventories(Array.isArray(json.inventories) ? json.inventories : []);
    } finally {
      setLoading(false);
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
    loadHistory(depositId).catch(() => null);
  }, [depositId]);

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Storico Inventari Deposito</h1>
            <p className="text-gray-600 mt-1">Lista inventari salvati per ogni deposito + totali (Qta e Valore €).</p>
          </div>

          <div className="flex gap-2">
            <Link href="/admin/deposits" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
              ← Depositi
            </Link>
          </div>
        </div>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Selezione</h2>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2">Punto Vendita</label>
              <select className="w-full rounded-xl border p-3 bg-white" value={pvId} onChange={(e) => setPvId(e.target.value)}>
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
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Inventari</h2>

          {msg && <div className="mt-3 rounded-xl border bg-white p-3 text-sm">{msg}</div>}

          <div className="mt-4">
            {loading ? (
              <div className="text-sm text-gray-600">Caricamento...</div>
            ) : inventories.length === 0 ? (
              <div className="text-sm text-gray-600">Nessun inventario trovato per questo deposito.</div>
            ) : (
              <div className="overflow-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2 border-b">Data inventario</th>
                      <th className="text-left p-2 border-b">Operatore</th>
                      <th className="text-left p-2 border-b">Creato</th>
                      <th className="text-right p-2 border-b">Tot. Qta</th>
                      <th className="text-right p-2 border-b">Tot. Valore</th>
                      <th className="text-left p-2 border-b">Note</th>
                      <th className="text-right p-2 border-b">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventories.map((inv) => (
                      <tr key={inv.id} className="odd:bg-white even:bg-gray-50">
                        <td className="p-2 border-b">{inv.inventory_date}</td>
                        <td className="p-2 border-b">{inv.operator_name ?? ""}</td>
                        <td className="p-2 border-b">{fmtDateTime(inv.created_at)}</td>
                        <td className="p-2 border-b text-right">{Number(inv.tot_qty ?? 0)}</td>
                        <td className="p-2 border-b text-right">{fmtEur(Number(inv.tot_value_eur ?? 0))}</td>
                        <td className="p-2 border-b">{inv.notes ?? ""}</td>
                        <td className="p-2 border-b text-right">
                          <Link
                            href={`/admin/deposits/history/${inv.id}`}
                            className="rounded-lg border bg-white px-3 py-2 hover:bg-gray-50 inline-block"
                          >
                            Dettaglio
                          </Link>
                        </td>
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

