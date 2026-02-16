"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

function safeGrFromStr(v: string) {
  const n = safeIntFromStr(v);
  return Math.min(9999, n);
}

type DraftAdmin = {
  operatore: string;

  qtyPzMap: Record<string, string>;

  // ✅ KG
  qtyGrMap: Record<string, string>;

  // ✅ ML fixed: open
  openMlMap: Record<string, string>;

  // ✅ ML mixed: total
  totalMlMap: Record<string, string>;

  mlModeMap: Record<string, MlInputMode>;

  scannedIds: string[];
  showAllScanned: boolean;

  addPzMap: Record<string, string>;

  // ✅ KG
  addGrMap: Record<string, string>;

  addOpenMlMap: Record<string, string>;
  addTotalMlMap: Record<string, string>;

  // ⚠️ retrocompat
  qtyMap?: Record<string, string>;
  addQtyMap?: Record<string, string>;
};

export default function InventoryClient() {
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

  // ✅ lista “Scansionati”
  const [scannedIds, setScannedIds] = useState<string[]>([]);
  const [highlightScannedId, setHighlightScannedId] = useState<string | null>(null);
  const [showAllScanned, setShowAllScanned] = useState(false);

  // ✅ “da aggiungere”
  const [addPzMap, setAddPzMap] = useState<Record<string, string>>({});

  // ✅ KG
  const [addGrMap, setAddGrMap] = useState<Record<string, string>>({});

  const [addOpenMlMap, setAddOpenMlMap] = useState<Record<string, string>>({});
  const [addTotalMlMap, setAddTotalMlMap] = useState<Record<string, string>>({});

  // ✅ focus singolo articolo
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  // ✅ UX: focus automatico tra ricerca <-> quantità
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ✅ guard prefill
  const lastPrefillKeyRef = useRef<string>("");

  const canSave = useMemo(
    () => !!operatore.trim() && !!pvId && !!categoryId && items.length > 0,
    [operatore, pvId, categoryId, items.length]
  );

  const draftKey = useMemo(() => {
    const sub = subcategoryId || "null";
    return `inv_draft_admin:${pvId}:${categoryId}:${sub}:${inventoryDate}`;
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

  useEffect(() => {
    if (!pvId || !categoryId || !inventoryDate) return;
    if (!items.length) return;

    const t = window.setTimeout(() => persistDraft(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pvId,
    categoryId,
    subcategoryId,
    inventoryDate,
    items.length,
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

      if (isMlItem(it)) {
        const totalMl = calcTotalMl(it);
        const perUnit = Number(it.volume_ml_per_unit) || 0;
        if (perUnit <= 0) return sum;
        const unitsEq = totalMl / perUnit;
        return sum + unitsEq * p;
      }

      const q = safeIntFromStr(qtyPzMap[it.id] ?? "");
      return sum + q * p;
    }, 0);
  }, [scannedItems, qtyPzMap, openMlMap, totalMlMap, mlModeMap]);

  function highlightAndMoveToTop(itemId: string) {
    setScannedIds((prev) => {
      const next = [itemId, ...prev.filter((id) => id !== itemId)];
      return next;
    });
    setHighlightScannedId(itemId);
  }

  function shouldBeScanned(it: Item): boolean {
    // KG: attivo se PZ>0 o GR>0
    if (isKgItem(it) && !isMlItem(it)) {
      const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
      const gr = safeGrFromStr(qtyGrMap[it.id] ?? "");
      return pz > 0 || gr > 0;
    }

    if (!isMlItem(it)) {
      const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
      return pz > 0;
    }

    const mode = getMlMode(it.id);
    if (mode === "mixed") {
      const total = safeIntFromStr(totalMlMap[it.id] ?? "");
      return total > 0;
    }

    const pz = safeIntFromStr(qtyPzMap[it.id] ?? "");
    const open = safeIntFromStr(openMlMap[it.id] ?? "");
    const perUnit = Number(it.volume_ml_per_unit) || 0;
    const total = perUnit > 0 ? pz * perUnit + open : open;
    return total > 0;
  }

  function syncScannedPresence(itemId: string) {
    setScannedIds((prev) => {
      const it = items.find((x) => x.id === itemId);
      if (!it) return prev;

      const has = prev.includes(itemId);
      const active = shouldBeScanned(it);

      if (active && !has) return [itemId, ...prev];
      if (active && has) return [itemId, ...prev.filter((id) => id !== itemId)];
      if (!active && has) return prev.filter((id) => id !== itemId);
      return prev;
    });
  }

  function setPz(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    setQtyPzMap((prev) => ({ ...prev, [itemId]: cleaned }));
    setHighlightScannedId(itemId);
    requestAnimationFrame(() => syncScannedPresence(itemId));
  }

  function setGr(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    const capped = String(Math.min(9999, Number(cleaned || "0") || 0));
    setQtyGrMap((prev) => ({ ...prev, [itemId]: cleaned ? capped : "" }));
    setHighlightScannedId(itemId);
    requestAnimationFrame(() => syncScannedPresence(itemId));
  }

  function setOpenMl(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    setOpenMlMap((prev) => ({ ...prev, [itemId]: cleaned }));
    setHighlightScannedId(itemId);
    requestAnimationFrame(() => syncScannedPresence(itemId));
  }

  function setTotalMl(itemId: string, v: string) {
    const cleaned = onlyDigits(v);
    setTotalMlMap((prev) => ({ ...prev, [itemId]: cleaned }));
    setHighlightScannedId(itemId);
    requestAnimationFrame(() => syncScannedPresence(itemId));
  }

  function setMlMode(itemId: string, mode: MlInputMode) {
    setMlModeMap((prev) => ({ ...prev, [itemId]: mode }));

    if (mode === "mixed") {
      const it = items.find((x) => x.id === itemId);
      if (it && isMlItem(it)) {
        const total = calcTotalMl(it);
        setTotalMlMap((prev) => ({ ...prev, [itemId]: total > 0 ? String(total) : "" }));
      }
    }

    requestAnimationFrame(() => syncScannedPresence(itemId));
  }

  function addQty(itemId: string) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;

    // ✅ KG: aggiungo separatamente PZ e GR
    if (isKgItem(it) && !isMlItem(it)) {
      const deltaPz = safeIntFromStr(addPzMap[itemId] ?? "");
      const deltaGr = safeGrFromStr(addGrMap[itemId] ?? "");
      if (deltaPz <= 0 && deltaGr <= 0) return;

      setQtyPzMap((prev) => {
        const current = safeIntFromStr(prev[itemId] ?? "");
        const next = Math.max(0, current + deltaPz);
        return { ...prev, [itemId]: String(next) };
      });

      setQtyGrMap((prev) => {
        const current = safeGrFromStr(prev[itemId] ?? "");
        const next = Math.min(9999, Math.max(0, current + deltaGr));
        return { ...prev, [itemId]: next > 0 ? String(next) : "" };
      });

      setAddPzMap((prev) => ({ ...prev, [itemId]: "" }));
      setAddGrMap((prev) => ({ ...prev, [itemId]: "" }));
      highlightAndMoveToTop(itemId);
      return;
    }

    if (!isMlItem(it)) {
      const delta = safeIntFromStr(addPzMap[itemId] ?? "");
      if (delta <= 0) return;

      setQtyPzMap((prev) => {
        const current = safeIntFromStr(prev[itemId] ?? "");
        const next = Math.max(0, current + delta);
        return { ...prev, [itemId]: String(next) };
      });

      setAddPzMap((prev) => ({ ...prev, [itemId]: "" }));
      highlightAndMoveToTop(itemId);
      return;
    }

    const mode = getMlMode(itemId);

    if (mode === "mixed") {
      const deltaMl = safeIntFromStr(addTotalMlMap[itemId] ?? "");
      if (deltaMl <= 0) return;

      setTotalMlMap((prev) => {
        const current = safeIntFromStr(prev[itemId] ?? "");
        const next = Math.max(0, current + deltaMl);
        return { ...prev, [itemId]: String(next) };
      });

      setAddTotalMlMap((prev) => ({ ...prev, [itemId]: "" }));
      highlightAndMoveToTop(itemId);
      return;
    }

    const deltaPz = safeIntFromStr(addPzMap[itemId] ?? "");
    const deltaOpen = safeIntFromStr(addOpenMlMap[itemId] ?? "");
    if (deltaPz <= 0 && deltaOpen <= 0) return;

    setQtyPzMap((prev) => {
      const current = safeIntFromStr(prev[itemId] ?? "");
      const next = Math.max(0, current + deltaPz);
      return { ...prev, [itemId]: String(next) };
    });

    setOpenMlMap((prev) => {
      const current = safeIntFromStr(prev[itemId] ?? "");
      const next = Math.max(0, current + deltaOpen);
      return { ...prev, [itemId]: String(next) };
    });

    setAddPzMap((prev) => ({ ...prev, [itemId]: "" }));
    setAddOpenMlMap((prev) => ({ ...prev, [itemId]: "" }));

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
  }

  function handleScanEnter() {
    const raw = search.trim();
    if (!raw) return;

    const digits = onlyDigits(raw);
    const isLikelyBarcode = digits.length >= 8;

    let found: Item | undefined;

    if (isLikelyBarcode) {
      found = items.find((it) => {
        const bcDigits = onlyDigits(String(it.barcode ?? ""));
        const codeDigits = onlyDigits(String(it.code ?? ""));
        return (bcDigits && bcDigits === digits) || (codeDigits && codeDigits === digits);
      });
    } else {
      const t = raw.toLowerCase();
      found = items.find((it) => String(it.code || "").toLowerCase() === t);
    }

    setSearch("");

    if (!found) {
      setMsg(null);
      setError("Barcode non trovato.");
      return;
    }

    setError(null);
    setMsg(null);

    setFocusItemId(found.id);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = qtyInputRefs.current[found!.id];
        if (el) {
          el.focus();
          el.select();
        }
      });
    });

    if (scannedIds.includes(found.id)) {
      highlightAndMoveToTop(found.id);
      return;
    }

    setScannedIds((prev) => [found!.id, ...prev]);
    setHighlightScannedId(found.id);
  }

  async function loadPvs() {
    const res = await fetch("/api/pvs/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento PV");
    setPvs(json.rows || []);
    if (!pvId && (json.rows?.[0]?.id ?? "")) setPvId(json.rows[0].id);
  }

  async function loadCategories() {
    const res = await fetch("/api/categories/list", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Errore caricamento categorie");
    setCategories(json.rows || []);
    if (!categoryId && (json.rows?.[0]?.id ?? "")) setCategoryId(json.rows[0].id);
  }

  async function loadSubcategories(nextCategoryId: string) {
    setSubcategories([]);
    setSubcategoryId("");
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

    if (!nextCategoryId) return;

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

    setItems(rows);

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
  }

  async function prefillFromServer(currentItems: Item[]) {
    if (!pvId || !categoryId || !inventoryDate) return;
    if (!isIsoDate(inventoryDate)) return;
    if (!currentItems?.length) return;

    setPrefillLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("pv_id", pvId);
      params.set("category_id", categoryId);
      if (subcategoryId) params.set("subcategory_id", subcategoryId);
      params.set("inventory_date", inventoryDate);

      const res = await fetch(`/api/inventories/rows?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) return;

      const apiRows = (json.rows || []) as InventoryRowApi[];
      if (!Array.isArray(apiRows) || apiRows.length === 0) return;

      const itemSet = new Set(currentItems.map((x) => x.id));
      const mlItemSet = new Set(currentItems.filter(isMlItem).map((x) => x.id));

      // PZ
      setQtyPzMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          if (!r?.item_id || !itemSet.has(r.item_id)) continue;
          const q = Number(r.qty) || 0;
          next[r.item_id] = q > 0 ? String(Math.trunc(q)) : "";
        }
        return next;
      });

      // GR
      setQtyGrMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          if (!r?.item_id || !itemSet.has(r.item_id)) continue;
          const g = Number((r as any).qty_gr ?? 0) || 0;
          const gg = Math.min(9999, Math.max(0, Math.trunc(g)));
          next[r.item_id] = gg > 0 ? String(gg) : "";
        }
        return next;
      });

      // ML aperti (fixed)
      setOpenMlMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          if (!r?.item_id || !itemSet.has(r.item_id)) continue;
          if (!mlItemSet.has(r.item_id)) continue;

          const mlOpen = Number(r.ml_open ?? 0) || 0;
          next[r.item_id] = mlOpen > 0 ? String(Math.trunc(mlOpen)) : "";
        }
        return next;
      });

      // Totale ML
      setTotalMlMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          if (!r?.item_id || !itemSet.has(r.item_id)) continue;
          if (!mlItemSet.has(r.item_id)) continue;

          const total = Number(r.qty_ml ?? 0) || 0;
          next[r.item_id] = total > 0 ? String(Math.trunc(total)) : "";
        }
        return next;
      });

      // Scansionati: righe non-zero (ora include GR)
      const ids: string[] = [];
      for (const r of apiRows) {
        if (!r?.item_id || !itemSet.has(r.item_id)) continue;
        const q = Number(r.qty) || 0;
        const qml = Number(r.qty_ml) || 0;
        const qgr = Number((r as any).qty_gr ?? 0) || 0;
        if (q > 0 || qml > 0 || qgr > 0) ids.push(r.item_id);
      }
      if (ids.length) {
        const seen = new Set<string>();
        const dedup = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
        setScannedIds(dedup);
        setShowAllScanned(false);
        setHighlightScannedId(null);
      }
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
    if (!categoryId) return;
    (async () => {
      setError(null);
      try {
        await loadSubcategories(categoryId);
        await loadItems(categoryId, "");
      } catch (e: any) {
        setError(e?.message || "Errore");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  useEffect(() => {
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
    if (!pvId || !categoryId || !inventoryDate) return;
    if (!isIsoDate(inventoryDate)) return;
    if (!items.length) return;

    const sub = subcategoryId || "null";
    const key = `prefill:${pvId}:${categoryId}:${sub}:${inventoryDate}`;

    if (lastPrefillKeyRef.current === key) return;
    lastPrefillKeyRef.current = key;

    (async () => {
      await prefillFromServer(items);
      ensureMlDefaults(items);
      loadDraftIfAny(items);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, categoryId, subcategoryId, inventoryDate, items.length]);

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
          // ML
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

          // KG (o pezzi normali)
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
          category_id: categoryId,
          subcategory_id: subcategoryId || null,
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
          <select className="w-full rounded-xl border p-3 bg-white" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={loading}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Sottocategoria</label>
          <select className="w-full rounded-xl border p-3 bg-white" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={loading || subcategories.length === 0}>
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
          <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60" disabled={!canSave || saving} onClick={() => save("continue")} type="button">
            {saving ? "Salvo..." : "Salva e continua"}
          </button>

          <button className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60" disabled={!canSave || saving} onClick={() => save("close")} type="button">
            {saving ? "Salvo..." : "Salva e chiudi"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <label className="block text-sm font-medium mb-2">Cerca / Scansiona (Invio)</label>
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
              handleScanEnter();
            }
          }}
        />

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

      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Scansionati</div>
            <div className="text-sm text-gray-600">
              Articoli: <b>{totScannedDistinct}</b> — PZ (no-ML): <b>{totScannedPiecesNoMl}</b> — KG tot: <b>{totScannedKg.toFixed(3)}</b> — PZ (ML fixed):{" "}
              <b>{totScannedPiecesMl}</b> — ML aperti (fixed): <b>{totScannedOpenMl}</b> — Totale ML: <b>{totScannedTotalMl}</b> ({mlToLitriLabel(totScannedTotalMl)}) — Valore:{" "}
              <b>{formatEUR(totScannedValueEur)}</b>
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
                    <tr key={it.id} className={`border-t ${isHi ? "bg-green-50" : ""}`}>
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
                          <input
                            className="w-full rounded-xl border p-2"
                            inputMode="numeric"
                            placeholder="0 (PZ)"
                            value={qtyPzMap[it.id] ?? ""}
                            onChange={(e) => setPz(it.id, e.target.value)}
                          />
                        ) : kg ? (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">PZ</div>
                              <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0" value={qtyPzMap[it.id] ?? ""} onChange={(e) => setPz(it.id, e.target.value)} />
                            </div>
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1">GR</div>
                              <input className="w-full rounded-xl border p-2" inputMode="numeric" placeholder="0–9999" value={qtyGrMap[it.id] ?? ""} onChange={(e) => setGr(it.id, e.target.value)} />
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
                              <input
                                className="w-full rounded-xl border p-2 text-right"
                                inputMode="numeric"
                                placeholder="0"
                                value={addPzMap[it.id] ?? ""}
                                onChange={(e) => setAddPzMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addQty(it.id);
                                  }
                                }}
                              />
                            </div>

                            <div>
                              <div className="text-[11px] text-gray-500 mb-1 text-right">+ GR</div>
                              <input
                                className="w-full rounded-xl border p-2 text-right"
                                inputMode="numeric"
                                placeholder="0–9999"
                                value={addGrMap[it.id] ?? ""}
                                onChange={(e) => setAddGrMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addQty(it.id);
                                  }
                                }}
                              />
                            </div>

                            <div className="flex items-end justify-end">
                              <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 w-full" type="button" onClick={() => addQty(it.id)}>
                                Aggiungi
                              </button>
                            </div>
                          </div>
                        ) : getMlMode(it.id) === "mixed" ? (
                          <div className="flex justify-end gap-2">
                            <input
                              className="w-40 rounded-xl border p-2 text-right"
                              inputMode="numeric"
                              placeholder="+ ML"
                              value={addTotalMlMap[it.id] ?? ""}
                              onChange={(e) => setAddTotalMlMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
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
                        ) : (
                          <div className="grid grid-cols-3 gap-2 justify-end">
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1 text-right">+ PZ</div>
                              <input
                                className="w-full rounded-xl border p-2 text-right"
                                inputMode="numeric"
                                placeholder="0"
                                value={addPzMap[it.id] ?? ""}
                                onChange={(e) => setAddPzMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addQty(it.id);
                                  }
                                }}
                              />
                            </div>

                            <div>
                              <div className="text-[11px] text-gray-500 mb-1 text-right">+ ML aperti</div>
                              <input
                                className="w-full rounded-xl border p-2 text-right"
                                inputMode="numeric"
                                placeholder="0"
                                value={addOpenMlMap[it.id] ?? ""}
                                onChange={(e) => setAddOpenMlMap((prev) => ({ ...prev, [it.id]: onlyDigits(e.target.value) }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addQty(it.id);
                                  }
                                }}
                              />
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

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

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
                <tr key={it.id} className={`border-t ${isHi ? "bg-green-50" : ""}`}>
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
                            const el = searchInputRef.current;
                            if (el) {
                              el.focus();
                              el.select();
                            }
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
                                const el = searchInputRef.current;
                                if (el) {
                                  el.focus();
                                  el.select();
                                }
                              }
                            }}
                          />
                        </div>
                        <div>
                          <div className="text-[11px] text-gray-500 mb-1">GR</div>
                          <input
                            className="w-full rounded-xl border p-2"
                            inputMode="numeric"
                            placeholder="0–9999"
                            value={qtyGrMap[it.id] ?? ""}
                            onChange={(e) => setGr(it.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const el = searchInputRef.current;
                                if (el) {
                                  el.focus();
                                  el.select();
                                }
                              }
                            }}
                          />
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
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const el = searchInputRef.current;
                                if (el) {
                                  el.focus();
                                  el.select();
                                }
                              }
                            }}
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
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const el = searchInputRef.current;
                                if (el) {
                                  el.focus();
                                  el.select();
                                }
                              }
                            }}
                          />
                        </div>

                        <div>
                          <div className="text-[11px] text-gray-500 mb-1">ML aperti</div>
                          <input
                            className="w-full rounded-xl border p-2"
                            inputMode="numeric"
                            placeholder="0"
                            value={openMlMap[it.id] ?? ""}
                            onChange={(e) => setOpenMl(it.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const el = searchInputRef.current;
                                if (el) {
                                  el.focus();
                                  el.select();
                                }
                              }
                            }}
                          />
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
    </div>
  );
}






