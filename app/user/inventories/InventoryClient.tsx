"use client";
import BarcodeScannerModal from "@/components/BarcodeScannerModal";
import { useEffect, useMemo, useRef, useState } from "react";
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

function onlyDigits(v: string) {
  return v.replace(/[^\d]/g, "");
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

  // ✅ Modalità inventario (Standard / Rapido)
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>("rapid");

  // ✅ Rapido: vista "scan" (focus su singolo articolo) oppure "list" (lista scansionati full)
  const [rapidView, setRapidView] = useState<"scan" | "list">("scan");

  const [pvs, setPvs] = useState<Pv[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [pvId, setPvId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [inventoryDate, setInventoryDate] = useState(todayISO());

  const [operatore, setOperatore] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setCategoryId("");
    setSubcategoryId("");
  }

  useEffect(() => {
    if (didInitFromUrlRef.current) return;
    didInitFromUrlRef.current = true;

    const pv = (searchParams?.get("pv_id") || "").trim();
    const date = (searchParams?.get("inventory_date") || "").trim();
    const op = (searchParams?.get("operatore") || "").trim();

    // ✅ supporto riapertura Rapido esplicita
    const m = (searchParams?.get("mode") || "").trim().toLowerCase();
    const isRapidUrl = m === "rapid";

    // ✅ Reopen: Standard richiede pv+cat+date, Rapido richiede pv+date
    reopenModeRef.current = isRapidUrl ? !!(pv && date) : false;

    // ✅ se URL dice rapid -> forzo rapid + categorie null (ignoro category_id/subcategory_id anche se presenti)
    if (isRapidUrl) {
      setInventoryMode("rapid");
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
    if (inventoryMode === "rapid") {
      forceRapidCategoryNull();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryMode]);

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
    const sub = subcategoryId || "null";
    const cat = categoryId || "ALL";
    return `inv_draft_admin:${pvId}:${cat}:${sub}:${inventoryDate}`;
  }, [pvId, categoryId, subcategoryId, inventoryDate]);

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
      const unitsEq = totalMl / perUnit; // es: 25400ml / 750ml = 33,86 "unità"
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
    const byId = new Map(items.map((it) => [it.id, it]));
    return scannedIds.map((id) => byId.get(id)).filter(Boolean) as Item[];
  }, [items, scannedIds]);

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

      // ML: valore = "unità equivalenti" * prezzo (€/unità)
      if (isMlItem(it)) {
        const totalMl = calcTotalMl(it);
        const perUnit = Number(it.volume_ml_per_unit) || 0;
        if (perUnit <= 0) return sum;
        const unitsEq = totalMl / perUnit;
        return sum + unitsEq * p;
      }

      // KG: valore = kg_totali * prezzo (€/kg)
      if (isKgItem(it)) {
        const totalKg = calcTotalKg(it); // kg totali (pz*peso_kg + gr/1000)
        return sum + totalKg * p;
      }

      // Standard: valore = pezzi * prezzo (€/pz)
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
        // prova a convertire l’attuale fixed in total
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

    // ✅ KG: aggiungo separatamente PZ e GR
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

    // ✅ reset UX coerente: torna a scan + search pronta
    setFocusItemId(null);
    setRapidView("scan");
    setSearch("");
    setMsg(null);
    setError(null);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
      });
    });
  }

  // ✅ selezione suggestion: stesso comportamento dello scan, ma senza Enter
  function openItemInRapid(it: Item) {
    setMsg(null);
    setError(null);
    setFocusItemId(it.id);
    setRapidView("scan");
    setSearch("");

    setScannedIds((prev) => (prev.includes(it.id) ? [it.id, ...prev.filter((x) => x !== it.id)] : [it.id, ...prev]));
    setHighlightScannedId(it.id);

    requestAnimationFrame(() => {
      scrollIntoViewById(`inv-scanned-row-${it.id}`);
      scrollIntoViewById(`inv-item-row-${it.id}`);
    });
  }

  // ✅ Scanner + Enter: trova articolo e mette focus
  function handleScanEnter(rawOverride?: string, fromScanner?: boolean) {
    const raw = String(rawOverride ?? search).trim();
    if (!raw) return;

    const q = raw.toLowerCase();
    const digits = onlyDigits(raw);
    const isLikelyBarcode = digits.length >= 8;

    let found: Item | undefined;

    if (isLikelyBarcode) {
      found = items.find((it) => {
        const bcDigits = onlyDigits(String(it.barcode ?? ""));
        const codeDigits = onlyDigits(String(it.code ?? ""));
        return (bcDigits && bcDigits === digits) || (codeDigits && codeDigits === digits);
      });

      if (!found) {
        found = items.find((it) => {
          const bcDigits = onlyDigits(String(it.barcode ?? ""));
          return digits && bcDigits.includes(digits);
        });
      }
    } else {
      found = items.find((it) => String(it.code || "").toLowerCase() === q);

      if (!found) {
        found = items.find((it) => String(it.description || "").toLowerCase().includes(q));
      }
    }

    setSearch("");

    if (!found) {
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

  function openScanner() {
    setMsg(null);
    setError(null);
    setScannerOpen(true);
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

  const initCat = initFromUrlValuesRef.current?.categoryId; // può essere "" (Rapido tutte) oppure uuid
  const firstId = json.rows?.[0]?.id ?? "";

  // 1) Se da URL arriva una categoria esplicita (uuid), applicala
  if (initCat && !categoryId) {
    setCategoryId(initCat);
    return;
  }

  // 2) Se sono in STANDARD e non ho categoria, comportamento vecchio: prima categoria
  if (inventoryMode === "standard" && !categoryId && firstId) {
    setCategoryId(firstId);
    return;
  }

  // 3) Se sono in RAPIDO, default deve restare "" (Nessuna/Tutte) => non fare nulla
}

  async function loadSubcategories(nextCategoryId: string) {
    setSubcategories([]);

    // ✅ in Rapido / oppure “Tutte” (cat vuota) non ha senso caricare sottocategorie
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

    // ✅ Rapido: sempre TUTTI gli articoli
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

      // ✅ PRIMA inizializzo le mappe
      setQtyPzMap(pz);
      setQtyGrMap(gr);
      setOpenMlMap(open);
      setTotalMlMap(total);
      setMlModeMap(mode);

      // ✅ POI setto gli items
      setItems(rowsAll);
      return;
    }

    // STANDARD
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

    // ✅ Standard richiede categoryId; Rapido NO (sempre null)
    if (inventoryMode !== "rapid" && !categoryId) return 0;

    setPrefillLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("pv_id", pvId);
      params.set("inventory_date", inventoryDate);

      // ✅ in Rapido: category_id/subcategory_id DEVONO essere null
      if (inventoryMode === "rapid") {
        params.set("category_id", "null");
        params.set("subcategory_id", "null");
      } else {
        // standard
        params.set("category_id", categoryId);
        if (subcategoryId) params.set("subcategory_id", subcategoryId);
        else params.set("subcategory_id", "null");
      }

      const res = await fetch(`/api/inventories/rows?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) return 0;

      // ✅ Se sto riaprendo uno storico e l’operatore non è già valorizzato,
      // lo prendo dal DB
      if (!operatore.trim() && typeof json?.operatore === "string" && json.operatore.trim()) {
        setOperatore(json.operatore.trim());
      }

      const apiRows = (json.rows || []) as InventoryRowApi[];
      if (!Array.isArray(apiRows) || apiRows.length === 0) return 0;

      const itemSet = new Set(currentItems.map((x) => x.id));
      const mlItemSet = new Set(currentItems.filter(isMlItem).map((x) => x.id));

      // ✅ fallback: se item_id non matcha, prova ad applicare per CODE
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
        if (codeNorm && codeToId.has(codeNorm)) codeToId.get(codeNorm)!;

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

  // ✅ quando cambia categoryId: in Rapido è sempre "" e carico list_all
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
    // ✅ in Rapido la sottocategoria è sempre vuota, ignoro
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

  // ✅ PREFILL DB -> draft
  useEffect(() => {
    if (!pvId || !inventoryDate) return;
    if (!isIsoDate(inventoryDate)) return;
    if (!items.length) return;

    // ✅ key: Rapido usa "null:null"
    const effCat = inventoryMode === "rapid" ? "null" : (categoryId || "");
    if (!effCat) return;
    const effSub = inventoryMode === "rapid" ? "null" : (subcategoryId || "null");

    const key = `prefill:${pvId}:${effCat}:${effSub}:${inventoryDate}`;
    if (lastPrefillKeyRef.current === key) return;
    lastPrefillKeyRef.current = key;

    (async () => {
      const applied = await prefillFromServer(items);
      ensureMlDefaults(items);

      // se non ho prefill applicato (o non sto riaprendo), allora posso caricare draft
      if (!(reopenModeRef.current && applied > 0)) {
        loadDraftIfAny(items);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, inventoryDate, items.length, inventoryMode]);

  function resetAfterClose() {
    setOperatore("");
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

      const res = await fetch("/api/inventories/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pv_id: pvId,
          // ✅ in Rapido: forzo null (UI) — lo faremo anche server-side Step 2
          category_id: inventoryMode === "rapid" ? null : categoryId,
          subcategory_id: inventoryMode === "rapid" ? null : (subcategoryId || null),
          inventory_date: dateToUse,
          operatore: operatore.trim(),
          rows,
          mode,
        }),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 409 || json?.code === "INVENTORY_ALREADY_EXISTS") {
        setMsg(null);
        setError(json?.error || "Esiste già un inventario: non è consentito sovrascrivere.");
        return;
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
      <div className="inline-flex rounded-xl border overflow-hidden">
        <button
          type="button"
          className={`px-3 py-2 text-sm ${inventoryMode === "standard" ? "bg-slate-900 text-white" : "bg-white hover:bg-gray-50"}`}
          onClick={() => {
          setInventoryMode("standard");
          setRapidView("scan");
          setFocusItemId(null);
          setMsg(null);
          setError(null);

          // ✅ se arrivo da Rapido con categoria vuota, ripristino comportamento Standard (prima categoria)
         if (!categoryId && categories.length > 0) {
         setCategoryId(categories[0].id);
          setSubcategoryId("");
           }
          }}
          title="Modalità Standard"
        >
          Standard
        </button>
        <button
          type="button"
          className={`px-3 py-2 text-sm ${inventoryMode === "rapid" ? "bg-slate-900 text-white" : "bg-white hover:bg-gray-50"}`}
          onClick={() => {
            setInventoryMode("rapid");
            setRapidView("scan");

            // ✅ Rapido: categoria = Nessuna (Tutte) SEMPRE
            forceRapidCategoryNull();

            setFocusItemId(null);
            setMsg(null);
            setError(null);
          }}
          title="Modalità Rapido"
        >
          Rapido
        </button>
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

  // ✅ Rapido: focus immediato sul campo quantità “manuale” appena trovi un articolo
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
    <div className="space-y-4">
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
              // ✅ Rapido: ignoro cambio categoria
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
            disabled={loading || inventoryMode === "rapid"} // in Rapido non si usa
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
              // ✅ Rapido: ignoro
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

      <div className="rounded-2xl border bg-white p-4">
        <label className="block text-sm font-medium mb-2">Nome Operatore</label>
        <input className="w-full rounded-xl border p-3" placeholder="Es. Mario Rossi" value={operatore} onChange={(e) => setOperatore(e.target.value)} />
        <p className="text-xs text-gray-500 mt-1">Obbligatorio per salvare lo storico e generare l’Excel.</p>
      </div>

      <div className="rounded-2xl border bg-white p-4 flex items-center justify-between gap-3">
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

        <div className="flex items-center gap-2">
          <InventoryModeToggle />

          <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" disabled={!canSave || saving} onClick={() => save("continue")} type="button">
            {saving ? "Salvo..." : "Salva e continua"}
          </button>

          <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" disabled={!canSave || saving} onClick={() => save("close")} type="button">
            {saving ? "Salvo..." : "Salva e chiudi"}
          </button>
        </div>
      </div>

      {inventoryMode === "rapid" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 relative">
                <label className="block text-sm font-medium mb-2">Scansiona / Cerca</label>
                <input
                  ref={searchInputRef}
                  className="w-full rounded-xl border p-3"
                  placeholder="Barcode / codice / descrizione"
                  value={search}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSearch(v);
                    setMsg(null);
                    setError(null);
                    if (focusItemId) setFocusItemId(null);
                    setRapidView("scan");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleScanEnter(undefined, false);
                      setRapidView("scan");
                    }
                  }}
                />

                {/* ✅ suggestions live */}
                {rapidSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border bg-white shadow-sm overflow-hidden">
                    {rapidSuggestions.map((it) => (
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

                <div className="mt-2 text-xs text-gray-500">Suggerimento: in Rapido conviene lavorare con lo scanner barcode. Ma ora puoi anche cercare per descrizione con suggestions live.</div>
              </div>

              <div className="shrink-0 flex flex-col gap-2">
                <button
                  type="button"
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                  onClick={() => {
                    setRapidView("list");
                  }}
                  title="Apri lista scansionati"
                >
                  Scansionati ({totScannedDistinct})
                </button>

                <button
                  type="button"
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                  onClick={() => {
                    setMsg(null);
                    setError(null);
                    setScannerOpen(true);
                  }}
                  title="Scanner camera"
                >
                  📷 Scanner
                </button>
              </div>
            </div>
          </div>

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

// ✅ KG: valori riga (pz + gr + totale gr)
const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");

const totalKg = kg ? calcTotalKg(it) : 0;

// totale gr calcolabile solo se ho peso_kg
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
          Tot kg: <b>{totalKg.toFixed(3)}</b> —{" "}
          <span className="text-red-600">peso_kg mancante</span>
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
                          <div className="mt-3 flex gap-2">
                            <input
                              ref={rapidPzInputRef}
                              className="w-full rounded-xl border p-2"
                              inputMode="numeric"
                              placeholder="+ pz (manuale)"
                              value={addPzMap[it.id] ?? ""}
                              onChange={(e) => setAddPzMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
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
                              disabled={safeIntFromStr(addPzMap[it.id] ?? "") <= 0}
                              onClick={() => {
                                addQty(it.id);
                                afterRapidAction();
                              }}
                            >
                              Aggiungi
                            </button>
                          </div>
                        </div>

                        <div className="rounded-xl border p-3">
                          <div className="text-sm font-medium mb-2">{kg ? "GR rapidi" : ml ? "ML rapidi" : "—"}</div>

                          {kg ? (
                            <>
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
              <div className="flex items-center justify-between gap-3">
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
                <div className="overflow-auto rounded-xl border">
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
                        const totalGr = kg ? calcTotalGr(it) : null;

                        const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
                        const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");

                      // ✅ valore per riga
                        const price = Number(it.prezzo_vendita_eur) || 0;
                        let rowValue = 0;

                        if (ml) {
                        const perUnit = Number(it.volume_ml_per_unit) || 0;
                       rowValue = perUnit > 0 ? (totalMl / perUnit) * price : 0;
                        } else if (kg) {
                       rowValue = totalKg * price; // prezzo €/kg
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
                              <button
                                type="button"
                                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                                onClick={() => {
                                  openItemInRapid(it);
                                }}
                              >
                                Apri
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* STANDARD: UI completa (invariata rispetto al tuo file, tranne le funzioni sopra) */}
          <div className="rounded-2xl border bg-white p-4">
            <label className="block text-sm font-medium mb-2">Cerca / Scansiona (Invio)</label>
            <div className="flex items-center gap-2">
              <input
                ref={searchInputRef}
                className="w-full rounded-xl border p-3"
                placeholder="Cerca per codice, descrizione o barcode... (usa Enter dopo scan)"
                value={search}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearch(v);
                  if (focusItemId) setFocusItemId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScanEnter(undefined, false);
                  }
                }}
              />
              <button type="button" className="shrink-0 rounded-xl border px-4 py-3 text-sm hover:bg-gray-50" onClick={openScanner} title="Scanner camera">
                📷
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-sm text-gray-600">
                Visualizzati: <b>{filteredItems.length}</b> / {items.length}
              </div>

              {focusItemId && (
                <button
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                  type="button"
                  onClick={() => {
                    setFocusItemId(null);
                    setHighlightScannedId(null);
                    requestAnimationFrame(() => {
                      const el = searchInputRef.current;
                      if (el) {
                        el.focus();
                        el.select();
                      }
                    });
                  }}
                  title="Torna alla lista completa"
                >
                  Mostra tutti
                </button>
              )}
            </div>

            {focusItem && (
              <div className="mt-2 text-xs text-gray-600">
                Stai vedendo solo: <b>{focusItem.code}</b> — {focusItem.description}
              </div>
            )}
          </div>

          {/* resto STANDARD: identico al tuo file, lasciato invariato per non creare regressioni */}
          <div className="rounded-2xl border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Scansionati</div>
                <div className="text-sm text-gray-600">
                  Articoli: <b>{totScannedDistinct}</b> — PZ (no-ML): <b>{totScannedPiecesNoMl}</b> — KG tot: <b>{totScannedKg.toFixed(3)}</b> — PZ (ML fixed): <b>{totScannedPiecesMl}</b> — ML aperti (fixed):{" "}
                  <b>{totScannedOpenMl}</b> — Totale ML: <b>{totScannedTotalMl}</b> ({mlToLitriLabel(totScannedTotalMl)}) — Valore: <b>{formatEUR(totScannedValueEur)}</b>
                </div>
                {scannedItems.length > 10 && <div className="text-xs text-gray-500 mt-1">Mostro {showAllScanned ? "tutti" : "gli ultimi 10"}.</div>}
              </div>

              <div className="flex items-center gap-2">
                {scannedItems.length > 10 && (
                  <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => setShowAllScanned((v) => !v)} type="button">
                    {showAllScanned ? "—" : "+"}
                  </button>
                )}
                <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" disabled={scannedIds.length === 0} onClick={clearScannedList} type="button">
                  Svuota lista
                </button>
              </div>
            </div>

            {scannedItems.length === 0 ? (
              <div className="text-sm text-gray-500">Nessun articolo scansionato.</div>
            ) : (
              <div className="overflow-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 w-40">Codice</th>
                      <th className="text-left p-3">Descrizione</th>
                      <th className="text-left p-3 w-[520px]">Input</th>
                      <th className="text-right p-3 w-[520px]">Aggiungi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scannedItemsVisible.map((it) => {
                      const isHi = highlightScannedId === it.id;
                      const ml = isMlItem(it);
                      const kg = isKgItem(it) && !ml;

                      const perUnit = Number(it.volume_ml_per_unit) || 0;
                      const totalMl = ml ? calcTotalMl(it) : 0;

                      const totalKg = kg ? calcTotalKg(it) : 0;
                      const pesoKg = Number(it.peso_kg ?? 0) || 0;

                      const mode = ml ? getMlMode(it.id) : null;

                      return (
                        <tr id={`inv-scanned-row-${it.id}`} key={it.id} className={`border-t ${isHi ? "bg-green-50" : ""}`}>
                          <td className="p-3 font-medium">{it.code}</td>
                          <td className="p-3">
                            {it.description}

                            {kg && (
                              <div className="text-xs text-gray-500 mt-1">
                                UM: <b>kg</b>
                                {pesoKg > 0 ? (
                                  <>
                                    {" "}
                                    — peso/unità: <b>{pesoKg}</b> kg — totale: <b>{totalKg.toFixed(3)}</b> kg
                                  </>
                                ) : (
                                  <>
                                    {" "}
                                    — <b>peso_kg mancante</b> (calcolo totale kg incompleto: conto solo GR/1000)
                                  </>
                                )}
                              </div>
                            )}

                            {ml && (
                              <div className="mt-2 flex items-center gap-2">
                                <MlModeToggle itemId={it.id} />
                                {perUnit > 0 && (
                                  <span className="text-xs text-gray-500">
                                    Formato “tecnico”: <b>{perUnit} ml</b>
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="p-3">
                            {!ml && !kg ? (
                              <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0 (PZ)" value={qtyPzMap[it.id] ?? ""} onChange={(e) => setPz(it.id, e.target.value)} />
                            ) : kg ? (
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1">PZ</div>
                                  <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={qtyPzMap[it.id] ?? ""} onChange={(e) => setPz(it.id, e.target.value)} />
                                </div>
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1">GR</div>
                                  <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0+" value={qtyGrMap[it.id] ?? ""} onChange={(e) => setGr(it.id, e.target.value)} />
                                </div>
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1">Totale KG</div>
                                  <div className="w-full rounded-xl border p-2 bg-gray-50 text-gray-700">
                                    <b>{totalKg.toFixed(3)}</b> <span className="text-xs text-gray-500">kg</span>
                                  </div>
                                </div>
                              </div>
                            ) : mode === "mixed" ? (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1">Totale ML</div>
                                  <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={totalMlMap[it.id] ?? ""} onChange={(e) => setTotalMl(it.id, e.target.value)} />
                                  <div className="text-xs text-gray-500 mt-1">
                                    {totalMl > 0 ? (
                                      <>
                                        Totale: <b>{totalMl}</b> ({mlToLitriLabel(totalMl)})
                                      </>
                                    ) : (
                                      <>0 non viene salvato.</>
                                    )}
                                  </div>
                                </div>
                                <div className="rounded-xl border p-2 bg-gray-50 text-gray-700 h-fit">
                                  <div className="text-[11px] text-gray-500 mb-1">Nota</div>
                                  <div className="text-xs">
                                    Modalità <b>Formati misti</b>: niente pezzi, conta solo il totale ML.
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1">PZ</div>
                                  <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={qtyPzMap[it.id] ?? ""} onChange={(e) => setPz(it.id, e.target.value)} />
                                </div>

                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1">ML aperti</div>
                                  <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={openMlMap[it.id] ?? ""} onChange={(e) => setOpenMl(it.id, e.target.value)} />
                                </div>

                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1">Totale ML</div>
                                  <div className="w-full rounded-xl border p-2 bg-gray-50 text-gray-700">
                                    <b>{totalMl}</b> <span className="text-xs text-gray-500">({mlToLitriLabel(totalMl)})</span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>

                          <td className="p-3">
                            {!ml && !kg ? (
                              <div className="flex justify-end gap-2">
                                <input
                                  className="w-28 rounded-xl border p-2 text-right"
                                  inputMode="numeric"
                                  placeholder="+ pz"
                                  value={addPzMap[it.id] ?? ""}
                                  onChange={(e) => setAddPzMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addQty(it.id);
                                    }
                                  }}
                                />
                                <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" type="button" onClick={() => addQty(it.id)}>
                                  Aggiungi
                                </button>
                              </div>
                            ) : kg ? (
                              <div className="grid grid-cols-3 gap-2 justify-end">
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1 text-right">+ PZ</div>
                                  <input className="w-full rounded-xl border p-2 text-right" inputMode="numeric" placeholder="0" value={addPzMap[it.id] ?? ""} onChange={(e) => setAddPzMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))} />
                                </div>
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1 text-right">+ GR</div>
                                  <input className="w-full rounded-xl border p-2 text-right" inputMode="numeric" placeholder="0+" value={addGrMap[it.id] ?? ""} onChange={(e) => setAddGrMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))} />
                                </div>
                                <div className="flex items-end justify-end">
                                  <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 w-full" type="button" onClick={() => addQty(it.id)}>
                                    Aggiungi
                                  </button>
                                </div>
                              </div>
                            ) : getMlMode(it.id) === "mixed" ? (
                              <div className="flex justify-end gap-2">
                                <input className="w-40 rounded-xl border p-2 text-right" inputMode="numeric" placeholder="+ ML" value={addTotalMlMap[it.id] ?? ""} onChange={(e) => setAddTotalMlMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))} />
                                <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" type="button" onClick={() => addQty(it.id)}>
                                  Aggiungi
                                </button>
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 gap-2 justify-end">
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1 text-right">+ PZ</div>
                                  <input className="w-full rounded-xl border p-2 text-right" inputMode="numeric" placeholder="0" value={addPzMap[it.id] ?? ""} onChange={(e) => setAddPzMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))} />
                                </div>
                                <div>
                                  <div className="text-[11px] text-gray-500 mb-1 text-right">+ ML aperti</div>
                                  <input className="w-full rounded-xl border p-2 text-right" inputMode="numeric" placeholder="0" value={addOpenMlMap[it.id] ?? ""} onChange={(e) => setAddOpenMlMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))} />
                                </div>
                                <div className="flex items-end justify-end">
                                  <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 w-full" type="button" onClick={() => addQty(it.id)}>
                                    Aggiungi
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="overflow-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 w-40">Codice</th>
                  <th className="text-left p-3">Descrizione</th>
                  <th className="text-left p-3 w-[520px]">Input</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-500" colSpan={3}>
                      Caricamento...
                    </td>
                  </tr>
                )}

                {!loading && filteredItems.length === 0 && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-500" colSpan={3}>
                      Nessun articolo.
                    </td>
                  </tr>
                )}

                {filteredItems.map((it) => {
                  const isHi = highlightScannedId === it.id;
                  const ml = isMlItem(it);
                  const kg = isKgItem(it) && !ml;

                  const perUnit = Number(it.volume_ml_per_unit) || 0;
                  const totalMl = ml ? calcTotalMl(it) : 0;
                  const totalKg = kg ? calcTotalKg(it) : 0;
                  const mode = ml ? getMlMode(it.id) : null;

                  return (
                    <tr id={`inv-item-row-${it.id}`} key={it.id} className={`border-t ${isHi ? "bg-green-50" : ""}`}>
                      <td className="p-3 font-medium">{it.code}</td>
                      <td className="p-3">
                        {it.description}
                        {ml && (
                          <div className="mt-2 flex items-center gap-2">
                            <MlModeToggle itemId={it.id} />
                            {perUnit > 0 && (
                              <span className="text-xs text-gray-500">
                                Formato “tecnico”: <b>{perUnit} ml</b>
                              </span>
                            )}
                          </div>
                        )}
                        {kg && (
                          <div className="text-xs text-gray-500 mt-1">
                            UM: <b>kg</b> — totale: <b>{totalKg.toFixed(3)}</b> kg
                          </div>
                        )}
                      </td>

                      <td className="p-3">
                        {!ml && !kg ? (
                          <input
                            ref={(el) => {
                              qtyInputRefs.current[it.id] = el;
                            }}
                            className="w-full rounded-xl border p-2"
                            inputMode="numeric"
                            placeholder="0 (PZ)"
                            value={qtyPzMap[it.id] ?? ""}
                            onChange={(e) => setPz(it.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                focusSearchSoon();
                              }
                            }}
                          />
                        ) : kg ? (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">PZ</div>
                              <input
                                ref={(el) => {
                                  qtyInputRefs.current[it.id] = el;
                                }}
                                className="w-full rounded-xl border p-2"
                                inputMode="numeric"
                                placeholder="0"
                                value={qtyPzMap[it.id] ?? ""}
                                onChange={(e) => setPz(it.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    focusSearchSoon();
                                  }
                                }}
                              />
                            </div>
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">GR</div>
                              <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0+" value={qtyGrMap[it.id] ?? ""} onChange={(e) => setGr(it.id, e.target.value)} />
                            </div>
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">Totale KG</div>
                              <div className="w-full rounded-xl border p-2 bg-gray-50 text-gray-700">
                                <b>{totalKg.toFixed(3)}</b> <span className="text-xs text-gray-500">kg</span>
                              </div>
                            </div>
                          </div>
                        ) : mode === "mixed" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">Totale ML</div>
                              <input
                                ref={(el) => {
                                  qtyInputRefs.current[it.id] = el;
                                }}
                                className="w-full rounded-xl border p-2"
                                inputMode="numeric"
                                placeholder="0"
                                value={totalMlMap[it.id] ?? ""}
                                onChange={(e) => setTotalMl(it.id, e.target.value)}
                              />
                              <div className="text-xs text-gray-500 mt-1">
                                {totalMl > 0 ? (
                                  <>
                                    Totale: <b>{totalMl}</b> ({mlToLitriLabel(totalMl)})
                                  </>
                                ) : (
                                  <>0 non viene salvato.</>
                                )}
                              </div>
                            </div>
                            <div className="rounded-xl border p-2 bg-gray-50 text-gray-700 h-fit">
                              <div className="text-[11px] text-gray-500 mb-1">Nota</div>
                              <div className="text-xs">
                                Modalità <b>Formati misti</b>: niente pezzi, conta solo il totale ML.
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">PZ</div>
                              <input
                                ref={(el) => {
                                  qtyInputRefs.current[it.id] = el;
                                }}
                                className="w-full rounded-xl border p-2"
                                inputMode="numeric"
                                placeholder="0"
                                value={qtyPzMap[it.id] ?? ""}
                                onChange={(e) => setPz(it.id, e.target.value)}
                              />
                            </div>

                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">ML aperti</div>
                              <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={openMlMap[it.id] ?? ""} onChange={(e) => setOpenMl(it.id, e.target.value)} />
                            </div>

                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">Totale ML</div>
                              <div className="w-full rounded-xl border p-2 bg-gray-50 text-gray-700">
                                <b>{totalMl}</b> <span className="text-xs text-gray-500">({mlToLitriLabel(totalMl)})</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

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










