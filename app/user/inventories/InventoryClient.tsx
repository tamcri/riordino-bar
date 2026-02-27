"use client";
import BarcodeScannerModal from "@/components/BarcodeScannerModal";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";

type Pv = { id: string; code: string; name: string; is_active?: boolean };
type Category = { id: string; name: string; slug?: string; is_active?: boolean };
type Subcategory = { id: string; category_id: string; name: string; slug?: string; is_active?: boolean };

type Item = {
  id: string;
  code: string;
  description: string;
  barcode?: string | null;
  prezzo_vendita_eur?: number | null;
  is_active: boolean;

  // ✅ servono per “Tutte le categorie” in Rapido
  category_id?: string | null;
  subcategory_id?: string | null;

  um?: string | null;
  peso_kg?: number | null;

  // ✅ se valorizzato => inventario in ML
  volume_ml_per_unit?: number | null;
};

type InventoryRowApi = {
  item_id: string;
  qty: number; // PZ
  qty_gr?: number; // GR
  qty_ml: number; // totale ml
  volume_ml_per_unit: number | null;
  ml_open: number | null;
  code?: string;
};

type MlInputMode = "fixed" | "mixed"; // fixed=PZ+ML aperti, mixed=solo Totale ML
type InventoryMode = "standard" | "rapid";

const INVENTORY_MODE_LS_KEY = "inv_mode_admin"; // (best effort) ricordiamo l'ultima scelta nel browser

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s || "").trim());
}

function isUuid(v: string | null | undefined) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v).trim());
}

function onlyDigits(v: string) {
  return v.replace(/[^\d]/g, "");
}

function normText(v: any) {
  return String(v ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "") // control chars
    .replace(/\s+/g, " ")                 // spazi multipli
    .trim()
    .toLowerCase();
}

function formatEUR(n: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}

function isMlItem(it: Item) {
  const v = Number(it.volume_ml_per_unit ?? 0);
  return Number.isFinite(v) && v > 0;
}

function isKgItem(it: Item) {
  return String(it.um || "").toLowerCase() === "kg";
}

function isIOSDevice() {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);

  // iPadOS spesso si presenta come MacIntel con touch
  const iPadOS = (navigator as any).platform === "MacIntel" && (navigator as any).maxTouchPoints > 1;

  return iOS || iPadOS;
}

