"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SupplierPayment = {
  id: number;
  code: string;
  name: string;
  amount: number;
};

type SupplierSearchRow = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
};

type SummaryStatus = "bozza" | "completato" | "chiuso";

type SummaryResponse = {
  ok: boolean;
  summary?: {
    id: string;
    data: string;
    operatore: string;
    incasso_totale: number | null;
    pagamento_fornitori: number | null;
    gv_pagati: number | null;
    lis_plus: number | null;
    mooney: number | null;
    totale_esistenza_cassa: number | null;
    vendita_gv: number | null;
    vendita_tabacchi: number | null;
    totale: number | null;
    pos: number | null;
    spese_extra?: number | null;
    versamento: number | null;
    da_versare: number | null;
    tot_versato: number | null;
    fondo_cassa_iniziale?: number | null;
    parziale_1?: number | null;
    parziale_2?: number | null;
    parziale_3?: number | null;
    fondo_cassa: number | null;
    status?: string | null;
    is_closed: boolean;
  };
  suppliers?: Array<{
    supplier_code?: string | null;
    supplier_name?: string | null;
    amount?: number | null;
  }>;
  error?: string;
};

function n(value: number | null | undefined) {
  return value ?? 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function parseMoney(value: string): number | null {
  const raw = value.trim().replace(",", ".");
  if (raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return roundMoney(parsed);
}

function normalizeMoneyInput(value: string) {
  return value.replace(/\./g, ",");
}

function sanitizeMoneyTyping(value: string) {
  let next = value.replace(/\./g, ",");
  next = next.replace(/[^\d,]/g, "");

  const firstCommaIndex = next.indexOf(",");
  if (firstCommaIndex !== -1) {
    const integerPart = next.slice(0, firstCommaIndex + 1);
    const decimalPart = next
      .slice(firstCommaIndex + 1)
      .replace(/,/g, "")
      .slice(0, 2);

    next = integerPart + decimalPart;
  }

  return next;
}

function formatMoneyInput(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  return roundMoney(value).toFixed(2).replace(".", ",");
}

function formatEuro(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function normalizeStatus(status: string | null | undefined, isClosed: boolean): SummaryStatus {
  const raw = String(status ?? "").trim().toLowerCase();

  if (raw === "bozza") return "bozza";
  if (raw === "completato") return "completato";
  if (raw === "chiuso") return "chiuso";

  return isClosed ? "chiuso" : "bozza";
}

function computeDeltaPercent(initial: number | null, current: number | null) {
  if (initial === null || current === null) return null;
  if (!Number.isFinite(initial) || !Number.isFinite(current) || initial === 0) return null;
  return roundMoney(((current - initial) / initial) * 100);
}

function formatPercentLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function statusLabel(status: SummaryStatus) {
  if (status === "chiuso") return "Chiuso";
  if (status === "completato") return "Completato";
  return "Bozza";
}

export default function RiepilogoIncassatoDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewMode = searchParams.get("mode") === "view";

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [data, setData] = useState("");
  const [operatore, setOperatore] = useState("");

  const [incassoTotale, setIncassoTotale] = useState<number | null>(null);
  const [gvPagati, setGvPagati] = useState<number | null>(null);
  const [lisPlus, setLisPlus] = useState<number | null>(null);
  const [mooney, setMooney] = useState<number | null>(null);
  const [venditaGV, setVenditaGV] = useState<number | null>(null);
  const [venditaTabacchi, setVenditaTabacchi] = useState<number | null>(null);
  const [pos, setPos] = useState<number | null>(null);
  const [speseExtra, setSpeseExtra] = useState<number | null>(null);
  const [fondoCassaIniziale, setFondoCassaIniziale] = useState<number | null>(null);
  const [parziale1, setParziale1] = useState<number | null>(null);
  const [parziale2, setParziale2] = useState<number | null>(null);
  const [parziale3, setParziale3] = useState<number | null>(null);
  const [fondoCassa, setFondoCassa] = useState<number | null>(null);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [status, setStatus] = useState<SummaryStatus>("bozza");
  const [isClosed, setIsClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [supplierCode, setSupplierCode] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierAmount, setSupplierAmount] = useState<number | null>(null);
  const [supplierAmountInput, setSupplierAmountInput] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierSearchRow[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [supplierSearchTouched, setSupplierSearchTouched] = useState(false);

  const supplierSearchInputRef = useRef<HTMLInputElement | null>(null);
  const supplierAmountInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestIdRef = useRef(0);

  const canEditMainFields = !viewMode && !isClosed && status === "bozza";

  const pagamentoFornitori = useMemo(
    () => roundMoney(supplierPayments.reduce((sum, s) => sum + s.amount, 0)),
    [supplierPayments]
  );

  const totaleEsistenzaCassa = roundMoney(
    n(incassoTotale) - pagamentoFornitori - n(gvPagati) + n(lisPlus) + n(mooney)
  );

  const totale = roundMoney(totaleEsistenzaCassa + n(venditaGV) + n(venditaTabacchi));
  const versamento = roundMoney(totale - n(pos) - n(speseExtra));
  const daVersare = versamento;

  const deltaFondoCassaPercent = useMemo(() => {
    return computeDeltaPercent(fondoCassaIniziale, fondoCassa);
  }, [fondoCassaIniziale, fondoCassa]);

  function syncMoneyState(
    rawValue: string,
    setInput: (value: string) => void,
    setNumeric: (value: number | null) => void
  ) {
    const sanitized = sanitizeMoneyTyping(rawValue);
    setInput(sanitized);
    setNumeric(parseMoney(sanitized));
  }

  function blurMoneyState(
    value: number | null,
    setInput: (value: string) => void
  ) {
    setInput(formatMoneyInput(value));
  }

  function resetSupplierModalState() {
    setSupplierCode("");
    setSupplierName("");
    setSupplierAmount(null);
    setSupplierAmountInput("");
    setSupplierSearch("");
    setSupplierResults([]);
    setSupplierSearchTouched(false);
    setLoadingSuppliers(false);
  }

  function selectSupplier(s: SupplierSearchRow) {
    setSupplierCode(s.code);
    setSupplierName(s.name);
    setSupplierSearch(`${s.code} - ${s.name}`);
    setSupplierResults([]);
    setSupplierSearchTouched(true);

    setTimeout(() => {
      const input = supplierAmountInputRef.current;
      if (!input) return;
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }, 0);
  }

  function addSupplierPayment() {
    if (!supplierCode || !supplierName || supplierAmount === null) return;

    const alreadyExists = supplierPayments.some((s) => s.code === supplierCode);

    if (alreadyExists) {
      alert("Questo fornitore è già stato inserito.");
      return;
    }

    const newPayment: SupplierPayment = {
      id: Date.now(),
      code: supplierCode,
      name: supplierName,
      amount: roundMoney(supplierAmount),
    };

    setSupplierPayments((prev) => [...prev, newPayment]);
    resetSupplierModalState();
    setShowModal(false);
  }

  function removeSupplier(idToRemove: number) {
    setSupplierPayments((prev) => prev.filter((s) => s.id !== idToRemove));
  }

  function updateSupplierAmount(idToUpdate: number, value: string) {
    const parsed = parseMoney(value) ?? 0;

    setSupplierPayments((prev) =>
      prev.map((s) =>
        s.id === idToUpdate
          ? {
              ...s,
              amount: roundMoney(parsed),
            }
          : s
      )
    );
  }

  async function runSupplierSearch(q: string, requestId: number) {
    setLoadingSuppliers(true);

    try {
      const res = await fetch(`/api/suppliers/search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (requestId !== searchRequestIdRef.current) return;

      if (!res.ok || !json?.rows) {
        setSupplierResults([]);
        return;
      }

      const activeOnly = (Array.isArray(json.rows) ? json.rows : []).filter(
        (row: SupplierSearchRow) => row.is_active !== false
      );

      setSupplierResults(activeOnly);
    } catch {
      if (requestId !== searchRequestIdRef.current) return;
      setSupplierResults([]);
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setLoadingSuppliers(false);
      }
    }
  }

  useEffect(() => {
    if (!showModal) return;

    setTimeout(() => {
      const input = supplierSearchInputRef.current;
      if (!input) return;
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }, 0);

    const q = supplierSearch.trim();
    setSupplierSearchTouched(true);

    if (q.length < 2) {
      searchRequestIdRef.current += 1;
      setSupplierResults([]);
      setLoadingSuppliers(false);
      return;
    }

    const nextRequestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = nextRequestId;

    const timer = window.setTimeout(() => {
      runSupplierSearch(q, nextRequestId);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [supplierSearch, showModal]);

  async function loadDetail() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch(`/api/cash-summary/pv-get-by-id?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as SummaryResponse | null;

      if (!res.ok || !json?.summary) {
        setMsg(json?.error || "Errore caricamento riepilogo");
        return;
      }

      const s = json.summary;

      setData(s.data ?? "");
      setOperatore(s.operatore ?? "");
      setIncassoTotale(s.incasso_totale ?? null);
      setGvPagati(s.gv_pagati ?? null);
      setLisPlus(s.lis_plus ?? null);
      setMooney(s.mooney ?? null);
      setVenditaGV(s.vendita_gv ?? null);
      setVenditaTabacchi(s.vendita_tabacchi ?? null);
      setPos(s.pos ?? null);
      setSpeseExtra(s.spese_extra ?? null);
      setFondoCassaIniziale(s.fondo_cassa_iniziale ?? null);
      setParziale1(s.parziale_1 ?? null);
      setParziale2(s.parziale_2 ?? null);
      setParziale3(s.parziale_3 ?? null);
      setFondoCassa(s.fondo_cassa ?? null);
      setIsClosed(!!s.is_closed);
      setStatus(normalizeStatus(s.status, !!s.is_closed));

      const mappedSuppliers: SupplierPayment[] = (json.suppliers ?? []).map((row, index) => ({
        id: index + 1,
        code: String(row?.supplier_code ?? "").trim(),
        name: String(row?.supplier_name ?? "").trim(),
        amount: roundMoney(Number(row?.amount ?? 0) || 0),
      }));

      setSupplierPayments(mappedSuppliers);
    } catch {
      setMsg("Errore di rete");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [id]);

  async function submitWithStatus(nextStatus: "bozza" | "completato") {
    if (nextStatus === "completato") {
      if (!data) return alert("Data obbligatoria");
      if (!operatore.trim()) return alert("Operatore obbligatorio");
      if (incassoTotale === null) return alert("Incasso Totale obbligatorio");
      if (gvPagati === null) return alert("G&V Pagati obbligatorio");
      if (lisPlus === null) return alert("LIS+ obbligatorio");
      if (mooney === null) return alert("MOONEY obbligatorio");
      if (venditaGV === null) return alert("Vendita G&V obbligatorio");
      if (venditaTabacchi === null) return alert("Vendita Tabacchi obbligatorio");
      if (pos === null) return alert("POS obbligatorio");
      if (fondoCassa === null) return alert("Fondo Cassa obbligatorio");
    }

    setSaving(true);

    try {
      const res = await fetch("/api/cash-summary/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data,
          operatore,
          incasso_totale: incassoTotale,
          pagamento_fornitori: pagamentoFornitori,
          gv_pagati: gvPagati,
          lis_plus: lisPlus,
          mooney,
          totale_esistenza_cassa: totaleEsistenzaCassa,
          vendita_gv: venditaGV,
          vendita_tabacchi: venditaTabacchi,
          totale,
          pos,
          spese_extra: speseExtra ?? 0,
          versamento,
          da_versare: daVersare,
          tot_versato: null,
          fondo_cassa_iniziale: fondoCassaIniziale,
          parziale_1: parziale1,
          parziale_2: parziale2,
          parziale_3: parziale3,
          fondo_cassa: fondoCassa,
          status: nextStatus,
          fornitori: supplierPayments,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        alert(json?.error || "Errore nel salvataggio");
        return;
      }

      alert(nextStatus === "bozza" ? "Bozza salvata" : "Riepilogo completato");
      router.push("/pv/riepilogo-incassato");
    } catch {
      alert("Errore di rete");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border bg-white p-6 text-sm text-gray-600">
        Caricamento...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div className="rounded-xl border bg-white p-3 text-sm text-gray-700">
          {msg}
        </div>
      )}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">
            Riepilogo Incassato
          </h1>

          <button
            type="button"
            onClick={() => router.push("/pv/riepilogo-incassato")}
            className="rounded-lg border px-4 py-2 hover:bg-gray-50"
          >
            Torna alla lista
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <EditableField
            label="Data"
            value={data}
            setValue={setData}
            disabled={!canEditMainFields}
            type="date"
          />
          <EditableField
            label="Operatore"
            value={operatore}
            setValue={setOperatore}
            disabled={!canEditMainFields}
            type="text"
          />
          <ReadOnlyField label="Stato" value={statusLabel(status)} />
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Esistenza Cassa</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <EditableNumberField label="Incasso Totale" value={incassoTotale} setValue={setIncassoTotale} disabled={!canEditMainFields} />
          <ReadOnlyField label="Pagamento Fornitori" value={formatEuro(pagamentoFornitori)} />
          <EditableNumberField label="G&V Pagati" value={gvPagati} setValue={setGvPagati} disabled={!canEditMainFields} />
          <EditableNumberField label="LIS+" value={lisPlus} setValue={setLisPlus} disabled={!canEditMainFields} />
          <EditableNumberField label="MOONEY" value={mooney} setValue={setMooney} disabled={!canEditMainFields} />
          <ReadOnlyField label="Totale Esistenza Cassa" value={formatEuro(totaleEsistenzaCassa)} />
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Pagamenti Fornitori</h2>

          {canEditMainFields && (
            <button
              onClick={() => setShowModal(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white"
              type="button"
            >
              Aggiungi Fornitore
            </button>
          )}
        </div>

        <table className="w-full border text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="p-2 text-left">Codice</th>
              <th className="p-2 text-left">Ragione Sociale</th>
              <th className="p-2 text-right">Importo</th>
              {canEditMainFields && <th className="p-2 text-right">Azioni</th>}
            </tr>
          </thead>
          <tbody>
            {supplierPayments.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{s.code}</td>
                <td className="p-2">{s.name}</td>
                <td className="p-2">
                  {canEditMainFields ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full rounded border p-2 text-right"
                      value={formatMoneyInput(s.amount)}
                      onChange={(e) =>
                        updateSupplierAmount(s.id, normalizeMoneyInput(e.target.value))
                      }
                    />
                  ) : (
                    <div className="text-right">{formatEuro(s.amount)}</div>
                  )}
                </td>

                {canEditMainFields && (
                  <td className="p-2 text-right">
                    <button
                      onClick={() => removeSupplier(s.id)}
                      className="text-red-600"
                      type="button"
                    >
                      elimina
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {supplierPayments.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={canEditMainFields ? 4 : 3}>
                  Nessun pagamento fornitore inserito.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Vendite e Calcoli</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <EditableNumberField label="Vendita G&V" value={venditaGV} setValue={setVenditaGV} disabled={!canEditMainFields} />
          <EditableNumberField label="Vendita Tabacchi" value={venditaTabacchi} setValue={setVenditaTabacchi} disabled={!canEditMainFields} />
          <ReadOnlyField label="Totale" value={formatEuro(totale)} />
          <EditableNumberField label="POS" value={pos} setValue={setPos} disabled={!canEditMainFields} />
          <EditableNumberField label="Prelievo" value={speseExtra} setValue={setSpeseExtra} disabled={!canEditMainFields} />
          <ReadOnlyField label="Versamento" value={formatEuro(versamento)} />
          <ReadOnlyField label="Da Versare" value={formatEuro(daVersare)} />
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Fondo Cassa</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <ReadOnlyField label="Fondo Cassa Iniziale" value={formatEuro(fondoCassaIniziale)} />
          <EditableNumberField label="Parziale 1" value={parziale1} setValue={setParziale1} disabled={!canEditMainFields} />
          <EditableNumberField label="Parziale 2" value={parziale2} setValue={setParziale2} disabled={!canEditMainFields} />
          <EditableNumberField label="Parziale 3" value={parziale3} setValue={setParziale3} disabled={!canEditMainFields} />
          <EditableNumberField label="Fondo Cassa" value={fondoCassa} setValue={setFondoCassa} disabled={!canEditMainFields} />
          <ReadOnlyField label="Differenza % Fondo Cassa" value={formatPercentLabel(deltaFondoCassaPercent)} />
        </div>
      </div>

      {!viewMode && !isClosed && status === "bozza" && (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => submitWithStatus("bozza")}
            disabled={saving}
            className="rounded-lg border px-6 py-3 font-semibold hover:bg-gray-50 disabled:opacity-50"
            type="button"
          >
            {saving ? "Salvo..." : "Salva Bozza"}
          </button>

          <button
            onClick={() => submitWithStatus("completato")}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
            type="button"
          >
            {saving ? "Salvo..." : "Completa"}
          </button>
        </div>
      )}

      {showModal && canEditMainFields && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">Pagamento Fornitore</h3>

            <div className="space-y-2">
              <input
                ref={supplierSearchInputRef}
                placeholder="Cerca fornitore..."
                className="w-full rounded-lg border p-2"
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
              />

              {supplierSearch.trim().length > 0 && supplierSearch.trim().length < 2 && (
                <div className="text-xs text-slate-500">
                  Scrivi almeno 2 caratteri.
                </div>
              )}

              {loadingSuppliers && (
                <div className="rounded border bg-slate-50 p-2 text-sm text-slate-500">
                  Ricerca fornitori in corso...
                </div>
              )}

              {!loadingSuppliers &&
                supplierSearchTouched &&
                supplierSearch.trim().length >= 2 &&
                supplierResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded border">
                    {supplierResults.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full border-b p-2 text-left text-sm hover:bg-gray-100 last:border-b-0"
                        onClick={() => selectSupplier(s)}
                      >
                        {s.code} — {s.name}
                      </button>
                    ))}
                  </div>
                )}

              {!loadingSuppliers &&
                supplierSearchTouched &&
                supplierSearch.trim().length >= 2 &&
                supplierResults.length === 0 && (
                  <div className="rounded border bg-slate-50 p-2 text-sm text-slate-500">
                    Nessun fornitore trovato.
                  </div>
                )}
            </div>

            <input
              placeholder="Ragione Sociale"
              className="w-full rounded-lg border bg-slate-50 p-2"
              value={supplierName}
              disabled
            />

            <input
              ref={supplierAmountInputRef}
              type="text"
              inputMode="decimal"
              placeholder="Importo"
              className="w-full rounded-lg border p-2"
              value={supplierAmountInput}
              onChange={(e) => {
                syncMoneyState(
                  e.target.value,
                  setSupplierAmountInput,
                  setSupplierAmount
                );
              }}
              onBlur={() => {
                blurMoneyState(supplierAmount, setSupplierAmountInput);
              }}
            />

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowModal(false);
                  resetSupplierModalState();
                }}
                className="rounded border px-4 py-2"
                type="button"
              >
                Annulla
              </button>

              <button
                onClick={addSupplierPayment}
                className="rounded bg-blue-600 px-4 py-2 text-white"
                type="button"
              >
                Salva
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <label className="mb-1 text-sm text-slate-600">{label}</label>
      <input
        className="rounded-lg border bg-slate-100 px-3 py-2"
        value={value}
        disabled
      />
    </div>
  );
}

function EditableField({
  label,
  value,
  setValue,
  disabled = false,
  type = "text",
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  disabled?: boolean;
  type?: "text" | "date";
}) {
  return (
    <div className="flex flex-col">
      <label className="mb-1 text-sm text-slate-600">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`rounded-lg border px-3 py-2 ${disabled ? "bg-slate-100" : ""}`}
        disabled={disabled}
      />
    </div>
  );
}

function EditableNumberField({
  label,
  value,
  setValue,
  disabled = false,
}: {
  label: string;
  value: number | null;
  setValue: (v: number | null) => void;
  disabled?: boolean;
}) {
  const displayValue = value === null ? "" : String(value);

  return (
    <div className="flex flex-col">
      <label className="mb-1 text-sm text-slate-600">{label}</label>
      <input
        type="number"
        step="0.01"
        value={displayValue}
        onChange={(e) => {
          setValue(parseMoney(e.target.value));
        }}
        className={`rounded-lg border px-3 py-2 ${disabled ? "bg-slate-100" : ""}`}
        disabled={disabled}
      />
    </div>
  );
}