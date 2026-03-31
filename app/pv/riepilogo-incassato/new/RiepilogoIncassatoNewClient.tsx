"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function n(value: number | null) {
  return value ?? 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeMoneyInput(value: string) {
  return value.replace(/\./g, ",");
}

function parseMoney(value: string): number | null {
  const raw = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (raw === "") return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;

  return roundMoney(parsed);
}

function formatMoneyInput(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  return roundMoney(value).toFixed(2).replace(".", ",");
}

function formatMoneyLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
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

function computeDeltaPercent(initial: number | null, current: number | null) {
  if (initial === null || current === null) return null;
  if (!Number.isFinite(initial) || !Number.isFinite(current)) return null;
  if (initial === 0) return null;

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

export default function RiepilogoIncassatoNewClient() {
  const router = useRouter();

  const [operatore, setOperatore] = useState("");
  const [data, setData] = useState(todayISO());

  const [incassoTotale, setIncassoTotale] = useState<number | null>(null);
  const [gvPagati, setGvPagati] = useState<number | null>(null);
  const [lisPlus, setLisPlus] = useState<number | null>(null);
  const [mooney, setMooney] = useState<number | null>(null);

  const [venditaGV, setVenditaGV] = useState<number | null>(null);
  const [venditaTabacchi, setVenditaTabacchi] = useState<number | null>(null);

  const [pos, setPos] = useState<number | null>(null);
  const [speseExtra, setSpeseExtra] = useState<number | null>(null);
  const [totVersato, setTotVersato] = useState<number | null>(null);
  const [fondoCassa, setFondoCassa] = useState<number | null>(null);

  const [fondoCassaIniziale, setFondoCassaIniziale] = useState<number | null>(null);
  const [parziale1, setParziale1] = useState<number | null>(null);
  const [parziale2, setParziale2] = useState<number | null>(null);
  const [parziale3, setParziale3] = useState<number | null>(null);
  const [loadingFondoIniziale, setLoadingFondoIniziale] = useState(true);
  const [fondoInizialeMsg, setFondoInizialeMsg] = useState<string | null>(null);

  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [showModal, setShowModal] = useState(false);

  const [supplierCode, setSupplierCode] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierAmount, setSupplierAmount] = useState<number | null>(null);

  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierSearchRow[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [supplierSearchTouched, setSupplierSearchTouched] = useState(false);

  const [saving, setSaving] = useState(false);

  const [incassoTotaleInput, setIncassoTotaleInput] = useState("");
  const [gvPagatiInput, setGvPagatiInput] = useState("");
  const [lisPlusInput, setLisPlusInput] = useState("");
  const [mooneyInput, setMooneyInput] = useState("");
  const [venditaGVInput, setVenditaGVInput] = useState("");
  const [venditaTabacchiInput, setVenditaTabacchiInput] = useState("");
  const [posInput, setPosInput] = useState("");
  const [speseExtraInput, setSpeseExtraInput] = useState("");
  const [totVersatoInput, setTotVersatoInput] = useState("");
  const [fondoCassaInput, setFondoCassaInput] = useState("");
  const [parziale1Input, setParziale1Input] = useState("");
  const [parziale2Input, setParziale2Input] = useState("");
  const [parziale3Input, setParziale3Input] = useState("");
  const [supplierAmountInput, setSupplierAmountInput] = useState("");

  const searchRequestIdRef = useRef(0);
  const supplierSearchInputRef = useRef<HTMLInputElement | null>(null);
  const supplierAmountInputRef = useRef<HTMLInputElement | null>(null);

  const pagamentoFornitori = roundMoney(
    supplierPayments.reduce((sum, s) => sum + s.amount, 0)
  );

  const totaleEsistenzaCassa = roundMoney(
    n(incassoTotale) - pagamentoFornitori - n(gvPagati) + n(lisPlus) + n(mooney)
  );

  const totale = roundMoney(totaleEsistenzaCassa + n(venditaGV) + n(venditaTabacchi));

  const versamento = roundMoney(totale - n(pos) - n(speseExtra));

  const daVersare = roundMoney(
    totVersato === null || totVersato === 0 ? versamento : versamento - n(totVersato)
  );

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

  function removeSupplier(id: number) {
    setSupplierPayments((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSupplierAmount(id: number, value: string) {
    const parsed = parseMoney(value) ?? 0;

    setSupplierPayments((prev) =>
      prev.map((s) =>
        s.id === id
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

  useEffect(() => {
    let cancelled = false;

    async function loadFondoCassaIniziale() {
      setLoadingFondoIniziale(true);
      setFondoInizialeMsg(null);

      try {
        const res = await fetch("/api/cash-summary/fondo-cassa-iniziale/get", {
          cache: "no-store",
        });

        const json = await res.json().catch(() => null);

        if (cancelled) return;

        if (!res.ok || !json?.ok) {
          setFondoCassaIniziale(null);
          setFondoInizialeMsg(
            json?.error || "Impossibile leggere il Fondo Cassa Iniziale."
          );
          return;
        }

        const fondo = Number(json?.row?.fondo_cassa_iniziale);
        if (Number.isFinite(fondo)) {
          setFondoCassaIniziale(roundMoney(fondo));
        } else {
          setFondoCassaIniziale(null);
        }
      } catch {
        if (cancelled) return;
        setFondoCassaIniziale(null);
        setFondoInizialeMsg("Impossibile leggere il Fondo Cassa Iniziale.");
      } finally {
        if (!cancelled) {
          setLoadingFondoIniziale(false);
        }
      }
    }

    loadFondoCassaIniziale();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submitWithStatus(status: "bozza" | "completato") {
    if (status === "completato") {
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
  const finalStatus = status;

  const res = await fetch("/api/cash-summary/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data,
      operatore: operatore.trim(),
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
      status: finalStatus,
      fornitori: supplierPayments,
    }),
  });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        alert(json?.error || "Errore nel salvataggio");
        return;
      }

      alert(status === "bozza" ? "Riepilogo salvato in bozza" : "Riepilogo completato");
      router.push("/pv/riepilogo-incassato");
    } catch {
      alert("Errore di rete");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">
            Nuovo Riepilogo Incassato
          </h1>

          <button
            type="button"
            onClick={() => router.push("/pv/riepilogo-incassato")}
            className="rounded-lg border px-4 py-2 hover:bg-gray-50"
          >
            Torna alla lista
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col">
            <label className="mb-1 text-sm text-slate-600">Data</label>
            <input
              type="date"
              className="rounded-lg border px-3 py-2"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-sm text-slate-600">Operatore</label>
            <input
              className="rounded-lg border px-3 py-2"
              value={operatore}
              onChange={(e) => setOperatore(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Esistenza Cassa</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <InputField
            label="Incasso Totale"
            value={incassoTotale}
            inputValue={incassoTotaleInput}
            setInputValue={setIncassoTotaleInput}
            setValue={setIncassoTotale}
          />

          <InputField
            label="Pagamento Fornitori"
            value={pagamentoFornitori}
            disabled
          />

          <InputField
            label="G&V Pagati"
            value={gvPagati}
            inputValue={gvPagatiInput}
            setInputValue={setGvPagatiInput}
            setValue={setGvPagati}
          />

          <InputField
            label="LIS+"
            value={lisPlus}
            inputValue={lisPlusInput}
            setInputValue={setLisPlusInput}
            setValue={setLisPlus}
          />

          <InputField
            label="MOONEY"
            value={mooney}
            inputValue={mooneyInput}
            setInputValue={setMooneyInput}
            setValue={setMooney}
          />

          <InputField
            label="Totale Esistenza Cassa"
            value={totaleEsistenzaCassa}
            disabled
          />
        </div>

        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Pagamenti Fornitori</h3>

            <button
              onClick={() => setShowModal(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white"
              type="button"
            >
              Aggiungi Fornitore
            </button>
          </div>

          <table className="w-full border text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">Codice</th>
                <th className="p-2 text-left">Ragione Sociale</th>
                <th className="p-2 text-right">Importo</th>
                <th className="p-2 text-right">Azioni</th>
              </tr>
            </thead>

            <tbody>
              {supplierPayments.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{s.code}</td>
                  <td className="p-2">{s.name}</td>
                  <td className="p-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full rounded border p-2 text-right"
                      value={formatMoneyInput(s.amount)}
                      onChange={(e) =>
                        updateSupplierAmount(s.id, normalizeMoneyInput(e.target.value))
                      }
                    />
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => removeSupplier(s.id)}
                      className="text-red-600"
                      type="button"
                    >
                      elimina
                    </button>
                  </td>
                </tr>
              ))}

              {supplierPayments.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-gray-500" colSpan={4}>
                    Nessun pagamento fornitore inserito.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Vendite</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label="Vendita G&V"
            value={venditaGV}
            inputValue={venditaGVInput}
            setInputValue={setVenditaGVInput}
            setValue={setVenditaGV}
          />

          <InputField
            label="Vendita Tabacchi"
            value={venditaTabacchi}
            inputValue={venditaTabacchiInput}
            setInputValue={setVenditaTabacchiInput}
            setValue={setVenditaTabacchi}
          />
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Calcoli</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <InputField label="Totale" value={totale} disabled />

          <InputField
            label="POS"
            value={pos}
            inputValue={posInput}
            setInputValue={setPosInput}
            setValue={setPos}
          />

          <InputField
            label="Prelievo"
            value={speseExtra}
            inputValue={speseExtraInput}
            setInputValue={setSpeseExtraInput}
            setValue={setSpeseExtra}
          />

          <InputField label="Versamento" value={versamento} disabled />

          <InputField label="Da Versare" value={daVersare} disabled />

        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Fondo Cassa</h2>

        {fondoInizialeMsg && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {fondoInizialeMsg}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <ReadOnlyField
            label="Fondo Cassa Iniziale"
            value={loadingFondoIniziale ? "Caricamento..." : formatMoneyLabel(fondoCassaIniziale)}
          />

          <InputField
            label="Parziale 1"
            value={parziale1}
            inputValue={parziale1Input}
            setInputValue={setParziale1Input}
            setValue={setParziale1}
          />

          <InputField
            label="Parziale 2"
            value={parziale2}
            inputValue={parziale2Input}
            setInputValue={setParziale2Input}
            setValue={setParziale2}
          />

          <InputField
            label="Parziale 3"
            value={parziale3}
            inputValue={parziale3Input}
            setInputValue={setParziale3Input}
            setValue={setParziale3}
          />

          <InputField
            label="Fondo Cassa"
            value={fondoCassa}
            inputValue={fondoCassaInput}
            setInputValue={setFondoCassaInput}
            setValue={setFondoCassa}
          />

          <div className="rounded-xl border bg-slate-50 p-3">
            <div className="text-xs text-gray-500">Differenza % Fondo Cassa</div>
            <div
              className={`mt-1 text-lg font-semibold ${
                deltaFondoCassaPercent === null
                  ? "text-slate-700"
                  : deltaFondoCassaPercent < 0
                    ? "text-red-700"
                    : deltaFondoCassaPercent > 0
                      ? "text-green-700"
                      : "text-slate-900"
              }`}
            >
              {formatPercentLabel(deltaFondoCassaPercent)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Confronto tra Fondo Cassa Iniziale e Fondo Cassa finale.
            </div>
          </div>
        </div>
      </div>

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
          className="rounded-lg bg-green-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
          type="button"
        >
          {saving ? "Salvo..." : "Completa"}
        </button>
      </div>

      {showModal && (
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

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-slate-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-base font-medium text-slate-900">{value}</div>
    </div>
  );
}

function InputField({
  label,
  value,
  inputValue,
  setInputValue,
  setValue,
  disabled = false,
}: {
  label: string;
  value: number | null;
  inputValue?: string;
  setInputValue?: (v: string) => void;
  setValue?: (v: number | null) => void;
  disabled?: boolean;
}) {
  const displayValue = disabled
    ? formatMoneyInput(value)
    : (inputValue ?? "");

  return (
    <div className="flex flex-col">
      <label className="mb-1 text-sm text-slate-600">{label}</label>

      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={(e) => {
          if (!setValue || !setInputValue || disabled) return;

          const sanitized = sanitizeMoneyTyping(e.target.value);
          setInputValue(sanitized);
          setValue(parseMoney(sanitized));
        }}
        onBlur={() => {
          if (!setInputValue || disabled) return;
          setInputValue(formatMoneyInput(value));
        }}
        className={`rounded-lg border px-3 py-2 ${disabled ? "bg-slate-100" : ""}`}
        disabled={disabled}
      />
    </div>
  );
}