// ✅ Rapido: id sessione (UUID) per evitare sovrascrittura nello stesso PV + giorno
function newRapidSessionId() {
  // browser moderni
  try {
    const anyCrypto = (globalThis as any).crypto;
    if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  } catch {
    // ignore
  }

  // fallback (non perfetto ma ok per id "sessione")
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

function mlToLitriLabel(ml: number) {
  const l = ml / 1000;
  return `${l.toFixed(1)} L`;
}

function safeIntFromStr(v: string) {
  const cleaned = onlyDigits(v || "");
  const n = Number(cleaned || "0");
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

// ✅ GR: niente limite “9999” (resto nel range int32 per sicurezza)
const MAX_GR = 1_000_000_000; // 1 miliardo di grammi = 1.000.000 kg

function safeGrFromStr(v: string) {
  const n = safeIntFromStr(v);
  return Math.min(MAX_GR, n);
}

type DraftAdmin = {
  operatore: string;
  categoryNote: string;

  qtyPzMap: Record<string, string>;
  qtyGrMap: Record<string, string>;
  openMlMap: Record<string, string>;
  totalMlMap: Record<string, string>;
  mlModeMap: Record<string, MlInputMode>;

  scannedIds: string[];
  showAllScanned: boolean;

  addPzMap: Record<string, string>;
  addGrMap: Record<string, string>;
  addOpenMlMap: Record<string, string>;
  addTotalMlMap: Record<string, string>;

  // ⚠️ retrocompat
  qtyMap?: Record<string, string>;
  addQtyMap?: Record<string, string>;
};

export default function InventoryClient() {
  // ✅ tempo chiusura rapida dopo ultimo tap (multi tap: +10 +1 +1 +1…)
  const RAPID_AUTO_CLOSE_MS = 1500;

  const searchParams = useSearchParams();

  // ✅ SOLO RAPIDO (Standard disabilitato)
  const inventoryMode: InventoryMode = "rapid";
  const [rapidSessionId, setRapidSessionId] = useState<string>(() => newRapidSessionId());

  // ✅ Rapido: vista "scan" (focus su singolo articolo) oppure "list" (lista scansionati full)
  const [rapidView, setRapidView] = useState<"scan" | "list">("scan");

  const [pvs, setPvs] = useState<Pv[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [pvId, setPvId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");

  // ✅ Rapido: id sessione (UUID) per evitare sovrascrittura nello stesso PV + giorno
  const [inventoryDate, setInventoryDate] = useState(todayISO());

  const [operatore, setOperatore] = useState("");

// ✅ Nota categoria (solo testo libero, per colpo d’occhio)
const [categoryNote, setCategoryNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ✅ Associazione barcode non riconosciuto -> articolo esistente (barcode principale)
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [assocStep, setAssocStep] = useState<"confirm" | "search" | null>(null);
  const [assocQuery, setAssocQuery] = useState("");
  const [assocResults, setAssocResults] = useState<Item[]>([]);
  const [assocLoading, setAssocLoading] = useState(false);
  const [assocError, setAssocError] = useState<string | null>(null);
  const assocSearchRef = useRef<HTMLInputElement | null>(null);

  // ✅ pezzi (per tutti)
  const [qtyPzMap, setQtyPzMap] = useState<Record<string, string>>({});
  // ✅ KG: grammi aperti
  const [qtyGrMap, setQtyGrMap] = useState<Record<string, string>>({});
  // ✅ ML aperti (solo ML e solo in modalità fixed)
  const [openMlMap, setOpenMlMap] = useState<Record<string, string>>({});
  // ✅ Totale ML manuale (solo ML e solo in modalità mixed)
  const [totalMlMap, setTotalMlMap] = useState<Record<string, string>>({});
  // ✅ modalità input per item ML
  const [mlModeMap, setMlModeMap] = useState<Record<string, MlInputMode>>({});

  const [search, setSearch] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  // ✅ lista “Scansionati”
  const [scannedIds, setScannedIds] = useState<string[]>([]);
  const [highlightScannedId, setHighlightScannedId] = useState<string | null>(null);
  const [showAllScanned, setShowAllScanned] = useState(false);

  // ✅ “da aggiungere”
  const [addPzMap, setAddPzMap] = useState<Record<string, string>>({});
  const [addGrMap, setAddGrMap] = useState<Record<string, string>>({});
  const [addOpenMlMap, setAddOpenMlMap] = useState<Record<string, string>>({});
  const [addTotalMlMap, setAddTotalMlMap] = useState<Record<string, string>>({});

  // ✅ focus singolo articolo
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  // ✅ Rapido: contatore “tap” sui pulsanti PZ (utile per +10 +1 +1 +1…)
  const [rapidPzPreview, setRapidPzPreview] = useState<number | null>(null);
  const rapidAutoCloseTimerRef = useRef<number | null>(null);

  // ✅ UX: focus automatico tra ricerca <-> quantità
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ✅ Rapido: focus sui campi quantità “manuale”
  const rapidPzInputRef = useRef<HTMLInputElement | null>(null);
  const rapidGrInputRef = useRef<HTMLInputElement | null>(null);
  const rapidMlInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ guard prefill
  const lastPrefillKeyRef = useRef<string>("");

  // ✅ init da querystring (riapri da storico)
  const didInitFromUrlRef = useRef(false);
  const reopenModeRef = useRef(false);

  // ✅ valori iniziali da URL (per evitare override dei default al primo load)
  const initFromUrlValuesRef = useRef<{ pvId?: string; categoryId?: string; subcategoryId?: string } | null>(null);

  // ✅ REFS per evitare race condition (scanned sync)
  const qtyPzRef = useRef<Record<string, string>>({});
  const qtyGrRef = useRef<Record<string, string>>({});
  const openMlRef = useRef<Record<string, string>>({});
  const totalMlRef = useRef<Record<string, string>>({});
  const mlModeRef = useRef<Record<string, MlInputMode>>({});

  useEffect(() => {
    qtyPzRef.current = qtyPzMap;
  }, [qtyPzMap]);
  useEffect(() => {
    qtyGrRef.current = qtyGrMap;
  }, [qtyGrMap]);
  useEffect(() => {
    openMlRef.current = openMlMap;
  }, [openMlMap]);
  useEffect(() => {
    totalMlRef.current = totalMlMap;
  }, [totalMlMap]);
  useEffect(() => {
    mlModeRef.current = mlModeMap;
  }, [mlModeMap]);

    // ✅ in RAPIDO calcolo “attivo” usando gli STATE (non i ref),
  // così la lista Scansionati si aggiorna immediatamente (senza lag/race)
  function isActiveFromState(it: Item) {
    const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
    const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");
    const open = safeIntFromStr(openMlMap[it.id] ?? "");
    const total = safeIntFromStr(totalMlMap[it.id] ?? "");
    const mode = mlModeMap[it.id] || "fixed";

    const ml = isMlItem(it);
    const kg = isKgItem(it) && !ml;

    if (kg) return pz > 0 || gr > 0;
    if (!ml) return pz > 0;

    if (mode === "mixed") return total > 0;

    const perUnit = Number(it.volume_ml_per_unit) || 0;
    const qty_ml = perUnit > 0 ? pz * perUnit + open : open;
    return qty_ml > 0;
  }

// ✅ FAILSAFE: in RAPIDO ricostruisco sempre "Scansionati" dagli articoli con quantità > 0
// Serve per evitare che scannedIds vada perso/reset (bug, refresh, draft, reopen, ecc.)
useEffect(() => {
  if (inventoryMode !== "rapid") return;
  if (!items.length) return;

    // calcolo gli id "attivi" (qty>0 / gr>0 / ml>0) usando gli STATE
  const activeIds = items.filter((it) => isActiveFromState(it)).map((it) => it.id);

  setScannedIds((prev) => {
    const activeSet = new Set(activeIds);

    // tengo l'ordine esistente, ma butto fuori quelli non più attivi
    const keep = prev.filter((id) => activeSet.has(id));

    // aggiungo quelli attivi che mancano (in cima, così li vedi subito)
    const keepSet = new Set(keep);
    const missing = activeIds.filter((id) => !keepSet.has(id));

    // se non cambia niente, non aggiorno (evito re-render inutili)
    if (missing.length === 0 && keep.length === prev.length) return prev;

    return [...missing, ...keep];
  });
}, [inventoryMode, items, qtyPzMap, qtyGrMap, openMlMap, totalMlMap, mlModeMap]);

  const isRapidMobileBar = inventoryMode === "rapid" && rapidView === "scan";

  function vibrateOk() {
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        (navigator as any).vibrate?.(40);
      }
    } catch {
      // ignore
    }
  }

  function scrollIntoViewById(domId: string) {
    try {
      if (typeof document === "undefined") return;
      const el = document.getElementById(domId);
      if (!el) return;
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    } catch {
      // ignore
    }
  }

  // ✅ HARD RULE: in Rapido non esistono categorie/sottocategorie
 function forceRapidCategoryNull() {
  // UI: in Rapido la categoria resta “Nessuna (Tutte)”
  setCategoryId("");

  // ✅ In Rapido NON usiamo subcategoryId (nel DB resta NULL)
  setSubcategoryId("");
}

// ✅ appena montiamo la pagina: in Rapido categoria sempre vuota
useEffect(() => {
  forceRapidCategoryNull();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  useEffect(() => {
    if (didInitFromUrlRef.current) return;
    didInitFromUrlRef.current = true;

    const pv = (searchParams?.get("pv_id") || "").trim();
    const date = (searchParams?.get("inventory_date") || "").trim();
    const op = (searchParams?.get("operatore") || "").trim();

    // ✅ supporto riapertura Rapido esplicita
    const m = (searchParams?.get("mode") || "").trim().toLowerCase();
    const isRapidUrl = m === "rapid";
// ✅ supporto riapertura Rapido
const rapidFromQs = (searchParams?.get("rapid_session_id") || "").trim();
// compat vecchia: alcuni link mettono la sessione in subcategory_id
const rapidLegacy = (searchParams?.get("subcategory_id") || "").trim();

const rapidId = isUuid(rapidFromQs) ? rapidFromQs : isUuid(rapidLegacy) ? rapidLegacy : "";

if (isRapidUrl && rapidId) {
  setRapidSessionId(rapidId);
}

    // ✅ Reopen: Standard richiede pv+cat+date, Rapido richiede pv+date
    reopenModeRef.current = isRapidUrl ? !!(pv && date) : false;

    // ✅ Rapido fisso: se URL dice rapid, applico solo vista + categorie null
  if (isRapidUrl) {
  setRapidView("scan");
  forceRapidCategoryNull();
}

    initFromUrlValuesRef.current = {
      pvId: pv || undefined,
      // in rapido sempre vuoto
      categoryId: isRapidUrl ? "" : undefined,
      subcategoryId: isRapidUrl ? "" : undefined,
    };

    if (pv) setPvId(pv);
    if (date && isIsoDate(date)) setInventoryDate(date);
    if (op) setOperatore(op);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ✅ se passo a Rapido “per qualsiasi motivo” => azzero categorie sempre
  useEffect(() => {
  if (inventoryMode !== "rapid") return;
  if (rapidView !== "scan") return;
  if (!focusItemId) return;

  // ✅ Solo iOS: auto-scroll + focus (su Android evito tastiera che si apre subito)
  if (!isIOSDevice()) return;

  const it = items.find((x) => x.id === focusItemId);
  if (!it) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ml = isMlItem(it);
      const kg = isKgItem(it) && !ml;

      const target = kg ? rapidGrInputRef.current : ml ? rapidMlInputRef.current : rapidPzInputRef.current;
      if (!target) return;

      try {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {}

      window.setTimeout(() => {
        target.focus();
        target.select?.();
      }, 150);
    });
  });
}, [inventoryMode, rapidView, focusItemId, items]);

  // ✅ persisto modalità (best-effort)
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      localStorage.setItem(INVENTORY_MODE_LS_KEY, inventoryMode);
    } catch {
      // ignore
    }
  }, [inventoryMode]);

  const canSave = useMemo(() => {
    // in rapido non c'è categoria
    const catOk = inventoryMode === "rapid" ? true : !!categoryId;
    return !!operatore.trim() && !!pvId && catOk && items.length > 0;
  }, [operatore, pvId, categoryId, items.length, inventoryMode]);

    const draftKey = useMemo(() => {
    if (inventoryMode === "rapid") {
      return `inv_draft_admin:${pvId}:RAPID:${rapidSessionId}:${inventoryDate}`;
    }
    const sub = subcategoryId || "null";
    const cat = categoryId || "ALL";
    return `inv_draft_admin:${pvId}:${cat}:${sub}:${inventoryDate}`;
  }, [pvId, categoryId, subcategoryId, inventoryDate, inventoryMode, rapidSessionId]);

  function getMlMode(itemId: string): MlInputMode {
    return mlModeMap[itemId] || "fixed";
  }

  function calcTotalMl(it: Item) {
    if (!isMlItem(it)) return 0;

    const mode = getMlMode(it.id);
    if (mode === "mixed") {
      return safeIntFromStr(totalMlMap[it.id] ?? "");
    }

    const perUnit = Number(it.volume_ml_per_unit) || 0;
    if (perUnit <= 0) return 0;

    const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
    const open = safeIntFromStr(openMlMap[it.id] ?? "");
    return pz * perUnit + open;
  }

  function calcTotalKg(it: Item) {
    if (!isKgItem(it)) return 0;

    const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
    const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");
    const pesoKg = Number(it.peso_kg ?? 0) || 0;

    return pz * pesoKg + gr / 1000;
  }

  // ✅ Totale GR “reale” = (PZ * peso_kg * 1000) + GR inseriti
  // Se peso_kg manca/non valido non posso convertire i PZ => ritorno null
  function calcTotalGr(it: Item): number | null {
    if (!isKgItem(it)) return null;

    const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
    const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");
    const pesoKg = Number(it.peso_kg ?? 0) || 0;

    if (!Number.isFinite(pesoKg) || pesoKg <= 0) return null;

    const fromPz = Math.round(pz * pesoKg * 1000);
    return fromPz + gr;
  }

  // ✅ VALORE: ML = (ml tot / ml per unit) * prezzo ; KG = kg tot * prezzo ; PZ = pz * prezzo
  function calcValueEur(it: Item) {
    const p = Number(it.prezzo_vendita_eur) || 0;
    if (p <= 0) return 0;

    if (isMlItem(it)) {
      const totalMl = calcTotalMl(it);
      const perUnit = Number(it.volume_ml_per_unit) || 0;
      if (perUnit <= 0) return 0;
      const unitsEq = totalMl / perUnit;
      return unitsEq * p;
    }

    if (isKgItem(it)) {
      const kg = calcTotalKg(it);
      return kg * p;
    }

    const q = safeIntFromStr(qtyPzMap[it.id] ?? "");
    return q * p;
  }

  function ensureMlDefaults(rows: Item[]) {
    const nextMode: Record<string, MlInputMode> = {};
    const nextTotal: Record<string, string> = {};

    rows.forEach((it) => {
      if (!isMlItem(it)) return;
      nextMode[it.id] = mlModeMap[it.id] || "fixed";
      nextTotal[it.id] = totalMlMap[it.id] ?? "";
    });

    setMlModeMap((prev) => ({ ...nextMode, ...prev }));
    setTotalMlMap((prev) => ({ ...nextTotal, ...prev }));
  }

  function loadDraftIfAny(rows: Item[]) {
    try {
      if (!draftKey || !rows?.length) return;

      const raw = localStorage.getItem(draftKey);
      if (!raw) return;

      const d = JSON.parse(raw) as DraftAdmin;
      if (!d || typeof d !== "object") return;

      if (typeof d.operatore === "string") setOperatore(d.operatore);
      if (typeof (d as any).categoryNote === "string") setCategoryNote((d as any).categoryNote);

      if (d.qtyPzMap && typeof d.qtyPzMap === "object") {
        setQtyPzMap((prev) => {
          const next: Record<string, string> = { ...prev };
          rows.forEach((it) => {
            if (d.qtyPzMap[it.id] != null) next[it.id] = String(d.qtyPzMap[it.id] ?? "");
          });
          return next;
        });
      }

      if (d.qtyGrMap && typeof d.qtyGrMap === "object") {
        setQtyGrMap((prev) => {
          const next: Record<string, string> = { ...prev };
          rows.forEach((it) => {
            if (d.qtyGrMap[it.id] != null) next[it.id] = String(d.qtyGrMap[it.id] ?? "");
          });
          return next;
        });
      }

      if (d.openMlMap && typeof d.openMlMap === "object") {
        setOpenMlMap((prev) => {
          const next: Record<string, string> = { ...prev };
          rows.forEach((it) => {
            if (d.openMlMap[it.id] != null) next[it.id] = String(d.openMlMap[it.id] ?? "");
          });
          return next;
        });
      }

      if (d.totalMlMap && typeof d.totalMlMap === "object") {
        setTotalMlMap((prev) => {
          const next: Record<string, string> = { ...prev };
          rows.forEach((it) => {
            if (d.totalMlMap[it.id] != null) next[it.id] = String(d.totalMlMap[it.id] ?? "");
          });
          return next;
        });
      }

      if (d.mlModeMap && typeof d.mlModeMap === "object") {
        setMlModeMap((prev) => {
          const next: Record<string, MlInputMode> = { ...prev };
          rows.forEach((it) => {
            const m = (d.mlModeMap as any)?.[it.id];
            if (m === "fixed" || m === "mixed") next[it.id] = m;
          });
          return next;
        });
      }

      if (Array.isArray(d.scannedIds)) {
        const set = new Set(rows.map((r) => r.id));
        setScannedIds(d.scannedIds.filter((id) => set.has(id)));
      }

      if (typeof d.showAllScanned === "boolean") setShowAllScanned(d.showAllScanned);

      if (d.addPzMap && typeof d.addPzMap === "object") {
        const next: Record<string, string> = {};
        rows.forEach((it) => {
          if (d.addPzMap[it.id] != null) next[it.id] = String(d.addPzMap[it.id] ?? "");
        });
        setAddPzMap(next);
      }

      if (d.addGrMap && typeof d.addGrMap === "object") {
        const next: Record<string, string> = {};
        rows.forEach((it) => {
          if (d.addGrMap[it.id] != null) next[it.id] = String(d.addGrMap[it.id] ?? "");
        });
        setAddGrMap(next);
      }

      if (d.addOpenMlMap && typeof d.addOpenMlMap === "object") {
        const next: Record<string, string> = {};
        rows.forEach((it) => {
          if (d.addOpenMlMap[it.id] != null) next[it.id] = String(d.addOpenMlMap[it.id] ?? "");
        });
        setAddOpenMlMap(next);
      }

      if (d.addTotalMlMap && typeof d.addTotalMlMap === "object") {
        const next: Record<string, string> = {};
        rows.forEach((it) => {
          if (d.addTotalMlMap[it.id] != null) next[it.id] = String(d.addTotalMlMap[it.id] ?? "");
        });
        setAddTotalMlMap(next);
      }
    } catch {
      // ignore
    }
  }

  function persistDraft() {
    try {
      if (!draftKey) return;
      const draft: DraftAdmin = {
        operatore,
        categoryNote,
        qtyPzMap,
        qtyGrMap,
        openMlMap,
        totalMlMap,
        mlModeMap,
        scannedIds,
        showAllScanned,
        addPzMap,
        addGrMap,
        addOpenMlMap,
        addTotalMlMap,
      };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }

  function clearDraft() {
    try {
      if (!draftKey) return;
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  }

  // ✅ Persist draft: in Rapido posso avere categoryId vuota (Tutte)
  useEffect(() => {
    if (!pvId || !inventoryDate) return;
    if (!items.length) return;
    if (inventoryMode !== "rapid" && !categoryId) return;

    const t = window.setTimeout(() => persistDraft(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pvId,
    categoryId,
    subcategoryId,
    inventoryDate,
    items.length,
    inventoryMode,
    operatore,
    scannedIds,
    showAllScanned,
    addPzMap,
    addGrMap,
    addOpenMlMap,
    addTotalMlMap,
    qtyPzMap,
    qtyGrMap,
    openMlMap,
    totalMlMap,
    mlModeMap,
  ]);

  // ✅ RAPIDO: suggestions LIVE (top-level useMemo, no nesting)
  const rapidSuggestions = useMemo(() => {
    if (inventoryMode !== "rapid") return [];
    if (focusItemId) return [];

    const qRaw = search.trim().toLowerCase();
    if (qRaw.length < 2) return [];

    const digits = onlyDigits(qRaw);
    const isLikelyBarcode = digits.length >= 8;

    const scored = items
      .map((it) => {
        const code = String(it.code || "").toLowerCase();
        const desc = String(it.description || "").toLowerCase();
        const bc = String(it.barcode || "").toLowerCase();

        let score = 0;

        if (isLikelyBarcode) {
          const bcDigits = onlyDigits(bc);
          const codeDigits = onlyDigits(code);
          if (bcDigits === digits) score += 1000;
          else if (bcDigits.includes(digits)) score += 200;
          if (codeDigits === digits) score += 500;
        }

        if (code === qRaw) score += 900;
        else if (code.startsWith(qRaw)) score += 250;
        else if (code.includes(qRaw)) score += 120;

        if (desc.startsWith(qRaw)) score += 110;
        else if (desc.includes(qRaw)) score += 80;

        if (!isLikelyBarcode && bc.includes(qRaw)) score += 60;

        return { it, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.it);

    return scored;
  }, [inventoryMode, focusItemId, search, items]);

  const filteredItems = useMemo(() => {
    if (focusItemId) {
      const it = items.find((x) => x.id === focusItemId);
      return it ? [it] : [];
    }

    const raw = search.trim();
    if (!raw) return items;

    const t = raw.toLowerCase();
    const digits = onlyDigits(raw);
    const isLikelyBarcode = digits.length >= 8;

    if (isLikelyBarcode) {
      const exact = items.filter((it) => {
        const bcDigits = onlyDigits(String(it.barcode ?? ""));
        const codeDigits = onlyDigits(String(it.code ?? ""));
        return (bcDigits && bcDigits === digits) || (codeDigits && codeDigits === digits);
      });
      if (exact.length > 0) return exact;

      return items.filter((it) => {
        const code = String(it.code || "").toLowerCase();
        const desc = String(it.description || "").toLowerCase();
        const bc = String(it.barcode || "").toLowerCase();
        const bcDigits = onlyDigits(String(it.barcode ?? ""));
        return code.includes(t) || desc.includes(t) || bc.includes(t) || (digits && bcDigits.includes(digits));
      });
    }

    return items.filter((it) => {
      const code = String(it.code || "").toLowerCase();
      const desc = String(it.description || "").toLowerCase();
      const bc = String(it.barcode || "").toLowerCase();
      return code.includes(t) || desc.includes(t) || bc.includes(t);
    });
  }, [items, search, focusItemId]);

  const scannedItems = useMemo(() => {
  // ✅ In RAPIDO: non mi fido di scannedIds (può svuotarsi per reset/draft/reopen).
  // La lista "Scansionati" la ricavo SEMPRE dagli item con quantità > 0.
  if (inventoryMode === "rapid") {
        const active = items.filter((it) => isActiveFromState(it));

    // se ho anche scannedIds, lo uso solo per mantenere un ordine "umano"
    const order = new Map<string, number>();
    scannedIds.forEach((id, idx) => order.set(id, idx));

    active.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));

    return active;
  }

  // ✅ Standard: come prima (dipende da scannedIds)
  const byId = new Map(items.map((it) => [it.id, it]));
  return scannedIds.map((id) => byId.get(id)).filter(Boolean) as Item[];
}, [items, scannedIds, inventoryMode, qtyPzMap, qtyGrMap, openMlMap, totalMlMap, mlModeMap]);

  const scannedItemsVisible = useMemo(() => {
    if (showAllScanned) return scannedItems;
    return scannedItems.slice(0, 10);
  }, [scannedItems, showAllScanned]);

  const totScannedPiecesNoMl = useMemo(() => {
    return scannedItems.reduce((sum, it) => {
      if (isMlItem(it)) return sum;
      return sum + safeIntFromStr(qtyPzMap[it.id] ?? "");
    }, 0);
  }, [scannedItems, qtyPzMap]);

  const totScannedKg = useMemo(() => {
    return scannedItems.reduce((sum, it) => {
      if (!isKgItem(it)) return sum;
      return sum + calcTotalKg(it);
    }, 0);
  }, [scannedItems, qtyPzMap, qtyGrMap]);

  const totScannedPiecesMl = useMemo(() => {
    return scannedItems.reduce((sum, it) => {
      if (!isMlItem(it)) return sum;
      const mode = getMlMode(it.id);
      if (mode !== "fixed") return sum;
      return sum + safeIntFromStr(qtyPzMap[it.id] ?? "");
    }, 0);
  }, [scannedItems, qtyPzMap, mlModeMap]);

  const totScannedOpenMl = useMemo(() => {
    return scannedItems.reduce((sum, it) => {
      if (!isMlItem(it)) return sum;
      const mode = getMlMode(it.id);
      if (mode !== "fixed") return sum;
      return sum + safeIntFromStr(openMlMap[it.id] ?? "");
    }, 0);
  }, [scannedItems, openMlMap, mlModeMap]);

  const totScannedTotalMl = useMemo(() => {
    return scannedItems.reduce((sum, it) => {
      if (!isMlItem(it)) return sum;
      return sum + calcTotalMl(it);
    }, 0);
  }, [scannedItems, qtyPzMap, openMlMap, totalMlMap, mlModeMap]);

  const totScannedDistinct = scannedItems.length;

  const totScannedValueEur = useMemo(() => {
    return scannedItems.reduce((sum, it) => {
      const p = Number(it.prezzo_vendita_eur) || 0;

      if (isMlItem(it)) {
        const totalMl = calcTotalMl(it);
        const perUnit = Number(it.volume_ml_per_unit) || 0;
        if (perUnit <= 0) return sum;
        const unitsEq = totalMl / perUnit;
        return sum + unitsEq * p;
      }

      if (isKgItem(it)) {
        const totalKg = calcTotalKg(it);
        return sum + totalKg * p;
      }

      const q = safeIntFromStr(qtyPzMap[it.id] ?? "");
      return sum + q * p;
    }, 0);
  }, [scannedItems, qtyPzMap, qtyGrMap, openMlMap, totalMlMap, mlModeMap]);

  function highlightAndMoveToTop(itemId: string) {
    setScannedIds((prev) => {
      const next = [itemId, ...prev.filter((id) => id !== itemId)];
      return next;
    });
    setHighlightScannedId(itemId);
  }

  // ✅ calcolo “attivo” usando REF (state sempre aggiornato), con override opzionali
  function isActiveWithOverrides(
    it: Item,
    overrides?: { pz?: number; gr?: number; openMl?: number; totalMl?: number; mlMode?: MlInputMode }
  ) {
    const pz = overrides?.pz ?? safeIntFromStr(qtyPzRef.current[it.id] ?? "");
    const gr = overrides?.gr ?? safeGrFromStr(qtyGrRef.current[it.id] ?? "");
    const open = overrides?.openMl ?? safeIntFromStr(openMlRef.current[it.id] ?? "");
    const total = overrides?.totalMl ?? safeIntFromStr(totalMlRef.current[it.id] ?? "");
    const mode = overrides?.mlMode ?? (mlModeRef.current[it.id] || "fixed");

    const ml = isMlItem(it);
    const kg = isKgItem(it) && !ml;

    if (kg) return pz > 0 || gr > 0;
    if (!ml) return pz > 0;

    if (mode === "mixed") return total > 0;

    const perUnit = Number(it.volume_ml_per_unit) || 0;
    const qty_ml = perUnit > 0 ? pz * perUnit + open : open;
    return qty_ml > 0;
  }

  function ensureScannedPresence(itemId: string, active: boolean) {
    setScannedIds((prev) => {
      const has = prev.includes(itemId);
      if (active && !has) return [itemId, ...prev];
      if (!active && has) return prev.filter((id) => id !== itemId);
      return prev;
    });
  }

  function setPz(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    setQtyPzMap((prev) => ({ ...prev, [itemId]: cleaned }));
    setHighlightScannedId(itemId);

    const it = items.find((x) => x.id === itemId);
    if (it) {
      const nextPz = safeIntFromStr(cleaned);
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { pz: nextPz }));
      if (isActiveWithOverrides(it, { pz: nextPz })) highlightAndMoveToTop(itemId);
    }
  }

  function setGr(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    const capped = String(Math.min(MAX_GR, Number(cleaned || "0") || 0));
    setQtyGrMap((prev) => ({ ...prev, [itemId]: cleaned ? capped : "" }));
    setHighlightScannedId(itemId);

    const it = items.find((x) => x.id === itemId);
    if (it) {
      const nextGr = safeGrFromStr(cleaned ? capped : "");
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { gr: nextGr }));
      if (isActiveWithOverrides(it, { gr: nextGr })) highlightAndMoveToTop(itemId);
    }
  }

  function setOpenMl(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    setOpenMlMap((prev) => ({ ...prev, [itemId]: cleaned }));
    setHighlightScannedId(itemId);

    const it = items.find((x) => x.id === itemId);
    if (it) {
      const nextOpen = safeIntFromStr(cleaned);
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { openMl: nextOpen }));
      if (isActiveWithOverrides(it, { openMl: nextOpen })) highlightAndMoveToTop(itemId);
    }
  }

  function setTotalMl(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    setTotalMlMap((prev) => ({ ...prev, [itemId]: cleaned }));
    setHighlightScannedId(itemId);

    const it = items.find((x) => x.id === itemId);
    if (it) {
      const nextTotal = safeIntFromStr(cleaned);
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { totalMl: nextTotal }));
      if (isActiveWithOverrides(it, { totalMl: nextTotal })) highlightAndMoveToTop(itemId);
    }
  }

  function setMlMode(itemId: string, mode: MlInputMode) {
    setMlModeMap((prev) => ({ ...prev, [itemId]: mode }));

    if (mode === "mixed") {
      const it = items.find((x) => x.id === itemId);
      if (it && isMlItem(it)) {
        const perUnit = Number(it.volume_ml_per_unit) || 0;
        const pz = safeIntFromStr(qtyPzRef.current[it.id] ?? "");
        const open = safeIntFromStr(openMlRef.current[it.id] ?? "");
        const total = perUnit > 0 ? pz * perUnit + open : open;
        setTotalMlMap((prev) => ({ ...prev, [itemId]: total > 0 ? String(total) : "" }));
      }
    }

    const it = items.find((x) => x.id === itemId);
    if (it) {
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { mlMode: mode }));
      if (isActiveWithOverrides(it, { mlMode: mode })) highlightAndMoveToTop(itemId);
    }
  }

  function addQty(itemId: string) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;

    // ✅ KG
    if (isKgItem(it) && !isMlItem(it)) {
      const deltaPz = safeIntFromStr(addPzMap[itemId] ?? "");
      const deltaGr = safeGrFromStr(addGrMap[itemId] ?? "");
      if (deltaPz <= 0 && deltaGr <= 0) return;

      const curPz = safeIntFromStr(qtyPzRef.current[itemId] ?? "");
      const curGr = safeGrFromStr(qtyGrRef.current[itemId] ?? "");
      const nextPz = Math.max(0, curPz + deltaPz);
      const nextGr = Math.min(MAX_GR, Math.max(0, curGr + deltaGr));

      setQtyPzMap((prev) => ({ ...prev, [itemId]: String(nextPz) }));
      setQtyGrMap((prev) => ({ ...prev, [itemId]: nextGr > 0 ? String(nextGr) : "" }));

      setAddPzMap((prev) => ({ ...prev, [itemId]: "" }));
      setAddGrMap((prev) => ({ ...prev, [itemId]: "" }));

      ensureScannedPresence(itemId, isActiveWithOverrides(it, { pz: nextPz, gr: nextGr }));
      highlightAndMoveToTop(itemId);
      return;
    }

    if (!isMlItem(it)) {
      const delta = safeIntFromStr(addPzMap[itemId] ?? "");
      if (delta <= 0) return;

      const cur = safeIntFromStr(qtyPzRef.current[itemId] ?? "");
      const next = Math.max(0, cur + delta);
      setQtyPzMap((prev) => ({ ...prev, [itemId]: String(next) }));
      setAddPzMap((prev) => ({ ...prev, [itemId]: "" }));

      ensureScannedPresence(itemId, isActiveWithOverrides(it, { pz: next }));
      highlightAndMoveToTop(itemId);
      return;
    }

    const mode = mlModeRef.current[itemId] || "fixed";

    if (mode === "mixed") {
      const deltaMl = safeIntFromStr(addTotalMlMap[itemId] ?? "");
      if (deltaMl <= 0) return;

      const cur = safeIntFromStr(totalMlRef.current[itemId] ?? "");
      const next = Math.max(0, cur + deltaMl);
      setTotalMlMap((prev) => ({ ...prev, [itemId]: String(next) }));
      setAddTotalMlMap((prev) => ({ ...prev, [itemId]: "" }));

      ensureScannedPresence(itemId, isActiveWithOverrides(it, { totalMl: next, mlMode: "mixed" }));
      highlightAndMoveToTop(itemId);
      return;
    }

    const deltaPz = safeIntFromStr(addPzMap[itemId] ?? "");
    const deltaOpen = safeIntFromStr(addOpenMlMap[itemId] ?? "");
    if (deltaPz <= 0 && deltaOpen <= 0) return;

    const curPz = safeIntFromStr(qtyPzRef.current[itemId] ?? "");
    const curOpen = safeIntFromStr(openMlRef.current[itemId] ?? "");
    const nextPz = Math.max(0, curPz + deltaPz);
    const nextOpen = Math.max(0, curOpen + deltaOpen);

    setQtyPzMap((prev) => ({ ...prev, [itemId]: String(nextPz) }));
    setOpenMlMap((prev) => ({ ...prev, [itemId]: String(nextOpen) }));

    setAddPzMap((prev) => ({ ...prev, [itemId]: "" }));
    setAddOpenMlMap((prev) => ({ ...prev, [itemId]: "" }));

    ensureScannedPresence(itemId, isActiveWithOverrides(it, { pz: nextPz, openMl: nextOpen, mlMode: "fixed" }));
    highlightAndMoveToTop(itemId);
  }

   // ✅ RIMUOVI un singolo articolo dalla lista scansionati + azzera tutto
  function removeFromScanned(itemId: string) {
    // azzero quantità
    setQtyPzMap((prev) => ({ ...prev, [itemId]: "" }));
    setQtyGrMap((prev) => ({ ...prev, [itemId]: "" }));
    setOpenMlMap((prev) => ({ ...prev, [itemId]: "" }));
    setTotalMlMap((prev) => ({ ...prev, [itemId]: "" }));

    // azzero anche i campi "da aggiungere"
    setAddPzMap((prev) => ({ ...prev, [itemId]: "" }));
    setAddGrMap((prev) => ({ ...prev, [itemId]: "" }));
    setAddOpenMlMap((prev) => ({ ...prev, [itemId]: "" }));
    setAddTotalMlMap((prev) => ({ ...prev, [itemId]: "" }));

    // tolgo dalla lista
    setScannedIds((prev) => prev.filter((id) => id !== itemId));

    // se era evidenziato, pulisco
    setHighlightScannedId((prev) => (prev === itemId ? null : prev));

    // se era in focus, lo chiudo
    setFocusItemId((prev) => (prev === itemId ? null : prev));
  }

  function clearScannedList() {
    setQtyPzMap((prev) => {
      const next = { ...prev };
      scannedIds.forEach((id) => (next[id] = ""));
      return next;
    });

    setQtyGrMap((prev) => {
      const next = { ...prev };
      scannedIds.forEach((id) => (next[id] = ""));
      return next;
    });

    setOpenMlMap((prev) => {
      const next = { ...prev };
      scannedIds.forEach((id) => (next[id] = ""));
      return next;
    });

    setTotalMlMap((prev) => {
      const next = { ...prev };
      scannedIds.forEach((id) => (next[id] = ""));
      return next;
    });

    setScannedIds([]);
    setShowAllScanned(false);
    setAddPzMap({});
    setAddGrMap({});
    setAddOpenMlMap({});
    setAddTotalMlMap({});
    setHighlightScannedId(null);

    setFocusItemId(null);
    setRapidView("scan");
    setSearch("");
    setMsg(null);
    setError(null);
    setCategoryNote("");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
      });
    });
  }

  function openItemInRapid(it: Item) {
  setMsg(null);
  setError(null);
  setFocusItemId(it.id);
  setRapidView("scan");
  setSearch("");

  // ✅ NON aggiungere automaticamente agli scansionati se non ha quantità
  // Se è già "attivo" (qty > 0 / ml > 0 / gr > 0) allora lo metto in cima.
  const activeNow = isActiveWithOverrides(it);

  setScannedIds((prev) => {
    const has = prev.includes(it.id);

    if (activeNow) {
      // metti in cima (o aggiungi se manca)
      return has ? [it.id, ...prev.filter((x) => x !== it.id)] : [it.id, ...prev];
    }

    // se non è attivo NON deve stare in lista (e se c'era per sbaglio lo tolgo)
    return has ? prev.filter((x) => x !== it.id) : prev;
  });

  setHighlightScannedId(it.id);

  requestAnimationFrame(() => {
    scrollIntoViewById(`inv-scanned-row-${it.id}`);
    scrollIntoViewById(`inv-item-row-${it.id}`);
  });
}

  function focusRapidQtyNow(it: Item) {
  const ml = isMlItem(it);
  const kg = isKgItem(it) && !ml;

  // IMPORTANTISSIMO iOS: focus deve avvenire subito nel tap
  requestAnimationFrame(() => {
    if (kg) {
      rapidGrInputRef.current?.focus();
      rapidGrInputRef.current?.select?.();
      return;
    }
    if (ml) {
      rapidMlInputRef.current?.focus();
      rapidMlInputRef.current?.select?.();
      return;
    }
    rapidPzInputRef.current?.focus();
    rapidPzInputRef.current?.select?.();
  });
}

  function handleScanEnter(rawOverride?: string, fromScanner?: boolean) {
  const raw = String(rawOverride ?? search);
  const qNorm = normText(raw);

  if (!qNorm) return;

  console.log("[SEARCH DEBUG]", {
  qNorm,
  itemsLen: items.length,
  hasTwix: items.some((x) => normText(x.code) === "twix"),
});

  const digits = onlyDigits(qNorm);
  const isLikelyBarcode = digits.length >= 8;

  let found: Item | undefined;

  if (isLikelyBarcode) {
    found = items.find((it) => {
      const bcDigits = onlyDigits(normText(it.barcode));
      const codeDigits = onlyDigits(normText(it.code));
      return (bcDigits && bcDigits === digits) || (codeDigits && codeDigits === digits);
    });

    if (!found) {
      found = items.find((it) => {
        const bcDigits = onlyDigits(normText(it.barcode));
        return digits && bcDigits.includes(digits);
      });
    }
  } else {
    // 1) match esatto su CODE
    found = items.find((it) => normText(it.code) === qNorm);

    // 2) startsWith su CODE
    if (!found) {
      found = items.find((it) => normText(it.code).startsWith(qNorm));
    }

    // 3) includes su DESCRIZIONE
    if (!found) {
      found = items.find((it) => normText(it.description).includes(qNorm));
    }

    // 4) includes su CODE (fallback)
    if (!found) {
      found = items.find((it) => normText(it.code).includes(qNorm));
    }
  }

  setSearch("");
  setSuggestionsOpen(false);

  if (!found) {
    // ✅ se sembra un barcode, apro flusso di associazione
    if (isLikelyBarcode && digits) {
      setMsg(null);
      setError(null);
      setUnknownBarcode(digits);
      setAssocStep("confirm");
      setAssocQuery("");
      setAssocResults([]);
      setAssocError(null);
      requestAnimationFrame(() => focusSearchSoon());
      return;
    }

    setMsg(null);
    setError("Articolo non trovato.");
    requestAnimationFrame(() => focusSearchSoon());
    return;
  }

  setError(null);
  setMsg(null);

  if (fromScanner) vibrateOk();

  openItemInRapid(found);
}

  async function runAssocSearch(q: string) {
    const qq = String(q || "").trim();
    if (qq.length < 2) {
      setAssocResults([]);
      return;
    }

    setAssocLoading(true);
    setAssocError(null);

    try {
      const res = await fetch(`/api/items/search?q=${encodeURIComponent(qq)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore ricerca articoli");

      const rows: Item[] = Array.isArray(json?.rows) ? json.rows : [];
      setAssocResults(rows);
    } catch (e: any) {
      setAssocResults([]);
      setAssocError(e?.message || "Errore ricerca articoli");
    } finally {
      setAssocLoading(false);
    }
  }

  async function assignBarcodeToItemPrimary(itemId: string) {
    const bc = String(unknownBarcode || "").trim();
    if (!bc) return;

    setAssocLoading(true);
    setAssocError(null);
    try {
      const res = await fetch("/api/items/assign-barcode-primary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, barcode: bc }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore assegnazione barcode");

      const updated: Item = json?.row;
      // ✅ aggiorno items in memoria, così da riconoscere subito il barcode
      setItems((prev) => {
        const has = prev.some((it) => it.id === updated.id);
        if (has) return prev.map((it) => (it.id === updated.id ? { ...it, barcode: bc } : it));
        return [{ ...updated, barcode: bc }, ...prev];
      });

      // ✅ chiudo modale
      setAssocStep(null);
      setUnknownBarcode(null);
      setAssocQuery("");
      setAssocResults([]);
      setAssocError(null);

      // ✅ continuo inventario: apro l'articolo appena associato
      const toOpen = { ...updated, barcode: bc };
      openItemInRapid(toOpen);
      setMsg(`Barcode ${bc} associato a ${toOpen.code}.`);
      setError(null);
    } catch (e: any) {
      setAssocError(e?.message || "Errore assegnazione barcode");
    } finally {
      setAssocLoading(false);
    }
  }

  function onScannerDetected(rawValue: string) {
    const v = String(rawValue || "").trim();
    if (!v) return;
    setScannerOpen(false);
    handleScanEnter(v, true);
  }

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento PV");
    setPvs(json.rows || []);
    const initPv = initFromUrlValuesRef.current?.pvId;
    if (!initPv && !pvId && (json.rows?.[0]?.id ?? "")) setPvId(json.rows[0].id);
  }

  async function loadCategories() {
    const res = await fetch("/api/categories/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento categorie");
    setCategories(json.rows || []);

    const initCat = initFromUrlValuesRef.current?.categoryId;
    const firstId = json.rows?.[0]?.id ?? "";

    if (initCat && !categoryId) {
      setCategoryId(initCat);
      return;
    }
  }

  async function loadSubcategories(nextCategoryId: string) {
    setSubcategories([]);

    if (inventoryMode === "rapid") return;
    if (!nextCategoryId) return;

    const res = await fetch(`/api/subcategories/list?category_id=${encodeURIComponent(nextCategoryId)}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento sottocategorie");
    setSubcategories(json.rows || []);
    setFocusItemId(null);
  }

  async function loadItems(nextCategoryId: string, nextSubcategoryId: string) {
    setItems([]);
    setQtyPzMap({});
    setQtyGrMap({});
    setOpenMlMap({});
    setTotalMlMap({});
    setMlModeMap({});
    setSearch("");
    setScannedIds([]);
    setShowAllScanned(false);
    setAddPzMap({});
    setAddGrMap({});
    setAddOpenMlMap({});
    setAddTotalMlMap({});
    setHighlightScannedId(null);
    setFocusItemId(null);

    if (inventoryMode === "rapid" || !nextCategoryId) {
      if (inventoryMode !== "rapid") return;

      const resAll = await fetch(`/api/items/list_all?limit=5000`, { cache: "no-store" });
      const jsonAll = await resAll.json().catch(() => null);
      if (!resAll.ok || !jsonAll?.ok) throw new Error(jsonAll?.error || "Errore caricamento articoli");

      const rowsAll: Item[] = (jsonAll.rows || []).map((r: any) => ({
        ...r,
        category_id: r?.category_id ?? null,
        subcategory_id: r?.subcategory_id ?? null,
        volume_ml_per_unit: r?.volume_ml_per_unit ?? null,
        um: r?.um ?? null,
        peso_kg: r?.peso_kg ?? null,
      }));

      const pz: Record<string, string> = {};
      const gr: Record<string, string> = {};
      const open: Record<string, string> = {};
      const total: Record<string, string> = {};
      const mode: Record<string, MlInputMode> = {};

      rowsAll.forEach((it) => {
        pz[it.id] = "";
        gr[it.id] = "";
        open[it.id] = "";
        if (isMlItem(it)) {
          total[it.id] = "";
          mode[it.id] = "fixed";
        }
      });

      setQtyPzMap(pz);
      setQtyGrMap(gr);
      setOpenMlMap(open);
      setTotalMlMap(total);
      setMlModeMap(mode);

      setItems(rowsAll);
      return;
    }

    const params = new URLSearchParams();
    params.set("category_id", nextCategoryId);
    if (nextSubcategoryId) params.set("subcategory_id", nextSubcategoryId);
    params.set("limit", "1000");

    const res = await fetch(`/api/items/list?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento articoli");

    const rows: Item[] = (json.rows || []).map((r: any) => ({
      ...r,
      volume_ml_per_unit: r?.volume_ml_per_unit ?? null,
      um: r?.um ?? null,
      peso_kg: r?.peso_kg ?? null,
    }));

    const pz: Record<string, string> = {};
    const gr: Record<string, string> = {};
    const open: Record<string, string> = {};
    const total: Record<string, string> = {};
    const mode: Record<string, MlInputMode> = {};

    rows.forEach((it) => {
      pz[it.id] = "";
      gr[it.id] = "";
      open[it.id] = "";
      if (isMlItem(it)) {
        total[it.id] = "";
        mode[it.id] = "fixed";
      }
    });

    setQtyPzMap(pz);
    setQtyGrMap(gr);
    setOpenMlMap(open);
    setTotalMlMap(total);
    setMlModeMap(mode);
    setItems(rows);
  }

  async function prefillFromServer(currentItems: Item[]): Promise<number> {
    if (!pvId || !inventoryDate) return 0;
    if (!isIsoDate(inventoryDate)) return 0;
    if (!currentItems?.length) return 0;
    if (inventoryMode !== "rapid" && !categoryId) return 0;

    setPrefillLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("pv_id", pvId);
      params.set("inventory_date", inventoryDate);

  if (inventoryMode === "rapid") {
  params.set("category_id", "null");
  params.set("subcategory_id", "null");
  params.set("rapid_session_id", rapidSessionId);
} else {
  params.set("category_id", categoryId);
  if (subcategoryId) params.set("subcategory_id", subcategoryId);
  else params.set("subcategory_id", "null");
}

      const res = await fetch(`/api/inventories/rows?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) return 0;

      if (!operatore.trim() && typeof json?.operatore === "string" && json.operatore.trim()) {
        setOperatore(json.operatore.trim());
      }
      if (!categoryNote.trim() && typeof json?.label === "string" && json.label.trim()) {
       setCategoryNote(json.label.trim());
      }

      const apiRows = (json.rows || []) as InventoryRowApi[];
      if (!Array.isArray(apiRows) || apiRows.length === 0) return 0;

      const itemSet = new Set(currentItems.map((x) => x.id));
      const mlItemSet = new Set(currentItems.filter(isMlItem).map((x) => x.id));

      const codeToId = new Map<string, string>();
      for (const it of currentItems) {
        const codeNorm = String(it.code || "").trim().toUpperCase();
        if (!codeNorm) continue;
        if (!codeToId.has(codeNorm)) codeToId.set(codeNorm, it.id);
      }

      function resolveTargetId(r: InventoryRowApi): string | null {
        const id = String(r?.item_id || "").trim();
        if (id && itemSet.has(id)) return id;

        const codeNorm = String((r as any)?.code || "").trim().toUpperCase();
        return codeNorm && codeToId.has(codeNorm) ? codeToId.get(codeNorm)! : null;
      }

      setQtyPzMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          const targetId = resolveTargetId(r);
          if (!targetId) continue;
          const q = Number((r as any).qty) || 0;
          next[targetId] = q > 0 ? String(Math.trunc(q)) : "";
        }
        return next;
      });

      setQtyGrMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          const targetId = resolveTargetId(r);
          if (!targetId) continue;
          const g = Number((r as any).qty_gr ?? 0) || 0;
          const gg = Math.min(MAX_GR, Math.max(0, Math.trunc(g)));
          next[targetId] = gg > 0 ? String(gg) : "";
        }
        return next;
      });

      setOpenMlMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          const targetId = resolveTargetId(r);
          if (!targetId) continue;
          if (!mlItemSet.has(targetId)) continue;

          const mlOpen = Number((r as any).ml_open ?? 0) || 0;
          next[targetId] = mlOpen > 0 ? String(Math.trunc(mlOpen)) : "";
        }
        return next;
      });

      setTotalMlMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          const targetId = resolveTargetId(r);
          if (!targetId) continue;
          if (!mlItemSet.has(targetId)) continue;

          const total = Number((r as any).qty_ml ?? 0) || 0;
          next[targetId] = total > 0 ? String(Math.trunc(total)) : "";
        }
        return next;
      });

      const ids: string[] = [];
      for (const r of apiRows) {
        const targetId = resolveTargetId(r);
        if (!targetId) continue;

        const q = Number((r as any).qty) || 0;
        const qml = Number((r as any).qty_ml) || 0;
        const qgr = Number((r as any).qty_gr ?? 0) || 0;

        if (q > 0 || qml > 0 || qgr > 0) ids.push(targetId);
      }

      if (ids.length) {
        const seen = new Set<string>();
        const dedup = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
        setScannedIds(dedup);
        setShowAllScanned(false);
        setHighlightScannedId(null);
      }

      return apiRows.length;
    } finally {
      setPrefillLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadPvs(), loadCategories()]);
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
      setError(null);
      try {
        await loadSubcategories(categoryId);
        await loadItems(categoryId, subcategoryId || initFromUrlValuesRef.current?.subcategoryId || "");
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, inventoryMode]);

  useEffect(() => {
    if (inventoryMode === "rapid") return;

    if (!categoryId) return;
    (async () => {
      setError(null);
      try {
        await loadItems(categoryId, subcategoryId || "");
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subcategoryId]);

  useEffect(() => {
  if (!pvId || !inventoryDate) return;
  if (!isIsoDate(inventoryDate)) return;
  if (!items.length) return;

  const effCat = inventoryMode === "rapid" ? "null" : categoryId || "";
  if (!effCat) return;

  // ✅ IMPORTANTISSIMO: in Rapido la chiave deve includere la sessione
  const effSub = inventoryMode === "rapid" ? (rapidSessionId || "null") : subcategoryId || "null";

  const key = `prefill:${pvId}:${effCat}:${effSub}:${inventoryDate}`;
  if (lastPrefillKeyRef.current === key) return;
  lastPrefillKeyRef.current = key;

  (async () => {
    const applied = await prefillFromServer(items);
    ensureMlDefaults(items);

    if (!(reopenModeRef.current && applied > 0)) {
      loadDraftIfAny(items);
    }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [pvId, categoryId, subcategoryId, rapidSessionId, inventoryDate, items.length, inventoryMode]);

  function resetAfterClose() {
    setOperatore("");
    setCategoryNote("");
    setSearch("");
    setScannedIds([]);
    setShowAllScanned(false);
    setAddPzMap({});
    setAddGrMap({});
    setAddOpenMlMap({});
    setAddTotalMlMap({});
    setHighlightScannedId(null);
    setFocusItemId(null);

    setQtyPzMap((prev) => {
      const next: Record<string, string> = { ...prev };
      items.forEach((it) => (next[it.id] = ""));
      return next;
    });

    setQtyGrMap((prev) => {
      const next: Record<string, string> = { ...prev };
      items.forEach((it) => (next[it.id] = ""));
      return next;
    });

    setOpenMlMap((prev) => {
      const next: Record<string, string> = { ...prev };
      items.forEach((it) => (next[it.id] = ""));
      return next;
    });

    setTotalMlMap((prev) => {
      const next: Record<string, string> = { ...prev };
      items.forEach((it) => {
        if (isMlItem(it)) next[it.id] = "";
      });
      return next;
    });

      // ✅ Rapido: nuova sessione per NON sovrascrivere inventari stesso PV+giorno
  setRapidSessionId(newRapidSessionId());
  lastPrefillKeyRef.current = "";

    clearDraft();
  }

  async function save(mode: "close" | "continue") {
    if (!canSave) return;

    const dateToUse = inventoryDate.trim();
    if (!isIsoDate(dateToUse)) {
      setError("Data inventario non valida (YYYY-MM-DD).");
      return;
    }

    setSaving(true);
    setMsg(null);
    setError(null);

    try {
      const rows = items
        .map((it) => {
          if (isMlItem(it)) {
            const m = getMlMode(it.id);
            if (m === "mixed") {
              const totalMl = safeIntFromStr(totalMlMap[it.id] ?? "");
              if (totalMl <= 0) return { item_id: it.id, qty: 0, qty_ml: 0, qty_gr: 0, ml_mode: "mixed" as const };
              return { item_id: it.id, qty: 0, qty_ml: totalMl, qty_gr: 0, ml_mode: "mixed" as const };
            }

            const perUnit = Number(it.volume_ml_per_unit) || 0;
            const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
            const open = safeIntFromStr(openMlMap[it.id] ?? "");
            const qty_ml = perUnit > 0 ? pz * perUnit + open : open;

            if (qty_ml <= 0) return { item_id: it.id, qty: 0, qty_ml: 0, qty_gr: 0, ml_mode: "fixed" as const };
            return { item_id: it.id, qty: pz, qty_ml, qty_gr: 0, ml_mode: "fixed" as const };
          }

          const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
          const gr = isKgItem(it) ? safeGrFromStr(qtyGrMap[it.id] ?? "") : 0;

          if (pz <= 0 && gr <= 0) return { item_id: it.id, qty: 0, qty_ml: 0, qty_gr: 0 };
          return { item_id: it.id, qty: pz, qty_ml: 0, qty_gr: gr };
        })
        .filter((r: any) => (Number(r.qty) || 0) > 0 || (Number(r.qty_ml) || 0) > 0 || (Number(r.qty_gr) || 0) > 0);

      if (rows.length === 0) {
        setError("Nessuna riga con quantità > 0. Inserisci almeno un valore prima di salvare.");
        return;
      }

const basePayload = {
  pv_id: pvId,
  category_id: inventoryMode === "rapid" ? null : categoryId,
  subcategory_id: inventoryMode === "rapid" ? null : subcategoryId || null,
  inventory_date: dateToUse,
  operatore: operatore.trim(),

  // ✅ Nota rapida (salvata in inventories_headers.label)
  label: inventoryMode === "rapid" ? (categoryNote.trim() || null) : null,

  rows,
  mode,

  // ✅ Rapido: chiave anti-sovrascrittura (UUID)
  rapid_session_id: inventoryMode === "rapid" ? rapidSessionId : null,
};

if (inventoryMode === "rapid" && !isUuid(rapidSessionId)) {
  setError("Rapido: rapid_session_id non valido. Premi Nuovo/Pulisci e riprova.");
  return;
}

console.log(
  "SAVE DEBUG → rapidSessionId(state):",
  rapidSessionId,
  "| inventoryMode:",
  inventoryMode,
  "| payload rapid_session_id:",
  (basePayload as any).rapid_session_id,
  "| payload keys:",
  Object.keys(basePayload as any)
);

      let res = await fetch("/api/inventories/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(basePayload),
      });

      let json = await res.json().catch(() => null);

      // ✅ Se esiste già: chiedi conferma e, SOLO se ok, ritenta con force_overwrite=true
      if (res.status === 409 || json?.code === "INVENTORY_ALREADY_EXISTS") {
        const ok = window.confirm(
          (json?.error || "Esiste già un inventario per questa combinazione.") +
            "\n\nVuoi SOVRASCRIVERLO? (attenzione: perdi i dati precedenti)"
        );

        if (!ok) {
          setMsg(null);
          setError("Salvataggio annullato. Inventario precedente lasciato intatto.");
          return;
        }

        res = await fetch("/api/inventories/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...basePayload, force_overwrite: true }),
        });

        json = await res.json().catch(() => null);
      }

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Salvataggio fallito");

      setMsg(mode === "continue" ? `Salvato. Puoi continuare. — righe: ${json.saved}` : `Salvataggio OK — righe: ${json.saved}`);

      if (mode === "close") {
        resetAfterClose();
      } else {
        persistDraft();
      }
    } catch (e: any) {
      setError(e?.message || "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  const focusItem = focusItemId ? items.find((x) => x.id === focusItemId) : null;

  function MlModeToggle({ itemId }: { itemId: string }) {
    const m = getMlMode(itemId);
    return (
      <div className="inline-flex rounded-xl border overflow-hidden">
        <button
          type="button"
          className={`px-3 py-1 text-xs ${m === "fixed" ? "bg-slate-900 text-white" : "bg-white hover:bg-gray-50"}`}
          onClick={() => setMlMode(itemId, "fixed")}
          title="Formato fisso: PZ + ML aperti"
        >
          PZ + ML
        </button>
        <button
          type="button"
          className={`px-3 py-1 text-xs ${m === "mixed" ? "bg-slate-900 text-white" : "bg-white hover:bg-gray-50"}`}
          onClick={() => setMlMode(itemId, "mixed")}
          title="Formati misti: inserisci solo Totale ML"
        >
          Solo Tot ML
        </button>
      </div>
    );
  }

  function InventoryModeToggle() {
  return (
    <div className="inline-flex rounded-xl border overflow-hidden w-full md:w-auto">
      <div className="flex-1 px-3 py-2 text-sm bg-slate-900 text-white text-center">
        Rapido
      </div>
    </div>
  );
}

  function focusSearchSoon() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = searchInputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    });
  }

  function afterRapidAction() {
    if (rapidAutoCloseTimerRef.current != null) {
      window.clearTimeout(rapidAutoCloseTimerRef.current);
      rapidAutoCloseTimerRef.current = null;
    }
    setRapidPzPreview(null);
    setSearch("");
    setFocusItemId(null);
    setRapidView("scan");
    focusSearchSoon();
  }

  function scheduleRapidAutoClose() {
    if (rapidAutoCloseTimerRef.current != null) {
      window.clearTimeout(rapidAutoCloseTimerRef.current);
    }
    rapidAutoCloseTimerRef.current = window.setTimeout(() => {
      rapidAutoCloseTimerRef.current = null;
      setRapidPzPreview(null);
      afterRapidAction();
    }, RAPID_AUTO_CLOSE_MS);
  }

  useEffect(() => {
    if (rapidAutoCloseTimerRef.current != null) {
      window.clearTimeout(rapidAutoCloseTimerRef.current);
      rapidAutoCloseTimerRef.current = null;
    }
    setRapidPzPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId, rapidView]);

  useEffect(() => {
    if (inventoryMode !== "rapid") return;
    if (rapidView !== "scan") return;
    if (!focusItemId) return;

    const it = items.find((x) => x.id === focusItemId);
    if (!it) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ml = isMlItem(it);
        const kg = isKgItem(it) && !ml;

        if (kg) {
          rapidGrInputRef.current?.focus();
          rapidGrInputRef.current?.select?.();
          return;
        }

        if (ml) {
          rapidMlInputRef.current?.focus();
          rapidMlInputRef.current?.select?.();
          return;
        }

        rapidPzInputRef.current?.focus();
        rapidPzInputRef.current?.select?.();
      });
    });
  }, [inventoryMode, rapidView, focusItemId, items]);

  function bumpPz(itemId: string, delta: number) {
    if (delta <= 0) return;
    const it = items.find((x) => x.id === itemId);
    const cur = safeIntFromStr(qtyPzRef.current[itemId] ?? "");
    const next = Math.max(0, cur + delta);

    setQtyPzMap((prev) => ({ ...prev, [itemId]: String(next) }));
    setHighlightScannedId(itemId);

    if (it) {
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { pz: next }));
      highlightAndMoveToTop(itemId);
    }
  }

  function bumpGr(itemId: string, deltaGr: number) {
    if (deltaGr <= 0) return;
    const it = items.find((x) => x.id === itemId);
    const cur = safeGrFromStr(qtyGrRef.current[itemId] ?? "");
    const next = Math.min(MAX_GR, Math.max(0, cur + deltaGr));

    setQtyGrMap((prev) => ({ ...prev, [itemId]: next > 0 ? String(next) : "" }));
    setHighlightScannedId(itemId);

    if (it) {
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { gr: next }));
      highlightAndMoveToTop(itemId);
    }
  }

  function bumpOpenMl(itemId: string, deltaMl: number) {
    if (deltaMl <= 0) return;
    const it = items.find((x) => x.id === itemId);
    const cur = safeIntFromStr(openMlRef.current[itemId] ?? "");
    const next = Math.max(0, cur + deltaMl);

    setOpenMlMap((prev) => ({ ...prev, [itemId]: String(next) }));
    setHighlightScannedId(itemId);

    if (it) {
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { openMl: next }));
      highlightAndMoveToTop(itemId);
    }
  }

  function bumpTotalMl(itemId: string, deltaMl: number) {
    if (deltaMl <= 0) return;
    const it = items.find((x) => x.id === itemId);
    const cur = safeIntFromStr(totalMlRef.current[itemId] ?? "");
    const next = Math.max(0, cur + deltaMl);

    setTotalMlMap((prev) => ({ ...prev, [itemId]: String(next) }));
    setHighlightScannedId(itemId);

    if (it) {
      ensureScannedPresence(itemId, isActiveWithOverrides(it, { totalMl: next }));
      highlightAndMoveToTop(itemId);
    }
  }

  return (
    <div className={`space-y-4 ${isRapidMobileBar ? "pb-28 md:pb-0" : ""}`}>
      {/* Filtri */}
      <div className="rounded-2xl border bg-white p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">Punto Vendita</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={pvId} onChange={(e) => setPvId(e.target.value)} disabled={loading}>
            {pvs.map((pv) => (
              <option key={pv.id} value={pv.id}>
                {pv.code} — {pv.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Categoria</label>
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={categoryId}
            onChange={(e) => {
              if (inventoryMode === "rapid") {
                forceRapidCategoryNull();
                return;
              }
              const next = e.target.value;
              setCategoryId(next);
              setSubcategoryId("");
              setMsg(null);
              setError(null);
            }}
            disabled={loading || inventoryMode === "rapid"}
          >
            <option value="">{inventoryMode === "rapid" ? "— Nessuna (Tutte) —" : "— Seleziona —"}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Sottocategoria</label>
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={subcategoryId}
            onChange={(e) => {
              if (inventoryMode === "rapid") {
                forceRapidCategoryNull();
                return;
              }
              setSubcategoryId(e.target.value);
              setMsg(null);
              setError(null);
            }}
            disabled={loading || inventoryMode === "rapid" || subcategories.length === 0}
          >
            <option value="">— Nessuna —</option>
            {subcategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">Se non ci sono sottocategorie, lascia “Nessuna”.</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Data inventario</label>
          <input type="date" className="w-full rounded-xl border p-3 bg-white" value={inventoryDate} onChange={(e) => setInventoryDate(e.target.value)} />
        </div>
      </div>

            {/* Operatore + Nota categoria */}
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-2">Nome Operatore</label>
          <input
            className="w-full rounded-xl border p-3"
            placeholder="Es. Mario Rossi"
            value={operatore}
            onChange={(e) => setOperatore(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">Obbligatorio per salvare lo storico e generare l’Excel.</p>

          <div className="mt-2 text-xs text-gray-600">
            Nome categoria (nota):{" "}
            <b className={categoryNote.trim() ? "" : "text-gray-400"}>
              {categoryNote.trim() ? categoryNote.trim() : "—"}
            </b>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700">Nome categoria (nota)</label>
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Es: Tabacchi / Bar / Banco frigo..."
            value={categoryNote}
            onChange={(e) => setCategoryNote(e.target.value)}
          />
        </div>
      </div>

      {/* Header azioni - mobile stack */}
      <div className="rounded-2xl border bg-white p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="text-sm text-gray-600">
          {items.length ? (
            <>
              Articoli caricati: <b>{items.length}</b>
              {prefillLoading && <span className="ml-2 text-xs text-gray-500">(Prefill inventario…)</span>}
            </>
          ) : (
            <>Seleziona una categoria per vedere gli articoli.</>
          )}
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
        

          <div className="grid grid-cols-3 gap-2 w-full md:w-auto">
  <button
    className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 w-full"
    disabled={!canSave || saving}
    onClick={() => save("continue")}
    type="button"
  >
    {saving ? "Salvo..." : "Salva e continua"}
  </button>

  <button
    className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60 w-full"
    disabled={!canSave || saving}
    onClick={() => save("close")}
    type="button"
  >
    {saving ? "Salvo..." : "Salva e chiudi"}
  </button>

  <button
    type="button"
    className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 w-full"
    disabled={saving}
    onClick={() => {
      const ok = window.confirm(
        "Vuoi ripartire da zero?\n\nQuesto NON salva e cancella la bozza in memoria (scansionati/quantità)."
      );
      if (!ok) return;

      // reset totale (come dopo 'Salva e chiudi' ma senza salvare)
      resetAfterClose();

      // importantissimo: evita che il prefill/draft “rientri” subito
      lastPrefillKeyRef.current = "";
      setRapidSessionId(newRapidSessionId());
      setMsg("Bozza pulita. Riparti da zero.");
      setError(null);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select?.();
        });
      });
    }}
    title="Pulisci tutto e riparti"
  >
    Nuovo / Pulisci
  </button>
</div>
        </div>
      </div>

      {/* ✅ SOLO RAPIDO (Standard disabilitato) */}
      <div className="space-y-4">
          {/* ====== RAPIDO: SEARCH BAR POS (fixed bottom on mobile) ====== */}
          <div
            className={[
              "border bg-white",
              "md:rounded-2xl md:p-4",
              isRapidMobileBar ? "fixed bottom-0 left-0 right-0 z-40 rounded-t-2xl p-3 shadow-[0_-10px_30px_rgba(0,0,0,0.12)] md:static md:shadow-none" : "rounded-2xl p-4",
            ].join(" ")}
          >
            <div className="flex items-start md:items-start justify-between gap-3">
              <div className="flex-1 relative">
                <label className={`block text-sm font-medium ${isRapidMobileBar ? "mb-1" : "mb-2"}`}>Scansiona / Cerca</label>

                <div className="flex gap-2">
                  <input
  ref={searchInputRef}
  className="w-full rounded-xl border p-3 text-base"
  placeholder="Barcode / codice / descrizione"
  value={search}

  onChange={(e) => {
    const v = e.target.value;
    setSearch(v);
    setMsg(null);
    setError(null);
    if (focusItemId) setFocusItemId(null);
    setRapidView("scan");

    // ✅ mobile: apri modal risultati
    if (typeof window !== "undefined") {
      const isMobile = window.matchMedia?.("(max-width: 767px)")?.matches;
      if (isMobile) setSuggestionsOpen(true);
    }
  }}

  onFocus={() => {
    // ✅ se rientro nel campo e c’è già testo, riapro modal su mobile
    if (typeof window !== "undefined") {
      const isMobile = window.matchMedia?.("(max-width: 767px)")?.matches;
      if (isMobile && search.trim().length >= 2) {
        setSuggestionsOpen(true);
      }
    }
  }}

  onKeyDown={(e) => {
  if (e.key === "Enter") {
    e.preventDefault();

    const v = (e.currentTarget as HTMLInputElement).value; // ✅ valore reale input
    handleScanEnter(v, false);

    setRapidView("scan");
    setSuggestionsOpen(false); // chiude modal se aperto
  }
}}
/>

                  <button
                    type="button"
                    className="shrink-0 rounded-xl border px-4 py-3 text-sm hover:bg-gray-50"
                    onClick={() => {
                      setMsg(null);
                      setError(null);
                      setScannerOpen(true);
                    }}
                    title="Scanner camera"
                  >
                    📷
                  </button>
                </div>

                {/* risultati live (desktop) */}
{search.trim().length >= 2 && filteredItems.length > 0 && (
  <div className="hidden md:block absolute z-20 mt-1 w-full rounded-xl border bg-white shadow-sm overflow-hidden">
    {filteredItems.slice(0, 12).map((it) => (
      <button
        key={it.id}
        type="button"
        className="w-full text-left px-3 py-2 hover:bg-gray-50"
        onClick={() => openItemInRapid(it)}
      >
        <div className="text-sm font-medium">{it.code}</div>
        <div className="text-xs text-gray-600 line-clamp-1">{it.description}</div>
      </button>
    ))}
  </div>
)}

                {!isRapidMobileBar && (
                  <div className="mt-2 text-xs text-gray-500">
                    Tip: in Rapido conviene lo scanner, ma ora puoi anche cercare per descrizione con suggestions live.
                  </div>
                )}
              </div>

              {/* CTA a destra: su mobile le rendiamo più grandi e “a pollice” */}
              <div className="shrink-0 flex flex-col gap-2">
                <button
                  type="button"
                  className="rounded-xl border px-4 py-3 text-sm hover:bg-gray-50"
                  onClick={() => setRapidView("list")}
                  title="Apri lista scansionati"
                >
                  Scansionati ({totScannedDistinct})
                </button>
              </div>
            </div>
          </div>

          {/* ✅ Mobile suggestions modal */}
{inventoryMode === "rapid" && suggestionsOpen && (
  <div className="fixed inset-0 z-[120] bg-black/60 md:hidden">
    <div className="absolute inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl bg-white shadow-xl">
      <div className="p-4 border-b flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Risultati</div>
          <div className="text-xs text-gray-500">
            {search.trim() ? `Ricerca: "${search.trim()}"` : "Digita per cercare"}
          </div>
        </div>

        <button
          type="button"
          className="rounded-xl border px-3 py-2 text-sm"
          onClick={() => setSuggestionsOpen(false)}
        >
          Chiudi
        </button>
      </div>

      <div className="p-2 overflow-auto max-h-[70vh]">
    {filteredItems.length === 0 ? (
  <div className="p-4 text-sm text-gray-500">Nessun risultato.</div>
) : (
  <div className="divide-y">
    {filteredItems.slice(0, 30).map((it) => (
      <button
        key={it.id}
        type="button"
        className="w-full text-left p-3 hover:bg-gray-50"
        onClick={() => {
          setSuggestionsOpen(false);
          openItemInRapid(it);
        }}
      >
        <div className="text-sm font-semibold">{it.code}</div>
        <div className="text-xs text-gray-600 line-clamp-2">{it.description}</div>
      </button>
    ))}
  </div>
)}
      </div>
    </div>
  </div>
)}

          {rapidView === "scan" && (
            <div className="rounded-2xl border bg-white p-4">
              {!focusItem ? (
                <div className="text-sm text-gray-500">Scansiona un articolo (o cerca e premi INVIO / clicca una suggestion). Qui comparirà un solo articolo con i pulsanti rapidi.</div>
              ) : (() => {
                  const it = focusItem;
                  const ml = isMlItem(it);
                  const kg = isKgItem(it) && !ml;
                  const mode = ml ? (mlModeRef.current[it.id] || "fixed") : null;

                  const perUnit = Number(it.volume_ml_per_unit) || 0;
                  const totalMl = ml ? calcTotalMl(it) : 0;

                  const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
                  const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");
                  const totalKg = kg ? calcTotalKg(it) : 0;

                  const pesoKg = Number(it.peso_kg ?? 0) || 0;
                  const totalGr = kg && pesoKg > 0 ? pz * Math.round(pesoKg * 1000) + gr : null;

                  const quickPz = [1, 5, 10];
                  const quickSmall = [25, 50, 100, 250, 500];

                  return (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">
                            {it.code} <span className="text-gray-400">—</span> {it.description}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {ml ? (
                              <>
                                ML item — per unit: <b>{perUnit || "—"}</b> ml — totale attuale: <b>{totalMl}</b> ({mlToLitriLabel(totalMl)})
                              </>
                            ) : kg ? (
                              <>
                                <div>
                                  <b>{pz}</b> pz + <b>{gr}</b> gr
                                </div>
                                <div className="text-xs text-gray-600">
                                  {totalGr != null ? (
                                    <>
                                      Tot: <b>{totalGr}</b> gr — <b>{totalKg.toFixed(3)}</b> kg
                                    </>
                                  ) : (
                                    <>
                                      Tot kg: <b>{totalKg.toFixed(3)}</b> — <span className="text-red-600">peso_kg mancante</span>
                                    </>
                                  )}
                                </div>
                              </>
                            ) : (
                              <>
                                PZ item — totale attuale: <b>{safeIntFromStr(qtyPzMap[it.id] ?? "")}</b> pz
                              </>
                            )}
                          </div>
                        </div>

                        <button type="button" className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => afterRapidAction()} title="Chiudi articolo e torna alla ricerca">
                          Chiudi
                        </button>
                      </div>

                      {ml && (
                        <div className="flex items-center gap-2">
                          <MlModeToggle itemId={it.id} />
                          <span className="text-xs text-gray-500">(in Rapido: userai soprattutto i pulsanti +ML)</span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="rounded-xl border p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="text-sm font-medium">PZ rapidi</div>
                            <div className="text-xs text-gray-600 rounded-full border px-2 py-1 bg-gray-50">
                              Tot: <b>{rapidPzPreview ?? safeIntFromStr(qtyPzMap[it.id] ?? "")}</b>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {quickPz.map((n) => (
                              <button
                                key={n}
                                type="button"
                                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                                onClick={() => {
                                  const base = rapidPzPreview ?? safeIntFromStr(qtyPzMap[it.id] ?? "");
                                  const next = Math.max(0, base + n);
                                  setRapidPzPreview(next);
                                  bumpPz(it.id, n);
                                  scheduleRapidAutoClose();
                                }}
                              >
                                +{n}
                              </button>
                            ))}
                          </div>
                     <div className="mt-3 space-y-2">
  {/* ✅ AGGIUNGI (delta) */}
  <div className="flex gap-2">
    <input
      className="w-full rounded-xl border p-2"
      inputMode="numeric"
      placeholder="+ pz (aggiungi)"
      value={addPzMap[it.id] ?? ""}
      onChange={(e) => setAddPzMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addQty(it.id);        // ✅ somma
          afterRapidAction();
        }
      }}
    />
    <button
      type="button"
      className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
      disabled={safeIntFromStr(addPzMap[it.id] ?? "") <= 0}
      onClick={() => {
        addQty(it.id);          // ✅ somma
        afterRapidAction();
      }}
    >
      Aggiungi
    </button>
  </div>

  {/* ✅ IMPOSTA (override) */}
  <div className="flex gap-2">
    <input
      ref={rapidPzInputRef}
      className="w-full rounded-xl border p-2"
      inputMode="numeric"
      placeholder="Imposta totale PZ (correzione)"
      value={qtyPzMap[it.id] ?? ""}
      onChange={(e) => setPz(it.id, e.target.value)} // ✅ sovrascrive (correzione)
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          afterRapidAction();
        }
      }}
    />
    <button
      type="button"
      className="rounded-xl border px-4 py-2"
      onClick={() => afterRapidAction()}
      title="Conferma correzione"
    >
      OK
    </button>
  </div>
</div>
                        </div>

                        <div className="rounded-xl border p-3">
                          <div className="text-sm font-medium mb-2">{kg ? "GR rapidi" : ml ? "ML rapidi" : "—"}</div>

                          {kg ? (
                            <>
                            
                            <div className="mt-3">
  <label className="block text-xs text-gray-500 mb-1">Totale GR (correzione)</label>
  <input
    ref={rapidGrInputRef}
    className="w-full rounded-xl border p-2"
    inputMode="numeric"
    placeholder="Es. 470"
    value={qtyGrMap[it.id] ?? ""}
    onChange={(e) => setGr(it.id, e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        afterRapidAction();
      }
    }}
  />
</div>
                              <div className="flex flex-wrap gap-2">
                                {quickSmall.map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                                    onClick={() => {
                                      bumpGr(it.id, n);
                                      scheduleRapidAutoClose();
                                    }}
                                  >
                                    +{n} gr
                                  </button>
                                ))}
                              </div>
                              <div className="mt-3 flex gap-2">
                                <input
                                  ref={rapidGrInputRef}
                                  className="w-full rounded-xl border p-2"
                                  inputMode="numeric"
                                  placeholder="+ gr (manuale)"
                                  value={addGrMap[it.id] ?? ""}
                                  onChange={(e) => setAddGrMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addQty(it.id);
                                      afterRapidAction();
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
                                  disabled={safeGrFromStr(addGrMap[it.id] ?? "") <= 0}
                                  onClick={() => {
                                    addQty(it.id);
                                    afterRapidAction();
                                  }}
                                >
                                  Aggiungi
                                </button>
                              </div>
                            </>
                          ) : ml ? (
                            <>
                              <div className="flex flex-wrap gap-2">
                                {quickSmall.map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                                    onClick={() => {
                                      if (mode === "mixed") bumpTotalMl(it.id, n);
                                      else bumpOpenMl(it.id, n);
                                      scheduleRapidAutoClose();
                                    }}
                                  >
                                    +{n} ml
                                  </button>
                                ))}
                              </div>

                              <div className="mt-3 flex gap-2">
                                {mode === "mixed" ? (
                                  <input
                                    ref={rapidMlInputRef}
                                    className="w-full rounded-xl border p-2"
                                    inputMode="numeric"
                                    placeholder="+ ml (manuale)"
                                    value={addTotalMlMap[it.id] ?? ""}
                                    onChange={(e) => setAddTotalMlMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        addQty(it.id);
                                        afterRapidAction();
                                      }
                                    }}
                                  />
                                ) : (
                                  <input
                                    ref={rapidMlInputRef}
                                    className="w-full rounded-xl border p-2"
                                    inputMode="numeric"
                                    placeholder="+ ml aperti (manuale)"
                                    value={addOpenMlMap[it.id] ?? ""}
                                    onChange={(e) => setAddOpenMlMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        addQty(it.id);
                                        afterRapidAction();
                                      }
                                    }}
                                  />
                                )}

                                <button
                                  type="button"
                                  className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
                                  disabled={mode === "mixed" ? safeIntFromStr(addTotalMlMap[it.id] ?? "") <= 0 : safeIntFromStr(addOpenMlMap[it.id] ?? "") <= 0}
                                  onClick={() => {
                                    addQty(it.id);
                                    afterRapidAction();
                                  }}
                                >
                                  Aggiungi
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-gray-400">N/A</div>
                          )}
                        </div>

                        <div className="rounded-xl border p-3 bg-gray-50">
                          <div className="text-sm font-medium mb-2">Riepilogo</div>
                          <div className="text-sm text-gray-700">
                            Scansionati: <b>{totScannedDistinct}</b>
                          </div>
                          <div className="text-sm text-gray-700">
                            Valore: <b>{formatEUR(totScannedValueEur)}</b>
                          </div>
                          <div className="text-xs text-gray-500 mt-2">Tip: qui aggiungiamo solo quanto serve. La lista completa la apri con “Scansionati”.</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
            </div>
          )}

          {rapidView === "list" && (
            <div className="rounded-2xl border bg-white p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Scansionati</div>
                  <div className="text-sm text-gray-600">
                    Articoli: <b>{totScannedDistinct}</b> — PZ (no-ML): <b>{totScannedPiecesNoMl}</b> — KG tot: <b>{totScannedKg.toFixed(3)}</b> — Tot ML: <b>{totScannedTotalMl}</b> (
                    {mlToLitriLabel(totScannedTotalMl)}) — Valore: <b>{formatEUR(totScannedValueEur)}</b>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      setRapidView("scan");
                      focusSearchSoon();
                    }}
                  >
                    Torna a scan
                  </button>

                  <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" disabled={scannedIds.length === 0} onClick={clearScannedList} type="button">
                    Svuota lista
                  </button>
                </div>
              </div>

              {scannedItems.length === 0 ? (
                <div className="text-sm text-gray-500">Nessun articolo scansionato.</div>
              ) : (
                <>
                  {/* MOBILE: cards */}
                  <div className="md:hidden space-y-2">
                    {scannedItems.map((it) => {
                      const ml = isMlItem(it);
                      const kg = isKgItem(it) && !ml;
                      const totalMl = ml ? calcTotalMl(it) : 0;
                      const totalKg = kg ? calcTotalKg(it) : 0;

                      const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
                      const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");

                      const price = Number(it.prezzo_vendita_eur) || 0;
                      let rowValue = 0;
                      if (ml) {
                        const perUnit = Number(it.volume_ml_per_unit) || 0;
                        rowValue = perUnit > 0 ? (totalMl / perUnit) * price : 0;
                      } else if (kg) {
                        rowValue = totalKg * price;
                      } else {
                        rowValue = pz * price;
                      }

                      return (
                        <div key={it.id} className="rounded-xl border p-3 bg-white">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold">{it.code}</div>
                              <div className="text-xs text-gray-600">{it.description}</div>
                            </div>
                            <button
                              type="button"
                              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                              onClick={() => {
                              flushSync(() => {
                             setSuggestionsOpen(false);
                             openItemInRapid(it);
                             });

                            setTimeout(() => focusRapidQtyNow(it), 0);
                            }}
                            >
                              Apri
                            </button>
                            <button
                            type="button"
                             className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                             onClick={() => removeFromScanned(it.id)}
                            >
                            Rimuovi
                            </button>
                          </div>

                          <div className="mt-2 text-sm">
                            {ml ? (
                              <>
                                Tot: <b>{totalMl}</b> ml <span className="text-gray-500">({mlToLitriLabel(totalMl)})</span>
                              </>
                            ) : kg ? (
                              <>
                                <b>{pz}</b> pz + <b>{gr}</b> gr — <b>{totalKg.toFixed(3)}</b> kg
                              </>
                            ) : (
                              <>
                                Tot: <b>{pz}</b> pz
                              </>
                            )}
                          </div>

                          <div className="mt-1 text-sm">
                            Valore: <b>{formatEUR(rowValue)}</b>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* DESKTOP: table */}
                  <div className="hidden md:block overflow-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left p-3 w-40">Codice</th>
                          <th className="text-left p-3">Descrizione</th>
                          <th className="text-left p-3 w-44">Totali</th>
                          <th className="text-right p-3 w-40">Valore</th>
                          <th className="text-right p-3 w-40">Azioni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scannedItems.map((it) => {
                          const ml = isMlItem(it);
                          const kg = isKgItem(it) && !ml;
                          const totalMl = ml ? calcTotalMl(it) : 0;
                          const totalKg = kg ? calcTotalKg(it) : 0;

                          const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
                          const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");

                          const price = Number(it.prezzo_vendita_eur) || 0;
                          let rowValue = 0;

                          if (ml) {
                            const perUnit = Number(it.volume_ml_per_unit) || 0;
                            rowValue = perUnit > 0 ? (totalMl / perUnit) * price : 0;
                          } else if (kg) {
                            rowValue = totalKg * price;
                          } else {
                            rowValue = pz * price;
                          }

                          return (
                            <tr id={`inv-scanned-row-${it.id}`} key={it.id} className="border-t">
                              <td className="p-3 font-medium">{it.code}</td>
                              <td className="p-3">{it.description}</td>
                              <td className="p-3">
                                {ml ? (
                                  <>
                                    <b>{totalMl}</b> ml
                                  </>
                                ) : kg ? (
                                  <>
                                    <b>{pz}</b> pz + <b>{gr}</b> gr — <b>{totalKg.toFixed(3)}</b> kg
                                  </>
                                ) : (
                                  <>
                                    <b>{pz}</b> pz
                                  </>
                                )}
                              </td>
                              <td className="p-3 text-right font-medium">{formatEUR(rowValue)}</td>

                              <td className="p-3 text-right">
                                <button type="button" className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => openItemInRapid(it)}>
                                  Apri
                                </button>
                                  <button
                                  type="button"
                                  className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                                  onClick={() => removeFromScanned(it.id)}
                                 >
                                   Rimuovi
                                 </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* ✅ Modal: barcode non riconosciuto -> associa a articolo */}
      {assocStep && unknownBarcode && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border p-4">
            {assocStep === "confirm" ? (
              <>
                <div className="text-lg font-semibold">Barcode non riconosciuto</div>
                <div className="mt-2 text-sm text-gray-700">
                  Barcode <span className="font-mono">{unknownBarcode}</span> non riconosciuto. Vuoi associarlo a un articolo già esistente?
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    className="rounded-xl border px-3 py-2 text-sm"
                    onClick={() => {
                      setAssocStep(null);
                      setUnknownBarcode(null);
                      setAssocQuery("");
                      setAssocResults([]);
                      setAssocError(null);
                      focusSearchSoon();
                    }}
                  >
                    No
                  </button>
                  <button
                    className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white"
                    onClick={() => {
                      setAssocStep("search");
                      setAssocQuery("");
                      setAssocResults([]);
                      setAssocError(null);
                      requestAnimationFrame(() => assocSearchRef.current?.focus());
                    }}
                  >
                    Sì
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-semibold">Associa barcode</div>
                <div className="mt-1 text-sm text-gray-700">
                  Barcode: <span className="font-mono">{unknownBarcode}</span>
                </div>

                <div className="mt-3">
                  <input
                    ref={assocSearchRef}
                    value={assocQuery}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAssocQuery(v);
                      // debounce leggero
                      window.clearTimeout((runAssocSearch as any)._t);
                      (runAssocSearch as any)._t = window.setTimeout(() => runAssocSearch(v), 180);
                    }}
                    placeholder="Cerca per codice o descrizione..."
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-xs text-gray-500">Minimo 2 caratteri</div>
                    {assocLoading && <div className="text-xs text-gray-500">Ricerca...</div>}
                  </div>
                  {assocError && <div className="mt-2 text-sm text-red-600">{assocError}</div>}
                </div>

                <div className="mt-3 max-h-72 overflow-auto rounded-xl border">
                  {assocResults.length === 0 ? (
                    <div className="p-3 text-sm text-gray-600">Nessun risultato.</div>
                  ) : (
                    <div className="divide-y">
                      {assocResults.map((it) => (
                        <button
                          key={it.id}
                          className="w-full text-left p-3 hover:bg-gray-50"
                          onClick={() => assignBarcodeToItemPrimary(it.id)}
                          disabled={assocLoading}
                          title="Clicca per associare"
                        >
                          <div className="text-sm font-semibold">{it.code}</div>
                          <div className="text-xs text-gray-600">{it.description}</div>
                          {it.barcode ? (
                            <div className="mt-1 text-[11px] text-gray-500">
                              Barcode attuale: <span className="font-mono">{it.barcode}</span>
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-gray-500">Barcode attuale: —</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    className="rounded-xl border px-3 py-2 text-sm"
                    onClick={() => {
                      setAssocStep("confirm");
                      setAssocQuery("");
                      setAssocResults([]);
                      setAssocError(null);
                    }}
                    disabled={assocLoading}
                  >
                    Indietro
                  </button>
                  <button
                    className="rounded-xl border px-3 py-2 text-sm"
                    onClick={() => {
                      setAssocStep(null);
                      setUnknownBarcode(null);
                      setAssocQuery("");
                      setAssocResults([]);
                      setAssocError(null);
                      focusSearchSoon();
                    }}
                    disabled={assocLoading}
                  >
                    Chiudi
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => {
          setScannerOpen(false);
          focusSearchSoon();
        }}
        onDetected={onScannerDetected}
        enableTorch
      />
    </div>
  );
}










