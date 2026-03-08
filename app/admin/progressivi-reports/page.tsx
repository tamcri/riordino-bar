"use client";

import { useEffect, useMemo, useState } from "react";

type PV = { id: string; code: string; name: string };

type InventoryGroup = {
  key: string;
  header_id?: string | null;
  id?: string | null;
  pv_id: string;
  pv_code: string;
  pv_name: string;
  category_id: string | null;
  category_name: string;
  subcategory_id: string | null;
  subcategory_name: string | null;
  inventory_date: string; // YYYY-MM-DD
  label?: string | null;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateIT(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function buildReportUrl(g: InventoryGroup) {
  const qs = new URLSearchParams();
  if (g.header_id || g.id) qs.set("header_id", g.header_id || g.id || "");
  else {
    qs.set("pv_id", g.pv_id);
    qs.set("inventory_date", g.inventory_date);
    qs.set("category_id", g.category_id ?? "null");
    if (g.subcategory_id) qs.set("subcategory_id", g.subcategory_id);
  }
  return `/admin/progressivi-reports/view?${qs.toString()}`;
}

export default function ProgressiviReportsPage() {
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvId, setPvId] = useState<string>("");

  const [dateFrom, setDateFrom] = useState<string>("2026-02-01");
  const [dateTo, setDateTo] = useState<string>(todayISO());

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<InventoryGroup[]>([]);


  const pvLabel = useMemo(() => {
    const pv = pvs.find((x) => x.id === pvId);
    if (!pv) return "";
    return pv.name ? `${pv.code} — ${pv.name}` : pv.code;
  }, [pvs, pvId]);

  // ✅ CHECK RUOLO: solo admin / amministrativo
  // Usa la route già esistente: /api/me
  useEffect(() => {
    async function checkRole() {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (!res.ok) {
          // non loggato o sessione non valida
          window.location.href = "/";
          return;
        }

        const json = await res.json().catch(() => null);
        const role = json?.role as string | undefined;

        if (!["admin", "amministrativo"].includes(role ?? "")) {
          // PV o ruolo altro => fuori
          window.location.href = "/pv/inventario";
          return;
        }
      } catch {
        window.location.href = "/";
      }
    }

    checkRole();
  }, []);

  async function loadPvs() {
    setMsg(null);
    try {
      const res = await fetch("/api/pvs/list", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      const list = (json?.pvs ?? json?.rows ?? []) as PV[];
      setPvs(Array.isArray(list) ? list : []);
      if (!pvId && list?.[0]?.id) setPvId(list[0].id);
    } catch {
      setMsg("Errore caricamento PV.");
    }
  }

  async function loadInventories() {
    if (!pvId) return;

    setLoading(true);
    setMsg(null);

    try {
      const qs = new URLSearchParams();
      qs.set("pv_id", pvId);
      qs.set("date_from", dateFrom);
      qs.set("date_to", dateTo);

      // NOTA: non metto category_id qui apposta -> voglio tutte le modalità (anche Rapido)
      const res = await fetch(`/api/inventories/list?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Errore caricamento storico inventari");
      }

      const list = (json?.rows ?? json?.groups ?? []) as InventoryGroup[];
      setRows(Array.isArray(list) ? list : []);
      if (!list?.length) setMsg("Nessun inventario trovato nell’intervallo selezionato.");
    } catch (e: any) {
      setMsg(e?.message || "Errore caricamento inventari.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPvs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pvId) loadInventories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-xl font-semibold">Report Progressivi</div>
        <div className="text-sm text-gray-600 mt-1">
          Qui puoi risalire ai report e riscaricarli quando vuoi (sono generati al volo).
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 grid gap-3 md:grid-cols-4">
        <div>
          <label className="block text-sm font-medium mb-1">PV</label>
          <select className="w-full rounded-xl border p-2" value={pvId} onChange={(e) => setPvId(e.target.value)}>
            {pvs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          {pvLabel ? <div className="text-xs text-gray-500 mt-1">{pvLabel}</div> : null}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Dal</label>
          <input
            className="w-full rounded-xl border p-2"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Al</label>
          <input
            className="w-full rounded-xl border p-2"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <div className="flex items-end">
          <button
            className="w-full rounded-xl bg-slate-900 text-white px-4 py-2 hover:bg-slate-800 disabled:opacity-60"
            disabled={!pvId || loading}
            onClick={loadInventories}
          >
            {loading ? "Carico..." : "Aggiorna"}
          </button>
        </div>
      </div>

      {msg && <div className="text-sm text-gray-700">{msg}</div>}

      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 w-36">Data</th>
              <th className="text-left p-3">Categoria</th>
              <th className="text-left p-3">Sottocategoria</th>
              <th className="text-left p-3">Label</th>
              <th className="text-left p-3 w-56">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key} className="border-t">
                <td className="p-3 font-medium">{formatDateIT(g.inventory_date)}</td>
                <td className="p-3">{g.category_name}</td>
                <td className="p-3">{g.subcategory_name ?? "—"}</td>
                <td className="p-3">{g.label ?? "—"}</td>
                <td className="p-3">
                  <button
                    className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                    onClick={() => window.open(buildReportUrl(g), "_blank")}
                    title="Scarica Report Progressivi"
                  >
                    Scarica report
                  </button>
                </td>
              </tr>
            ))}

            {!rows.length && !loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={5}>
                  Nessun dato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        Nota: il report ora usa la coppia inventario corrente / inventario precedente con stessa label. Il file Excel viene generato al volo dalla vista report.
      </div>
    </div>
  );
}