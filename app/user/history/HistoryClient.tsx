// app/user/history/HistoryClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Row = {
  id: string;
  created_at: string;
  created_by_username: string | null;
  created_by_role: string | null;
  pv_label: string;
  pv_id: string | null;
  type: "TAB" | "GV";

  weeks: number;
  days?: number | null;

  tot_rows: number | null;
  tot_order_qty: number | null;
  tot_weight_kg: number | null;
  tot_value_eur: number | null;
};

type PV = { id: string; code: string; name: string };

type MeResponse = {
  ok: boolean;
  username?: string;
  role?: "admin" | "amministrativo" | "punto_vendita";
  pv_id?: string | null;
  error?: string;
};

type PreviewMeta = {
  id: string;
  type: "TAB" | "GV";
  pv_label: string | null;
  weeks: number | null;
  days?: number | null;

  tot_rows?: number | null;
  tot_order_qty?: number | null;
  tot_weight_kg?: number | null;
  tot_value_eur?: number | null;

  created_at?: string | null;
  created_by_username?: string | null;

  preview_count?: number | null;
  totals_by_item_count?: number | null;
};

type PreviewRow = Record<string, any>;
type TotalsByItemRow = Record<string, any>;

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("it-IT");
}

function normPvLabel(s: string) {
  return (s || "")
    .toUpperCase()
    .trim()
    .replace(/[-–—]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

const PV_PAT_ALLOWED_NORM = new Set(
  [
    "A3 FLACCA",
    "C3 VELLETRI",
    "C7 ROVERETO",
    "C8 RIMINI",
    "C9 PERUGIA",
    "D1 VIAREGGIO",
    "D2 LATINA",
  ].map(normPvLabel)
);

function periodoLabel(r: Row) {
  const d = Number(r.days);
  if (Number.isFinite(d) && d > 0) return `${d} giorno/i`;
  return `${r.weeks} sett.`;
}

function n0(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function eur(v: any) {
  const n = n0(v);
  return `€ ${n.toFixed(2)}`;
}

function kg1(v: any) {
  const n = n0(v);
  return n.toFixed(1);
}

// label colonne più leggibili
function prettyCol(k: string) {
  const m: Record<string, string> = {
    codArticolo: "Cod. Articolo",
    descrizione: "Descrizione",
    qtaVenduta: "Qtà Venduta",
    valoreVenduto: "Val. Venduto",
    giacenza: "Giacenza",
    qtaTeorica: "Qtà Teorica",
    conf_da: "Conf. da",
    qtaOrdine: "Qtà Ordine",
    pesoKg: "Peso Kg",
    valoreDaOrdinare: "Val. da Ordinare",
  };
  return m[k] || k;
}

function formatCell(key: string, value: any) {
  if (value == null) return "";

  if (key === "valoreVenduto" || key === "valoreDaOrdinare") return eur(value);
  if (key === "pesoKg") return kg1(value);
  if (
    key === "qtaVenduta" ||
    key === "giacenza" ||
    key === "qtaTeorica" ||
    key === "conf_da" ||
    key === "qtaOrdine"
  ) {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.trunc(n)) : String(value);
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  return String(value);
}

type MenuPos = { top: number; left: number; width?: number };

export default function HistoryClient() {
  const [typeFilter, setTypeFilter] = useState<"ALL" | "TAB" | "GV">("ALL");
  const [pvId, setPvId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [pvs, setPvs] = useState<PV[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [meRole, setMeRole] = useState<MeResponse["role"] | null>(null);

  // preview modal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<PreviewMeta | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [totalsByItem, setTotalsByItem] = useState<TotalsByItemRow[]>([]);

  // ✅ menu “...” in portal
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json: MeResponse = await res.json().catch(() => ({ ok: false }));
        if (res.ok && json?.ok) setMeRole(json.role || null);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/pvs/list");
        const json = await res.json().catch(() => null);
        if (res.ok && json?.ok) setPvs(json.rows || []);
      } catch {}
    })();
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (typeFilter !== "ALL") p.set("type", typeFilter);
    if (pvId) p.set("pvId", pvId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [typeFilter, pvId, from, to]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reorder/history/list${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Errore server (${res.status})`);
      setRows(json?.rows || []);
    } catch (e: any) {
      setError(e?.message || "Errore");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  function reset() {
    setTypeFilter("ALL");
    setPvId("");
    setFrom("");
    setTo("");
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewMeta(null);
    setPreviewRows([]);
    setTotalsByItem([]);
  }

  async function openPreview(r: Row) {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewMeta(null);
    setPreviewRows([]);
    setTotalsByItem([]);

    try {
      const id = encodeURIComponent(r.id);
      const res = await fetch(`/api/reorder/history/${id}/preview`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento anteprima");

      setPreviewMeta(json.meta || null);
      setPreviewRows(Array.isArray(json.rows) ? json.rows : []);
      setTotalsByItem(Array.isArray(json.totals_by_item) ? json.totals_by_item : []);
    } catch (e: any) {
      setPreviewError(e?.message || "Errore anteprima");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function deleteOrder(orderId: string) {
    const ok = confirm("Vuoi eliminare definitivamente questo ordine?");
    if (!ok) return;

    try {
      const res = await fetch(`/api/reorder/history/${encodeURIComponent(orderId)}/delete`, { method: "DELETE" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        alert(json?.error || "Errore eliminazione");
        return;
      }

      setOpenMenuId(null);
      setMenuPos(null);
      await load();
    } catch (e: any) {
      alert(e?.message || "Errore eliminazione");
    }
  }

  // ✅ colonne preview: sequenza richiesta
  const previewColumns = useMemo(() => {
    const first = previewRows?.[0];
    if (!first || typeof first !== "object") return [];

    const keys = Object.keys(first);

    const preferred = [
      "qtaVenduta",
      "valoreVenduto",
      "giacenza",
      "qtaTeorica",
      "conf_da",
      "qtaOrdine",
      "pesoKg",
      "valoreDaOrdinare",
      "codArticolo",
      "descrizione",
    ];

    const ordered = [
      ...preferred.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !preferred.includes(k)),
    ];

    return ordered.slice(0, 12);
  }, [previewRows]);

  const totalsSourceLabel = useMemo(() => {
    if (totalsByItem.length > 0) return "Ordine completo (DB)";
    if ((previewMeta?.preview_count || 0) > 0) return "Preview (parziale)";
    return "—";
  }, [totalsByItem.length, previewMeta?.preview_count]);

  const canDelete = meRole === "admin" || meRole === "amministrativo";
  const isAdmin = meRole === "admin";

  function openMenuForRow(e: React.MouseEvent<HTMLButtonElement>, rowId: string) {
    e.preventDefault();
    e.stopPropagation();

    const btn = e.currentTarget;
    const r = btn.getBoundingClientRect();

    const top = Math.round(r.bottom + 8);
    const width = 220;

    // prova ad allineare a destra del bottone, senza uscire dallo schermo
    let left = Math.round(r.right - width);
    const minLeft = 8;
    const maxLeft = window.innerWidth - width - 8;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;

    if (openMenuId === rowId) {
      setOpenMenuId(null);
      setMenuPos(null);
      return;
    }

    setOpenMenuId(rowId);
    setMenuPos({ top, left, width });
  }

  function closeMenu() {
    setOpenMenuId(null);
    setMenuPos(null);
  }

  // ✅ chiudi su click fuori / ESC / scroll / resize
  useEffect(() => {
    if (!openMenuId) return;

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeMenu();
    };

    const onPointerDown = (ev: MouseEvent | TouchEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;

      // se clicco su un elemento del menu o sul bottone, non chiudere qui (gestiamo nei click)
      if (t.closest("[data-actions-menu='1']")) return;
      if (t.closest("[data-actions-btn='1']")) return;

      closeMenu();
    };

    const onScroll = () => closeMenu();
    const onResize = () => closeMenu();

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });

    // scroll in capture: prende anche lo scroll della table overflow
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown as any);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMenuId]);

  function MenuItemLink(props: { href: string; label: string; disabled?: boolean; title?: string }) {
    const { href, label, disabled, title } = props;
    if (disabled) {
      return (
        <div
          className="w-full text-left px-3 py-2 rounded-lg text-gray-400 cursor-not-allowed select-none"
          title={title}
        >
          {label}
        </div>
      );
    }
    return (
      <a
        className="block w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50"
        href={href}
        title={title}
        onClick={() => closeMenu()}
      >
        {label}
      </a>
    );
  }

  function MenuItemButton(props: { label: string; onClick: () => void; danger?: boolean }) {
    const { label, onClick, danger } = props;
    return (
      <button
        className={`w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 ${danger ? "text-red-700" : ""}`}
        onClick={() => {
          closeMenu();
          onClick();
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium mb-2">Tipo</label>
            <select
              className="rounded-xl border p-3 w-full bg-white"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
            >
              <option value="ALL">Tutti</option>
              <option value="TAB">Tabacchi</option>
              <option value="GV">Gratta &amp; Vinci</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Punto vendita</label>
            <select
              className="rounded-xl border p-3 w-full bg-white"
              value={pvId}
              onChange={(e) => setPvId(e.target.value)}
            >
              <option value="">Tutti</option>
              {pvs.map((pv) => (
                <option key={pv.id} value={pv.id}>
                  {pv.code} - {pv.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Da</label>
            <input
              className="rounded-xl border p-3 w-full"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">A</label>
            <input
              className="rounded-xl border p-3 w-full"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <button
              className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Carico..." : "Cerca"}
            </button>

            <button
              className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
              onClick={reset}
              disabled={loading}
            >
              Reset
            </button>
          </div>

          <p className="text-sm text-gray-600">
            {rows.length} risultati {rows.length >= 500 ? "(limit 500)" : ""}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Data</th>
              <th className="text-left p-3">PV</th>
              <th className="text-left p-3">Tipo</th>
              <th className="text-left p-3">Periodo</th>
              <th className="text-left p-3">Utente</th>
              <th className="text-left p-3">Righe</th>
              <th className="text-left p-3 w-36">Azioni</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={7}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={7}>
                  Nessun riordino trovato con questi filtri.
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const isTAB = r.type === "TAB";
              const id = encodeURIComponent(r.id);

              const pvNorm = normPvLabel(String(r.pv_label || ""));
              const canPAT = isTAB && PV_PAT_ALLOWED_NORM.has(pvNorm);

              const menuOpen = openMenuId === r.id;

              return (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{fmtDate(r.created_at)}</td>
                  <td className="p-3">{r.pv_label || "-"}</td>
                  <td className="p-3 font-medium">{r.type}</td>
                  <td className="p-3">{periodoLabel(r)}</td>
                  <td className="p-3">{r.created_by_username || "-"}</td>
                  <td className="p-3">{r.tot_rows ?? "-"}</td>

                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button
                        className="inline-flex items-center rounded-xl bg-slate-900 text-white px-3 py-2 hover:bg-slate-800"
                        onClick={() => openPreview(r)}
                        title="Apri anteprima"
                      >
                        View
                      </button>

                      <button
                        data-actions-btn="1"
                        className="inline-flex items-center rounded-xl border px-3 py-2 hover:bg-gray-50"
                        onClick={(e) => openMenuForRow(e, r.id)}
                        aria-expanded={menuOpen}
                        aria-haspopup="menu"
                        title="Azioni"
                      >
                        ...
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ✅ MENU PORTAL (non clippato dallo scroll della tabella) */}
      {openMenuId && menuPos && typeof document !== "undefined" &&
        createPortal(
          <div
            data-actions-menu="1"
            className="fixed z-[9999]"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width ?? 220 }}
          >
            <div className="rounded-xl border bg-white shadow-lg p-2">
              {(() => {
                const r = rows.find((x) => x.id === openMenuId);
                if (!r) return null;

                const isTAB = r.type === "TAB";
                const id = encodeURIComponent(r.id);

                const pvNorm = normPvLabel(String(r.pv_label || ""));
                const canPAT = isTAB && PV_PAT_ALLOWED_NORM.has(pvNorm);

                return (
                  <div className="flex flex-col">
                    <MenuItemLink href={`/api/reorder/history/${id}/excel`} label="Excel" />

                    <MenuItemLink
                      href={isTAB ? `/api/reorder/history/${id}/u88` : "#"}
                      label="U88"
                      disabled={!isTAB}
                      title={isTAB ? "Scarica U88 compilato" : "U88 disponibile solo per TAB"}
                    />

                    {canPAT && <MenuItemLink href={`/api/reorder/history/${id}/pat`} label="PAT" title="Scarica PAT" />}

                    <div className="my-2 border-t" />

                    <MenuItemLink
                      href={isTAB ? `/api/reorder/history/${id}/order-tab` : "#"}
                      label="Log"
                      disabled={!isTAB}
                      title={isTAB ? "Scarica Order Tab compilato" : "Order Tab disponibile solo per TAB"}
                    />

                    <MenuItemLink
                      href={isTAB ? `/api/reorder/history/${id}/log-car` : "#"}
                      label="LOG CAR"
                      disabled={!isTAB}
                      title={isTAB ? "Scarica LOG CAR" : "LOG CAR disponibile solo per TAB"}
                    />

                    {isAdmin && (
                      <MenuItemLink href={`/api/reorder/history/${id}/log`} label="Json" title="Scarica JSON log" />
                    )}

                    {canDelete && (
                      <>
                        <div className="my-2 border-t" />
                        <MenuItemButton label="Elimina" danger onClick={() => deleteOrder(r.id)} />
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>,
          document.body
        )
      }

      {/* ✅ MODAL PREVIEW */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closePreview} />

          <div className="relative w-full max-w-6xl rounded-2xl bg-white shadow-lg border">
            <div className="p-4 border-b flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Anteprima ordine</div>
                {previewMeta && (
                  <div className="text-sm text-gray-600 mt-1">
                    {previewMeta.type} — {previewMeta.pv_label || "—"} —{" "}
                    {previewMeta.days ? `${previewMeta.days} giorno/i` : `${previewMeta.weeks ?? "-"} sett.`}
                  </div>
                )}
              </div>

              <button className="rounded-xl border px-3 py-2 hover:bg-gray-50" onClick={closePreview}>
                Chiudi
              </button>
            </div>

            <div className="p-4 space-y-4">
              {previewLoading && <div className="text-sm text-gray-500">Carico anteprima...</div>}
              {previewError && <div className="text-sm text-red-600">{previewError}</div>}

              {!previewLoading && !previewError && previewMeta && (
                <>
                  <div className="rounded-2xl border bg-white p-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="font-semibold">Totali</div>
                      <div className="text-xs text-gray-500">
                        Fonte Totali: <b>{totalsSourceLabel}</b>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
                      <div className="rounded-xl border p-3">
                        <div className="text-gray-500">Righe ordine</div>
                        <div className="font-semibold">{previewMeta.tot_rows ?? "—"}</div>
                      </div>
                      <div className="rounded-xl border p-3">
                        <div className="text-gray-500">Tot. Qtà Ordine</div>
                        <div className="font-semibold">{Math.trunc(n0(previewMeta.tot_order_qty))}</div>
                      </div>
                      <div className="rounded-xl border p-3">
                        <div className="text-gray-500">Tot. Peso (kg)</div>
                        <div className="font-semibold">{kg1(previewMeta.tot_weight_kg)}</div>
                      </div>
                      <div className="rounded-xl border p-3">
                        <div className="text-gray-500">Tot. Valore (€)</div>
                        <div className="font-semibold">{eur(previewMeta.tot_value_eur)}</div>
                      </div>
                    </div>
                  </div>

                  {totalsByItem.length > 0 && (
                    <div className="rounded-2xl border overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                        <div className="font-semibold text-sm">Totali per articolo (ordine completo)</div>
                        <div className="text-xs text-gray-500">
                          Righe: <b>{totalsByItem.length}</b>
                        </div>
                      </div>

                      <div className="max-h-[40vh] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              {Object.keys(totalsByItem[0] || {}).map((k) => (
                                <th key={k} className="text-left p-3 whitespace-nowrap">
                                  {prettyCol(k)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {totalsByItem.map((row, i) => (
                              <tr key={i} className="border-t">
                                {Object.keys(totalsByItem[0] || {}).map((k) => (
                                  <td key={k} className="p-3 whitespace-nowrap">
                                    {formatCell(k, (row as any)?.[k])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                      <div className="font-semibold text-sm">Dettaglio righe (preview)</div>
                      <div className="text-xs text-gray-500">
                        Righe preview: <b>{previewMeta.preview_count ?? previewRows.length}</b>
                      </div>
                    </div>

                    <div className="max-h-[50vh] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            {previewColumns.map((c) => (
                              <th key={c} className="text-left p-3 whitespace-nowrap">
                                {prettyCol(c)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, i) => (
                            <tr key={i} className="border-t">
                              {previewColumns.map((c) => (
                                <td key={c} className="p-3 whitespace-nowrap">
                                  {formatCell(c, (row as any)?.[c])}
                                </td>
                              ))}
                            </tr>
                          ))}

                          {previewRows.length === 0 && (
                            <tr className="border-t">
                              <td className="p-3 text-gray-500" colSpan={Math.max(1, previewColumns.length)}>
                                Nessuna riga in anteprima.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500">
                    Nota: il dettaglio righe è una preview (max 200). I totali sono letti dal DB (ordine completo) quando
                    disponibili.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


















