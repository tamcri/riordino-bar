"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type InventoryHeader = {
  id: string;
  deposit_id: string;
  pv_id: string;
  inventory_date: string;
  operator_name: string | null;
  notes: string | null;
  created_at: string;
};

type Row = {
  id: string;
  inventory_id: string;
  item_id: string;
  qty: number;
  items?: any; // items.code, items.description, items.prezzo_vendita_eur
};

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("it-IT");
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

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function AdminDepositInventoryDetailPage() {
  const params = useParams();
  const inventory_id = String((params as any)?.inventory_id ?? "");

  const [header, setHeader] = useState<InventoryHeader | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [prevHeader, setPrevHeader] = useState<InventoryHeader | null>(null);
  const [prevRows, setPrevRows] = useState<Row[]>([]);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const prevMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of prevRows) m.set(r.item_id, toNum(r.qty));
    return m;
  }, [prevRows]);

  const diffStats = useMemo(() => {
    let changed = 0;
    let same = 0;
    let inc = 0;
    let dec = 0;

    for (const r of rows) {
      const cur = toNum(r.qty);
      const prev = prevMap.get(r.item_id) ?? 0;
      if (cur === prev) same++;
      else {
        changed++;
        if (cur > prev) inc++;
        else dec++;
      }
    }
    return { changed, same, inc, dec, total: rows.length };
  }, [rows, prevMap]);

  const totals = useMemo(() => {
    let totQty = 0;
    let totValue = 0;

    for (const r of rows) {
      const qty = toNum(r.qty);
      const price = toNum(r.items?.prezzo_vendita_eur);
      totQty += qty;
      totValue += qty * price;
    }

    return { totQty, totValue };
  }, [rows]);

  const totalsPrev = useMemo(() => {
    if (!prevHeader) return { totQtyPrev: 0, totValuePrev: 0, totDiffValue: 0 };

    let totQtyPrev = 0;
    let totValuePrev = 0;
    let totDiffValue = 0;

    for (const r of rows) {
      const price = toNum(r.items?.prezzo_vendita_eur);
      const curQty = toNum(r.qty);
      const prevQty = prevMap.get(r.item_id) ?? 0;

      totQtyPrev += prevQty;
      totValuePrev += prevQty * price;
      totDiffValue += (curQty - prevQty) * price;
    }

    return { totQtyPrev, totValuePrev, totDiffValue };
  }, [rows, prevHeader, prevMap]);

  async function loadDetail(invId: string) {
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/deposit-inventories/rows?inventory_id=${encodeURIComponent(invId)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore caricamento dettaglio inventario");
        return;
      }

      setHeader(json.inventory || null);
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } finally {
      setLoading(false);
    }
  }

  async function loadPreviousIfAny(h: InventoryHeader) {
    setPrevHeader(null);
    setPrevRows([]);

    const resList = await fetch(`/api/deposit-inventories/list?deposit_id=${encodeURIComponent(h.deposit_id)}`, {
      cache: "no-store",
    });
    const jsonList = await resList.json().catch(() => null);
    if (!resList.ok || !jsonList?.ok) return;

    const list: InventoryHeader[] = Array.isArray(jsonList.inventories) ? jsonList.inventories : [];
    const idx = list.findIndex((x) => x.id === h.id);
    if (idx < 0) return;

    const prev = list[idx + 1];
    if (!prev) return;

    const resPrev = await fetch(`/api/deposit-inventories/rows?inventory_id=${encodeURIComponent(prev.id)}`, {
      cache: "no-store",
    });
    const jsonPrev = await resPrev.json().catch(() => null);
    if (!resPrev.ok || !jsonPrev?.ok) return;

    setPrevHeader(jsonPrev.inventory || prev);
    setPrevRows(Array.isArray(jsonPrev.rows) ? jsonPrev.rows : []);
  }

  useEffect(() => {
    if (!inventory_id) return;
    loadDetail(inventory_id).catch(() => null);
  }, [inventory_id]);

  useEffect(() => {
    if (!header) return;
    loadPreviousIfAny(header).catch(() => null);
  }, [header?.id]);

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dettaglio Inventario Deposito</h1>
            <p className="text-gray-600 mt-1">
              Snapshot righe + valore € + confronto col precedente (anche Diff €).
            </p>
          </div>

          <div className="flex gap-2">
            <Link href="/admin/deposits/history" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
              ← Storico
            </Link>
            <Link href="/admin/deposits" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
              Depositi
            </Link>
          </div>
        </div>

        {msg && <div className="rounded-xl border bg-white p-3 text-sm">{msg}</div>}

        <section className="rounded-2xl border bg-white p-4">
          {loading || !header ? (
            <div className="text-sm text-gray-600">Caricamento intestazione...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border p-3">
                <div><b>Data inventario:</b> {header.inventory_date}</div>
                <div><b>Operatore:</b> {header.operator_name ?? ""}</div>
                <div><b>Creato:</b> {fmtDateTime(header.created_at)}</div>
                <div><b>Note:</b> {header.notes ?? ""}</div>
              </div>

              <div className="rounded-xl border p-3 space-y-2">
                <div>
                  <b>Totale quantità:</b> {totals.totQty}
                </div>
                <div>
                  <b>Totale valore:</b> {fmtEur(totals.totValue)}
                </div>

                <div className="pt-2 border-t">
                  <div><b>Confronto precedente:</b> {prevHeader ? "SÌ" : "NO"}</div>

                  {prevHeader ? (
                    <>
                      <div>
                        <b>Precedente:</b> {prevHeader.inventory_date} ({fmtDateTime(prevHeader.created_at)})
                      </div>
                      <div>
                        <b>Righe:</b> {diffStats.total} — <b>Uguali:</b> {diffStats.same} — <b>Diverse:</b> {diffStats.changed}
                      </div>
                      <div>
                        <b>Aumentate:</b> {diffStats.inc} — <b>Diminuite:</b> {diffStats.dec}
                      </div>

                      <div className="mt-2 rounded-xl border p-2 bg-gray-50">
                        <div><b>Totale prec (Qta):</b> {totalsPrev.totQtyPrev}</div>
                        <div><b>Totale prec (€):</b> {fmtEur(totalsPrev.totValuePrev)}</div>
                        <div><b>Diff totale (€):</b> {fmtEur(totalsPrev.totDiffValue)}</div>
                      </div>
                    </>
                  ) : (
                    <div className="text-gray-600">Non esiste un inventario precedente per questo deposito.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Righe inventario</h2>
          <p className="text-sm text-gray-600 mt-1">
            Se c’è un precedente: oltre a Qta prec/Diff, vedi anche <b>Valore prec</b> e <b>Diff €</b>.
          </p>

          <div className="mt-4">
            {rows.length === 0 ? (
              <div className="text-sm text-gray-600">Nessuna riga.</div>
            ) : (
              <div className="overflow-auto rounded-xl border max-h-[600px]">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2 border-b">Code</th>
                      <th className="text-left p-2 border-b">Descrizione</th>
                      <th className="text-right p-2 border-b">Qta</th>
                      <th className="text-right p-2 border-b">Prezzo</th>
                      <th className="text-right p-2 border-b">Valore</th>

                      <th className="text-right p-2 border-b">Qta prec</th>
                      <th className="text-right p-2 border-b">Diff</th>
                      <th className="text-right p-2 border-b">Valore prec</th>
                      <th className="text-right p-2 border-b">Diff €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const qty = toNum(r.qty);
                      const price = toNum(r.items?.prezzo_vendita_eur);
                      const value = qty * price;

                      const hasPrev = !!prevHeader;
                      const prevQty = prevMap.get(r.item_id) ?? 0;
                      const diffQty = qty - prevQty;

                      const prevValue = prevQty * price;
                      const diffEur = diffQty * price;

                      return (
                        <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                          <td className="p-2 border-b font-mono">{r.items?.code ?? ""}</td>
                          <td className="p-2 border-b">{r.items?.description ?? ""}</td>
                          <td className="p-2 border-b text-right">{qty}</td>
                          <td className="p-2 border-b text-right">{fmtEur(price)}</td>
                          <td className="p-2 border-b text-right">{fmtEur(value)}</td>

                          <td className="p-2 border-b text-right">{hasPrev ? prevQty : ""}</td>
                          <td className="p-2 border-b text-right">{hasPrev ? diffQty : ""}</td>
                          <td className="p-2 border-b text-right">{hasPrev ? fmtEur(prevValue) : ""}</td>
                          <td className="p-2 border-b text-right">{hasPrev ? fmtEur(diffEur) : ""}</td>
                        </tr>
                      );
                    })}
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


