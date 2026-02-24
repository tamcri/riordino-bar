"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Point = {
  inventory_date: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
};

type ItemMeta = {
  id: string;
  code: string;
  description: string;
  um: string | null;
  prezzo_vendita_eur: number | null;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, deltaDays: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatEUR(n: any) {
  const x = Number(n);
  const v = Number.isFinite(x) ? x : 0;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(v);
}

function normUm(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

/**
 * Sceglie la serie principale da graficare.
 * Regole conservative (per evitare bug):
 * - UM=KG: grafico su GR (qty_gr)
 * - Se qty_ml > 0: grafico su ML
 * - Altrimenti: grafico su qty
 */
function pickSeriesValue(item: ItemMeta, p: Point): { value: number; unit: string } {
  const um = normUm(item.um);
  if (um === "KG") return { value: Number(p.qty_gr || 0), unit: "GR" };
  if ((Number(p.qty_ml) || 0) > 0) return { value: Number(p.qty_ml || 0), unit: "ML" };
  return { value: Number(p.qty || 0), unit: um || "PZ" };
}

function computeValueEUR(item: ItemMeta, seriesValue: number, unit: string) {
  const price = Number(item.prezzo_vendita_eur ?? 0);
  if (!Number.isFinite(price) || price <= 0) return 0;
  const u = normUm(unit);
  if (u === "GR") return (seriesValue / 1000) * price;
  return seriesValue * price;
}

function buildPolyline(points: { x: number; y: number }[]) {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

export default function ItemHistoryClient() {
  const sp = useSearchParams();
  const pv_id = sp.get("pv_id") || "";
  const item_id = sp.get("item_id") || "";

  const [from, setFrom] = useState(() => addDaysISO(todayISO(), -30));
  const [to, setTo] = useState(() => todayISO());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [item, setItem] = useState<ItemMeta | null>(null);
  const [baseline, setBaseline] = useState<Point | null>(null);
  const [last, setLast] = useState<Point | null>(null);
  const [points, setPoints] = useState<Point[]>([]);

  async function load() {
    setError(null);
    if (!pv_id || !item_id) {
      setError("pv_id o item_id mancanti.");
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ pv_id, item_id, from, to });
      const res = await fetch(`/api/items/stock-history?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Errore caricamento storico");
        return;
      }

      setItem(json.item || null);
      setBaseline(json.baseline || null);
      setLast(json.last || null);
      setPoints(Array.isArray(json.points) ? json.points : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    if (!item) return null;
    const b = baseline;
    const l = last;

    const unitFallback = pickSeriesValue(item, { inventory_date: "", qty: 0, qty_ml: 0, qty_gr: 0 }).unit;
    const bVal = b ? pickSeriesValue(item, b) : { value: 0, unit: unitFallback };
    const lVal = l ? pickSeriesValue(item, l) : { value: 0, unit: bVal.unit };
    const diff = (lVal.value || 0) - (bVal.value || 0);

    const valueFrom = computeValueEUR(item, bVal.value, bVal.unit);
    const valueTo = computeValueEUR(item, lVal.value, lVal.unit);
    const valueDiff = valueTo - valueFrom;

    return {
      unit: lVal.unit || bVal.unit,
      from: b?.inventory_date ?? null,
      to: l?.inventory_date ?? null,
      qty_from: bVal.value,
      qty_to: lVal.value,
      diff,
      value_from: valueFrom,
      value_to: valueTo,
      value_diff: valueDiff,
    };
  }, [item, baseline, last]);

  const chart = useMemo(() => {
    if (!item) return null;

    const series = points
      .map((p) => ({ date: p.inventory_date, ...pickSeriesValue(item, p) }))
      .filter((p) => typeof p.value === "number");

    const w = 700;
    const h = 220;
    const padX = 24;
    const padY = 18;

    if (series.length === 0) {
      return {
        unit: pickSeriesValue(item, { inventory_date: "", qty: 0, qty_ml: 0, qty_gr: 0 }).unit,
        polyline: "",
        pts: [],
        w,
        h,
        ticks: [],
        minV: 0,
        maxV: 0,
      };
    }

    const values = series.map((s) => s.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const span = Math.max(1, maxV - minV);

    const pts = series.map((s, i) => {
      const x = padX + (i * (w - padX * 2)) / Math.max(1, series.length - 1);
      const y = padY + (1 - (s.value - minV) / span) * (h - padY * 2);
      return { x, y };
    });

    const step = Math.max(1, Math.ceil(series.length / 6));
    const ticks = series
      .map((s, i) => ({ i, date: s.date }))
      .filter((t, idx) => idx === 0 || idx === series.length - 1 || idx % step === 0)
      .slice(0, 6);

    return {
      unit: series[series.length - 1].unit,
      polyline: buildPolyline(pts),
      pts,
      w,
      h,
      ticks,
      minV,
      maxV,
    };
  }, [item, points]);

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Storico giacenze prodotto</h1>
            <p className="text-sm text-gray-600 mt-1">
              Punti di inventario nel tempo. Se non inventari un giorno, non esiste il punto.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/deposits" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
              ← Depositi
            </Link>
            <Link href="/admin/deposits/inventory" className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
              Inventario Deposito
            </Link>
          </div>
        </div>

        <section className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Articolo</div>
              <div className="text-xs text-gray-600">{item ? `${item.code} — ${item.description}` : "—"}</div>
            </div>
            <div className="flex flex-col md:flex-row gap-2 items-start md:items-center">
              <div className="text-xs text-gray-600">
                PV: <span className="font-mono">{pv_id || "—"}</span>
              </div>
              <div className="text-xs text-gray-600">
                Item: <span className="font-mono">{item_id || "—"}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Da</label>
              <input
                type="date"
                className="w-full rounded-xl border p-3"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">A</label>
              <input
                type="date"
                className="w-full rounded-xl border p-3"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="rounded-xl bg-black text-white px-4 py-3 disabled:opacity-60"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Carico..." : "Aggiorna"}
            </button>
          </div>

          {error && <div className="rounded-xl border bg-white p-3 text-sm">{error}</div>}
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Riepilogo</h2>
          {!summary ? (
            <p className="text-sm text-gray-600 mt-2">Seleziona un periodo e premi Aggiorna.</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-xl border p-3 bg-white">
                <div className="text-xs text-gray-600">Baseline (≤ Da)</div>
                <div className="text-lg font-semibold">
                  {summary.qty_from} {summary.unit}
                </div>
                <div className="text-xs text-gray-500">Data: {summary.from ?? "—"}</div>
              </div>
              <div className="rounded-xl border p-3 bg-white">
                <div className="text-xs text-gray-600">Ultimo (≤ A)</div>
                <div className="text-lg font-semibold">
                  {summary.qty_to} {summary.unit}
                </div>
                <div className="text-xs text-gray-500">Data: {summary.to ?? "—"}</div>
              </div>
              <div className="rounded-xl border p-3 bg-white">
                <div className="text-xs text-gray-600">Differenza</div>
                <div className="text-lg font-semibold">
                  {summary.diff >= 0 ? "+" : ""}
                  {summary.diff} {summary.unit}
                </div>
                <div className="text-xs text-gray-500">(Ultimo - Baseline)</div>
              </div>
              <div className="rounded-xl border p-3 bg-white">
                <div className="text-xs text-gray-600">Valore (stima)</div>
                <div className="text-lg font-semibold">{formatEUR(summary.value_to)}</div>
                <div className="text-xs text-gray-500">Δ {formatEUR(summary.value_diff)}</div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Grafico</h2>
          <p className="text-sm text-gray-600 mt-1">Linea semplice (SVG). Se vuoi, poi lo rendiamo più “figo”.</p>

          {!item ? (
            <div className="text-sm text-gray-600 mt-3">—</div>
          ) : points.length === 0 ? (
            <div className="text-sm text-gray-600 mt-3">Nessun punto nel periodo selezionato.</div>
          ) : (
            <div className="mt-3 overflow-auto">
              <svg width={chart?.w ?? 700} height={chart?.h ?? 220} className="rounded-xl border bg-white">
                <line
                  x1={24}
                  y1={(chart?.h ?? 220) - 18}
                  x2={(chart?.w ?? 700) - 24}
                  y2={(chart?.h ?? 220) - 18}
                  stroke="#e5e7eb"
                />
                <line x1={24} y1={18} x2={24} y2={(chart?.h ?? 220) - 18} stroke="#e5e7eb" />
                <polyline fill="none" stroke="#111827" strokeWidth="2" points={chart?.polyline ?? ""} />
                {(chart?.pts ?? []).map((p, idx) => (
                  <circle key={idx} cx={p.x} cy={p.y} r={3} fill="#111827" />
                ))}
                {(chart?.ticks ?? []).map((t: any) => {
                  const x = 24 + (t.i * ((chart?.w ?? 700) - 24 * 2)) / Math.max(1, points.length - 1);
                  return (
                    <text key={t.i} x={x} y={(chart?.h ?? 220) - 4} fontSize="10" textAnchor="middle" fill="#6b7280">
                      {t.date}
                    </text>
                  );
                })}
              </svg>
              <div className="text-xs text-gray-600 mt-2">
                Unità grafico: <b>{chart?.unit}</b>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Dettaglio punti</h2>
          {points.length === 0 ? (
            <div className="text-sm text-gray-600 mt-3">—</div>
          ) : (
            <div className="mt-3 overflow-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-2 border-b">Data</th>
                    <th className="text-right p-2 border-b">QTY</th>
                    <th className="text-right p-2 border-b">ML</th>
                    <th className="text-right p-2 border-b">GR</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.inventory_date} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2 border-b font-mono">{p.inventory_date}</td>
                      <td className="p-2 border-b text-right">{Number(p.qty || 0)}</td>
                      <td className="p-2 border-b text-right">{Number(p.qty_ml || 0)}</td>
                      <td className="p-2 border-b text-right">{Number(p.qty_gr || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}