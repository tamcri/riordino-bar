"use client";

import { useEffect, useState } from "react";

type Row = {
  code: string;
  description: string;
  stock_qty: number;

  purchase_price: number | null;
  vat_rate: number | null;
  purchase_price_vat: number | null;

  valore_imp: number;
  valore_ivato: number;
};

function formatEuro(v: number | null | undefined) {
  if (v == null) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(2)} €`;
}

function formatVat(v: number | null | undefined) {
  if (v == null) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n}%`;
}

export default function WarehouseValueClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/warehouse-value");
      const json = await res.json();
      setRows(json.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const sortedRows = [...rows].sort(
    (a, b) => b.valore_ivato - a.valore_ivato
  );

  const totaleImp = sortedRows.reduce(
    (sum, r) => sum + (r.valore_imp || 0),
    0
  );

  const totaleIvato = sortedRows.reduce(
    (sum, r) => sum + (r.valore_ivato || 0),
    0
  );

  return (
    <div className="max-w-[1400px] mx-auto space-y-6 py-6">
      <div className="flex justify-between items-center">
        <div className="text-xl font-semibold">Valore Magazzino</div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.history.back()}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ← Torna
          </button>

          <button
            onClick={() => window.print()}
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Stampa
          </button>
        </div>
      </div>

      <div className="overflow-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-3">Codice</th>
              <th className="p-3">Descrizione</th>
              <th className="p-3 text-right">Qtà</th>

              <th className="p-3 text-right">Prezzo A. Imp</th>
              <th className="p-3 text-right">IVA %</th>
              <th className="p-3 text-right">Prezzo A. Netto</th>

              <th className="p-3 text-right">Valore Imp</th>
              <th className="p-3 text-right">Valore Ivato</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-4 text-center">
                  Caricamento...
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-4 text-center">
                  Nessun dato
                </td>
              </tr>
            ) : (
              sortedRows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-3">{r.code}</td>
                  <td className="p-3">{r.description}</td>
                  <td className="p-3 text-right">{r.stock_qty}</td>

                  <td className="p-3 text-right">
                    {formatEuro(r.purchase_price)}
                  </td>

                  <td className="p-3 text-right">
                    {formatVat(r.vat_rate)}
                  </td>

                  <td className="p-3 text-right">
                    {formatEuro(r.purchase_price_vat)}
                  </td>

                  <td className="p-3 text-right">
                    {formatEuro(r.valore_imp)}
                  </td>

                  <td className="p-3 text-right font-semibold">
                    {formatEuro(r.valore_ivato)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-4">
        <div className="rounded-xl border px-4 py-3 text-lg font-semibold">
          Totale Imp: {formatEuro(totaleImp)}
        </div>

        <div className="rounded-xl border px-4 py-3 text-lg font-semibold">
          Totale Ivato: {formatEuro(totaleIvato)}
        </div>
      </div>

      <style jsx global>{`
        @media print {
          button {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}