// app/user/inventories/InventoryHistoryClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type Pv = { id: string; code: string; name: string; is_active?: boolean };
type Category = { id: string; name: string; slug?: string; is_active?: boolean };
type Subcategory = { id: string; category_id: string; name: string; slug?: string; is_active?: boolean };

type InventoryGroup = {
  // ✅ spesso qui dentro c’è già l’id header oppure una chiave composta
  key: string;

  // ✅ NUOVO: se /api/inventories/list restituisce id, lo usiamo per delete sicura
  id?: string | null;
  header_id?: string | null;

  pv_id: string;
  pv_code: string;
  pv_name: string;

  // ✅ Rapido => null
  category_id: string | null;
  category_name: string;

  subcategory_id: string | null;
  subcategory_name: string;

  inventory_date: string; // YYYY-MM-DD
  created_by_username: string | null;
  created_at: string | null;

  lines_count: number;
  qty_sum: number;

  qty_ml_sum?: number;
  qty_gr_sum?: number;
  value_sum?: number;

  operatore?: string | null;

  // ✅ serve per riaprire Rapido senza aprire "vuoto"
  rapid_session_id?: string | null;

  // ✅ nota/etichetta
  label?: string | null;
};

type InventoryLine = {
  id: string;
  item_id: string;
  code: string;
  description: string;

  // ✅ PZ (bottiglie chiuse equivalenti se ML)
  qty: number;

  // ✅ GR (peso aperto)
  qty_gr?: number;

  // ✅ ML totale
  qty_ml?: number;

  // ✅ volume per unità (se item ML)
  volume_ml_per_unit?: number | null;

  // ✅ ML "aperto"
  ml_open?: number | null;

  prezzo_vendita_eur?: number | null;
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

function formatDateIT(iso: string) {
  const s = (iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}-${m}-${y}`;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatEUR(n: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v).trim());
}

async function fetchJsonSafe<T = any>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; data: T; status: number; rawText: string }> {
  let res: Response;

  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch (e: any) {
    console.error("[fetchJsonSafe] NETWORK ERROR", { url, err: e });
    throw new Error(`Fetch fallita (rete/endpoint): ${url}`);
  }

  const status = res.status;
  const rawText = await res.text().catch(() => "");

  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  const ok = res.ok && !!data?.ok;
  return { ok, data, status, rawText };
}

/** =========================
 *  Helpers querystring / formdata (UNICI)
 *  ========================= */
function normStr(v: unknown): string {
  return String(v ?? "").trim();
}

function setParam(p: URLSearchParams, key: string, value: string | null | undefined) {
  const s = normStr(value);
  if (!s) return;
  p.set(key, s);
}

/** Categoria: UUID oppure NULL (Rapido). In querystring usiamo "null" stringa per NULL */
function setCategoryParam(p: URLSearchParams, category_id: string | null) {
  if (category_id === null) p.set("category_id", "null");
  else setParam(p, "category_id", category_id);
}

/** FormData categoria coerente con querystring */
function appendCategoryFd(fd: FormData, category_id: string | null) {
  if (category_id === null) fd.append("category_id", "null");
  else {
    const s = normStr(category_id);
    if (s) fd.append("category_id", s);
  }
}

/** Params per /api/inventories/rows (dettaglio) — coerenti e senza duplicati */
function buildRowsParamsFromGroup(g: InventoryGroup) {
  const p = new URLSearchParams();
  p.set("pv_id", g.pv_id);
  p.set("inventory_date", g.inventory_date);

  const isRapid = g.category_id === null;

  if (isRapid) {
    // Rapido: category_id NULL + rapid_session_id obbligatoria
    p.set("category_id", "null");

    const rs = normStr(g.rapid_session_id);
    if (rs) p.set("rapid_session_id", rs);
    // in rapido subcategory_id NON va passata (in DB è NULL)
  } else {
    // Standard
    setCategoryParam(p, g.category_id);
    if (g.subcategory_id) setParam(p, "subcategory_id", g.subcategory_id);
  }

  return p;
}

/** URL riapertura inventario (modifica) */
function buildReopenUrl(g: InventoryGroup, role: string | null) {
  const p = new URLSearchParams();
  p.set("pv_id", g.pv_id);
  p.set("inventory_date", g.inventory_date);

  const isRapid = g.category_id === null;

  if (isRapid) {
    // IMPORTANTISSIMO: per attivare il ramo Rapido server-side e per /rows
    p.set("category_id", "null");
    p.set("rapid", "1");
    p.set("mode", "rapid");

    const rs = normStr(g.rapid_session_id);
    if (rs) p.set("rapid_session_id", rs);
  } else {
    setCategoryParam(p, g.category_id);
    if (g.subcategory_id) setParam(p, "subcategory_id", g.subcategory_id);
    // NON forzo mode=rapid per lo standard: niente stravolgimenti UX
  }

  // operatore/label per prefill UI (e per non “sparire”)
  const op = normStr(g.operatore);
  if (op) p.set("operatore", op);

  const lbl = normStr(g.label);
  if (lbl) p.set("label", lbl);

  const base = role === "punto_vendita" ? "/pv/inventario" : "/user/inventories";
  p.set("reopen", "1");
  return `${base}?${p.toString()}`;
}

type MenuPos = { top: number; left: number; width: number };

export default function InventoryHistoryClient() {
  const router = useRouter();

  const [me, setMe] = useState<MeState>({
    role: null,
    username: null,
    pv_id: null,
    isPv: false,
  });

  const [pvs, setPvs] = useState<Pv[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  const [pvId, setPvId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");

  const [dateFromISO, setDateFromISO] = useState<string>("");
  const [dateToISO, setDateToISO] = useState<string>("");

  const [searchDetail, setSearchDetail] = useState("");

  const [rows, setRows] = useState<InventoryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<InventoryGroup | null>(null);
  const [detail, setDetail] = useState<InventoryLine[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState<InventoryGroup | null>(null);
  const [compareFile, setCompareFile] = useState<File | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareMsg, setCompareMsg] = useState<string | null>(null);
  const [compareDownloadUrl, setCompareDownloadUrl] = useState<string | null>(null);

  const canUseSubcategories = useMemo(() => !!categoryId, [categoryId]);
  const canCompare = me.role === "admin" || me.role === "amministrativo";

  const filteredDetail = useMemo(() => {
    const t = searchDetail.trim().toLowerCase();
    if (!t) return detail;
    return detail.filter((x) => {
      const code = String(x.code || "").toLowerCase();
      const desc = String(x.description || "").toLowerCase();
      return code.includes(t) || desc.includes(t);
    });
  }, [detail, searchDetail]);

  // ✅ Articoli: conta righe con qty>0 oppure qty_ml>0 oppure qty_gr>0
  const detailArticoli = useMemo(() => {
    return detail.reduce((n, r: any) => {
      const q = Number(r.qty) || 0;
      const qml = Number(r.qty_ml) || 0;
      const qgr = Number(r.qty_gr) || 0;
      return n + (q > 0 || qml > 0 || qgr > 0 ? 1 : 0);
    }, 0);
  }, [detail]);

  const detailMlSum = useMemo(() => {
    return (detail as any[]).reduce((sum, r: any) => {
      return sum + (Number(r?.qty_ml) || 0);
    }, 0);
  }, [detail]);

  const detailGrSum = useMemo(() => {
    return (detail as any[]).reduce((sum, r: any) => {
      return sum + (Number(r?.qty_gr) || 0);
    }, 0);
  }, [detail]);

  // ✅ Valore: se ML => (qty_ml/volume)*prezzo, altrimenti qty*prezzo
  const detailValueEur = useMemo(() => {
    return detail.reduce((sum, r) => {
      const p = Number(r.prezzo_vendita_eur);
      if (!Number.isFinite(p)) return sum;

      const volume = Number(r.volume_ml_per_unit ?? 0);
      const qty_ml = Number(r.qty_ml ?? 0);
      const qty = Number(r.qty ?? 0);

      if (Number.isFinite(volume) && volume > 0 && Number.isFinite(qty_ml) && qty_ml > 0) {
        const unitsEq = qty_ml / volume;
        return sum + unitsEq * p;
      }

      if (Number.isFinite(qty) && qty > 0) {
        return sum + qty * p;
      }

      return sum;
    }, 0);
  }, [detail]);

  const hasAnyPriceInDetail = useMemo(() => {
    return detail.some((r) => Number.isFinite(Number(r.prezzo_vendita_eur)));
  }, [detail]);

  async function fetchMe(): Promise<MeState> {
    const { ok, data, status, rawText } = await fetchJsonSafe<MeResponse>("/api/me");

    if (!ok) {
      const msg = (data as any)?.error || rawText || `HTTP ${status}`;
      throw new Error(msg || "Errore autenticazione");
    }

    const role = ((data.role || "").toString() as MeState["role"]) ?? null;
    const pv_id = data.pv_id ?? null;

    const isPv = role === "punto_vendita";
    if (isPv && !pv_id) throw new Error("Utente punto vendita senza PV assegnato (pv_id mancante).");

    return { role, username: data.username ?? null, pv_id, isPv };
  }

  async function loadPvs() {
    const { ok, data, status, rawText } = await fetchJsonSafe<any>("/api/pvs/list");
    if (!ok) throw new Error(data?.error || rawText || `Errore caricamento PV (HTTP ${status})`);
    setPvs(data.rows || []);
  }

  async function loadCategories() {
    const { ok, data, status, rawText } = await fetchJsonSafe<any>("/api/categories/list");
    if (!ok) throw new Error(data?.error || rawText || `Errore caricamento categorie (HTTP ${status})`);
    setCategories(data.rows || []);
  }

  async function loadSubcategories(catId: string) {
    setSubcategories([]);
    setSubcategoryId("");
    if (!catId) return;

    const url = `/api/subcategories/list?category_id=${encodeURIComponent(catId)}`;
    const { ok, data, status, rawText } = await fetchJsonSafe<any>(url);
    if (!ok) throw new Error(data?.error || rawText || `Errore caricamento sottocategorie (HTTP ${status})`);
    setSubcategories(data.rows || []);
  }

  async function loadList(effectiveMe: MeState) {
    setLoading(true);
    setError(null);
    setRows([]);
    setSelected(null);
    setDetail([]);
    setDetailError(null);
    setSearchDetail("");

    try {
      console.log("LOADLIST CHIAMATA", { effectiveMe });
      const params = new URLSearchParams();

      if (dateFromISO) params.set("from", dateFromISO);
      if (dateToISO) params.set("to", dateToISO);
      if (dateFromISO && dateToISO && dateFromISO > dateToISO) throw new Error("Intervallo date non valido: 'Dal' è dopo 'Al'.");

      if (effectiveMe.isPv) {
        // ✅ PV lavora in modalità Rapido: nello storico filtriamo SOLO per date.
        // (le categorie sono un concetto "standard" e qui non servono)
      } else {
        if (pvId) params.set("pv_id", pvId);
        if (categoryId) params.set("category_id", categoryId);
        if (categoryId && subcategoryId) params.set("subcategory_id", subcategoryId);
      }

      const qs = params.toString();
      const url = `/api/inventories/list${qs ? `?${qs}` : ""}`;

      const { ok, data, status, rawText } = await fetchJsonSafe<any>(url);

      if (!ok) {
        console.error("[inventories/list] ERROR", { url, status, rawText, data });
        throw new Error(data?.error || rawText || `Errore caricamento inventari (HTTP ${status})`);
      }

      setRows(data.rows || []);
      console.log("ROWS DAL SERVER:", data.rows);
      console.log("PRIMA RIGA:", (data.rows || [])[0]);
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
    setSearchDetail("");

    try {
      if (effectiveMe.isPv && effectiveMe.pv_id && g.pv_id !== effectiveMe.pv_id) throw new Error("Non autorizzato.");

      const params = buildRowsParamsFromGroup(g);

      const url = `/api/inventories/rows?${params.toString()}`;
      const { ok, data, status, rawText } = await fetchJsonSafe<any>(url);

      if (!ok) {
        console.error("[inventories/rows] ERROR", { url, status, rawText, data });
        const snippet = (rawText || "").slice(0, 300);
        throw new Error(data?.error || `Errore caricamento dettaglio (HTTP ${status}). Risposta: ${snippet || "—"}`);
      }

      setDetail(data.rows || []);
    } catch (e: any) {
      setDetailError(e?.message || "Errore");
    } finally {
      setDetailLoading(false);
    }
  }

  function downloadExcel(g: InventoryGroup, effectiveMe: MeState) {
    if (effectiveMe.isPv && effectiveMe.pv_id && g.pv_id !== effectiveMe.pv_id) {
      setError("Non autorizzato.");
      return;
    }

    const params = new URLSearchParams();
    params.set("pv_id", g.pv_id);
    setCategoryParam(params, g.category_id);
    params.set("inventory_date", g.inventory_date);
    if (g.subcategory_id) params.set("subcategory_id", g.subcategory_id);

    window.location.href = `/api/inventories/excel?${params.toString()}`;
  }

  function openCompare(g: InventoryGroup) {
    setCompareTarget(g);
    setCompareFile(null);
    setCompareOpen(true);
    setCompareError(null);
    setCompareMsg(null);

    if (compareDownloadUrl) URL.revokeObjectURL(compareDownloadUrl);
    setCompareDownloadUrl(null);
  }

  function closeCompare() {
    setCompareOpen(false);
    setCompareTarget(null);
    setCompareFile(null);
    setCompareError(null);
    setCompareMsg(null);

    if (compareDownloadUrl) URL.revokeObjectURL(compareDownloadUrl);
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

    if (compareDownloadUrl) URL.revokeObjectURL(compareDownloadUrl);
    setCompareDownloadUrl(null);

    try {
      const fd = new FormData();
      fd.append("file", compareFile);
      fd.append("pv_id", compareTarget.pv_id);
      appendCategoryFd(fd, compareTarget.category_id);
      fd.append("inventory_date", compareTarget.inventory_date);
      if (compareTarget.subcategory_id) fd.append("subcategory_id", compareTarget.subcategory_id);

      const res = await fetch("/api/inventories/compare", { method: "POST", body: fd });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = "Errore comparazione";
        try {
          const j = text ? JSON.parse(text) : null;
          msg = j?.error || msg;
        } catch {
          if (text) msg = text;
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      setCompareMsg("Comparazione completata.");
      setCompareDownloadUrl(url);
    } catch (e: any) {
      setCompareError(e?.message || "Errore comparazione");
    } finally {
      setCompareLoading(false);
    }
  }

  const [actionsOpenKey, setActionsOpenKey] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function computeMenuPos(key: string) {
    const btn = btnRefs.current[key];
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const width = 220;

    let left = r.right - width;
    let top = r.bottom + 8;

    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (left < pad) left = pad;
    if (left + width > vw - pad) left = Math.max(pad, vw - pad - width);

    const approxMenuH = 200;
    if (top + approxMenuH > vh - pad) {
      top = Math.max(pad, r.top - 8 - approxMenuH);
    }

    setMenuPos({ top, left, width });
  }

  function toggleActions(key: string) {
    if (actionsOpenKey === key) {
      setActionsOpenKey(null);
      setMenuPos(null);
      return;
    }
    setActionsOpenKey(key);
    setTimeout(() => computeMenuPos(key), 0);
  }

  useEffect(() => {
    if (!actionsOpenKey) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActionsOpenKey(null);
        setMenuPos(null);
      }
    };

    const onDown = (e: MouseEvent) => {
      const menu = actionsMenuRef.current;
      const btn = btnRefs.current[actionsOpenKey];

      const t = e.target as Node | null;
      if (!t) return;

      if (menu && menu.contains(t)) return;
      if (btn && btn.contains(t)) return;

      setActionsOpenKey(null);
      setMenuPos(null);
    };

    const onScroll = () => computeMenuPos(actionsOpenKey);
    const onResize = () => computeMenuPos(actionsOpenKey);

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [actionsOpenKey]);

  async function deleteInventory(g: InventoryGroup) {
    if (me.role !== "admin") return;

    // ✅ header_id robusto: prima id/header_id, poi key se è UUID
    const headerIdCandidate =
      normStr((g as any).header_id) || normStr((g as any).id) || (isUuid(g.key) ? g.key : "");
    if (!headerIdCandidate || !isUuid(headerIdCandidate)) {
      setError(
        "Eliminazione bloccata: non trovo l'ID dell'inventario. Serve che /api/inventories/list restituisca 'id' (header) oppure che 'key' sia un UUID."
      );
      return;
    }

    const note = normStr(g.label);
    const labelLine = `${g.pv_code} — ${g.category_name}${g.subcategory_id ? ` — ${g.subcategory_name}` : ""} — ${formatDateIT(g.inventory_date)}`;
    const noteLine = note ? `\nNota: ${note}` : "";

    const ok = window.confirm(`Confermi eliminazione inventario?\n\n${labelLine}${noteLine}\n\nOperazione irreversibile.`);
    if (!ok) return;

    try {
      setError(null);

      // ✅ NUOVO: delete SICURA per header_id
      const params = new URLSearchParams();
      params.set("header_id", headerIdCandidate);
      await fetch(`/api/inventories/delete?${params.toString()}`, { method: "DELETE" });

      const res = await fetch(`/api/inventories/delete?${params.toString()}`, { method: "DELETE" });
      const text = await res.text().catch(() => "");

      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        const looksHtml = (text || "").trim().startsWith("<!DOCTYPE") || (text || "").includes("<html");
        if (looksHtml) throw new Error("Errore eliminazione: endpoint /api/inventories/delete non trovato o risposta non valida.");

        // messaggio più chiaro se arriva il blocco legacy (non dovrebbe più capitare)
        if (json?.code === "DELETE_AMBIGUOUS") {
          throw new Error(json?.error || "Eliminazione bloccata: inventario ambiguo. Aggiorna la pagina e riprova.");
        }

        throw new Error(json?.error || text || `Errore eliminazione (HTTP ${res.status})`);
      }

      if (!json?.ok) {
        throw new Error(json?.error || "Eliminazione fallita");
      }

      setActionsOpenKey(null);
      setMenuPos(null);

      if (selected?.key === g.key) {
        setSelected(null);
        setDetail([]);
        setDetailError(null);
      }

      await loadList(me);
    } catch (e: any) {
      setError(e?.message || "Errore eliminazione");
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const meState = await fetchMe();
        setMe(meState);

        setDateToISO(todayISO());
        

        await loadCategories();

        if (!meState.isPv) {
          await loadPvs();
        }

        await loadList(meState);
      } catch (e: any) {
        setError(e?.message || "Errore");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!me.role) return;
        if (me.isPv) return;
        await loadSubcategories(categoryId);
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, me.role]);

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
  }, [pvId, categoryId, subcategoryId, dateFromISO, dateToISO, me.role]);

  return (
    <div className="space-y-4">

      {/* Date (per tutti) */}
      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">Dal</label>
          <input type="date" className="w-full rounded-xl border p-3 bg-white" value={dateFromISO} onChange={(e) => setDateFromISO(e.target.value)} />
          <div className="text-xs text-gray-500 mt-1">Formato mostrato: {dateFromISO ? formatDateIT(dateFromISO) : "—"}</div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Al</label>
          <input type="date" className="w-full rounded-xl border p-3 bg-white" value={dateToISO} onChange={(e) => setDateToISO(e.target.value)} />
          <div className="text-xs text-gray-500 mt-1">Formato mostrato: {dateToISO ? formatDateIT(dateToISO) : "—"}</div>
        </div>
      </div>

      {/* Admin/Ammin: filtri completi */}
      {!me.isPv && (
        <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-2">Punto Vendita (opzionale)</label>
            <select className="w-full rounded-xl border p-3 bg-white" value={pvId} onChange={(e) => setPvId(e.target.value)}>
              <option value="">— Tutti i PV —</option>
              {pvs.map((pv) => (
                <option key={pv.id} value={pv.id}>
                  {pv.code} — {pv.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Categoria</label>
            <select className="w-full rounded-xl border p-3 bg-white" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
      )}

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
              <th className="text-left p-3 w-44">Operatore</th>
              <th className="text-right p-3 w-24">Righe</th>
              <th className="text-right p-3 w-24">Pezzi</th>
              <th className="text-right p-3 w-24">GR</th>
              <th className="text-right p-3 w-32">Valore</th>
              <th className="text-left p-3 w-36">Creato da</th>
              <th className="text-left p-3 w-44">Azioni</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={11}>
                  Caricamento...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={11}>
                  Nessun inventario trovato con questi filtri.
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const isSel = selected?.key === r.key;
              const menuOpen = actionsOpenKey === r.key;

              const gr = Number(r.qty_gr_sum ?? 0) || 0;
              const valore = Number(r.value_sum ?? 0) || 0;

              return (
                <tr key={r.key} className={`border-t ${isSel ? "bg-yellow-50" : ""}`}>
                  <td className="p-3 font-medium">{formatDateIT(r.inventory_date)}</td>
                  <td className="p-3">
                    <div className="font-medium">{r.pv_code || r.pv_id}</div>
                    <div className="text-xs text-gray-500">{r.pv_name}</div>
                  </td>
                  <td className="p-3">{r.category_name || r.category_id}</td>
                  <td className="p-3">{r.subcategory_name || (r.subcategory_id ? r.subcategory_id : "—")}</td>

                  <td className="p-3">
                    <div className="leading-tight">
                      <div className="font-medium">{normStr(r.operatore) ? normStr(r.operatore) : "—"}</div>
                      {normStr((r as any).label) ? <div className="text-xs text-gray-500 mt-0.5">{normStr((r as any).label)}</div> : null}
                    </div>
                  </td>

                  <td className="p-3 text-right">{r.lines_count}</td>
                  <td className="p-3 text-right font-semibold">{r.qty_sum}</td>
                  <td className="p-3 text-right font-semibold">{gr > 0 ? gr : "—"}</td>
                  <td className="p-3 text-right font-semibold">{valore > 0 ? formatEUR(valore) : "—"}</td>
                  <td className="p-3">{r.created_by_username ?? "—"}</td>

                  <td className="p-3">
                    <div className="inline-flex items-center gap-2 whitespace-nowrap">
                      <button className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 text-sm" onClick={async () => await loadDetail(r, me)}>
                        Dettaglio
                      </button>

                      <button
                        ref={(el) => {
                          btnRefs.current[r.key] = el;
                        }}
                        className={`rounded-lg border px-3 py-1.5 hover:bg-gray-50 text-sm ${menuOpen ? "bg-gray-50" : ""}`}
                        onClick={() => toggleActions(r.key)}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        title="Altre azioni"
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

      {actionsOpenKey &&
        menuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={actionsMenuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width, zIndex: 9999 }}
            className="rounded-xl border bg-white shadow-lg p-2"
            role="menu"
          >
            {(() => {
              const g = rows.find((x) => x.key === actionsOpenKey);
              if (!g) return null;

              const canReopenBase = me.role === "admin" || me.role === "amministrativo" || me.role === "punto_vendita";

              // ✅ admin può sempre riaprire/modificare
              const canReopenOwner = me.role === "admin" ? true : !g.created_by_username || (me.username && g.created_by_username === me.username);

              const canReopen = canReopenBase && canReopenOwner;

              const isRapid = g.category_id === null;
              const rs = normStr(g.rapid_session_id);

              return (
                <div className="flex flex-col">
                  {(me.role === "admin" || me.role === "amministrativo") && (
                    <button
                      className={`text-left rounded-lg px-3 py-2 hover:bg-gray-50 text-sm ${!canReopen ? "opacity-50" : ""}`}
                      onClick={() => {
                        setActionsOpenKey(null);
                        setMenuPos(null);

                        if (!canReopen) {
                          alert("Non puoi modificare questo inventario: è stato creato da un altro utente (vincolo attivo lato server).");
                          return;
                        }

                        // ✅ Rapido: se manca rapid_session_id (inventari vecchi), NON blocco.
// Avviso solo: potrebbe riaprire “vuoto” oppure prendere righe legacy (sessione NULL).
if (isRapid && !rs) {
  const ok = window.confirm(
    "Questo inventario è in modalità Rapido ma non ha rapid_session_id (vecchio inventario).\n" +
      "Posso comunque provare a riaprirlo, ma gli scansionati potrebbero non combaciare.\n\n" +
      "Vuoi continuare?"
  );
  if (!ok) return;
}

router.push(buildReopenUrl(g, me.role));
                      }}
                      role="menuitem"
                      title={!canReopen ? "Inventario creato da altro utente" : "Riapri l'inventario per modificare"}
                    >
                      Riapri (modifica)
                    </button>
                  )}

                  <button
                    className="text-left rounded-lg px-3 py-2 hover:bg-gray-50 text-sm"
                    onClick={() => {
                      setActionsOpenKey(null);
                      setMenuPos(null);
                      downloadExcel(g, me);
                    }}
                    role="menuitem"
                  >
                    Excel
                  </button>

                  {canCompare && (
                    <button
                      className="text-left rounded-lg px-3 py-2 hover:bg-gray-50 text-sm"
                      onClick={() => {
                        setActionsOpenKey(null);
                        setMenuPos(null);
                        openCompare(g);
                      }}
                      role="menuitem"
                    >
                      Compara
                    </button>
                  )}

                  {me.role === "admin" && (
                    <button
                      className="text-left rounded-lg px-3 py-2 hover:bg-red-50 text-sm text-red-600"
                      onClick={async () => {
                        setActionsOpenKey(null);
                        setMenuPos(null);
                        await deleteInventory(g);
                      }}
                      role="menuitem"
                    >
                      Elimina
                    </button>
                  )}
                </div>
              );
            })()}
          </div>,
          document.body
        )}

      {/* dettaglio */}
      {selected && (
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">
                Dettaglio inventario — {formatDateIT(selected.inventory_date)} — {selected.pv_code} — {selected.category_name}
              </div>

              <div className="text-sm text-gray-600">
                Operatore: <b>{normStr(selected.operatore) ? normStr(selected.operatore) : "—"}</b> — Righe: <b>{selected.lines_count}</b> — Articoli:{" "}
                <b>{detailArticoli}</b> — Pezzi: <b>{selected.qty_sum}</b>
                {detailGrSum > 0 ? (
                  <>
                    {" "}
                    — GR: <b>{detailGrSum}</b>
                  </>
                ) : null}
                {detailMlSum > 0 ? <> — Ml: <b>{detailMlSum}</b></> : null} — Valore: <b>{hasAnyPriceInDetail ? formatEUR(detailValueEur) : "—"}</b>
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

          <div className="rounded-xl border bg-white p-3">
            <label className="block text-sm font-medium mb-2">Cerca nel dettaglio</label>
            <input
              className="w-full rounded-xl border p-3"
              placeholder="Cerca per codice o descrizione..."
              value={searchDetail}
              onChange={(e) => setSearchDetail(e.target.value)}
            />
            <div className="mt-2 text-sm text-gray-600">
              Visualizzati: <b>{filteredDetail.length}</b> / {detail.length}
            </div>
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
                    <th className="text-right p-3 w-24">PZ</th>
                    <th className="text-right p-3 w-24">GR</th>
                    <th className="text-right p-3 w-28">ML</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDetail.map((x) => {
                    const volume = Number(x.volume_ml_per_unit ?? 0);
                    const isMl = Number.isFinite(volume) && volume > 0;

                    const pz = Number(x.qty) || 0;
                    const gr = Number(x.qty_gr ?? 0) || 0;
                    const mlTot = isMl ? Number(x.qty_ml ?? 0) || 0 : null;

                    return (
                      <tr key={x.id} className="border-t">
                        <td className="p-3 font-medium">{x.code}</td>
                        <td className="p-3">{x.description}</td>
                        <td className="p-3 text-right font-semibold">{pz}</td>
                        <td className="p-3 text-right font-semibold">{gr > 0 ? gr : "—"}</td>
                        <td className="p-3 text-right font-semibold">{isMl ? mlTot : "—"}</td>
                      </tr>
                    );
                  })}

                  {filteredDetail.length === 0 && (
                    <tr className="border-t">
                      <td className="p-3 text-gray-500" colSpan={5}>
                        Nessuna riga trovata.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="px-3 py-2 text-xs text-gray-500 border-t">
                Nota: per articoli a ML, <b>PZ</b> = bottiglie chiuse equivalenti, <b>ML</b> = residuo “aperto”. Per articoli a grammi, <b>GR</b> = peso “aperto”.
              </div>
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
                  {formatDateIT(compareTarget.inventory_date)} — {compareTarget.pv_code} — {compareTarget.category_name}
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
                <input type="file" accept=".xlsx" onChange={(e) => setCompareFile(e.target.files?.[0] || null)} />
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
                  <button className="rounded-xl border px-4 py-2 hover:bg-gray-50" onClick={() => (window.location.href = compareDownloadUrl)}>
                    Scarica risultato
                  </button>
                )}
              </div>

              <p className="text-xs text-gray-500">
                Nota: l’endpoint <b>/api/inventories/compare</b> restituisce un file Excel scaricabile.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


























