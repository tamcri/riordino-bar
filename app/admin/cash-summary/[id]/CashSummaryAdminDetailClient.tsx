"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PvJoin = {
  id?: string;
  code?: string;
  name?: string;
};

type SummaryRow = {
  id: string;
  pv_id: string;
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
  fondo_cassa_iniziale: number | null;
  parziale_1: number | null;
  parziale_2: number | null;
  parziale_3: number | null;
  fondo_cassa: number | null;
  status?: string | null;
  is_closed: boolean;
  pvs?: PvJoin | PvJoin[] | null;
};

type SupplierRow = {
  id: string;
  supplier_code?: string | null;
  supplier_name?: string | null;
  amount?: number | null;
};

type SupplierSearchRow = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
};

type FieldCommentKey =
  | "incasso_totale"
  | "gv_pagati"
  | "lis_plus"
  | "mooney"
  | "vendita_gv"
  | "vendita_tabacchi"
  | "pos"
  | "spese_extra"
  | "tot_versato"
  | "fondo_cassa_iniziale"
  | "parziale_1"
  | "parziale_2"
  | "parziale_3"
  | "fondo_cassa";

type FieldCommentsMap = Partial<Record<FieldCommentKey, string>>;

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
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

function formatEuro(value: unknown) {
  return n(value).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function pvLabelFromJoin(pvs: SummaryRow["pvs"]) {
  const row = Array.isArray(pvs) ? pvs[0] : pvs;
  const code = String(row?.code ?? "").trim();
  const name = String(row?.name ?? "").trim();

  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  if (code) return code;
  return "PV";
}

function computeFondoDeltaPercent(initial: number | null, current: number | null) {
  const i = Number(initial);
  const c = Number(current);

  if (!Number.isFinite(i) || !Number.isFinite(c) || i === 0) return null;
  return roundMoney(((c - i) / i) * 100);
}

export default function CashSummaryAdminDetailClient({ id }: { id: string }) {
  const router = useRouter();

  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [fieldComments, setFieldComments] = useState<FieldCommentsMap>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierSearchRow[]>([]);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierSearchRow | null>(null);
  const [supplierAmountInput, setSupplierAmountInput] = useState("");

  const supplierSearchInputRef = useRef<HTMLInputElement | null>(null);
  const supplierAmountInputRef = useRef<HTMLInputElement | null>(null);

  async function loadDetail() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch(`/api/cash-summary/admin-get?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setSummary(null);
        setSuppliers([]);
        setFieldComments({});
        setMsg(json?.error || "Errore caricamento dettaglio");
        return;
      }

      setSummary((json.summary ?? null) as SummaryRow | null);
      setSuppliers(Array.isArray(json.suppliers) ? json.suppliers : []);
      setFieldComments(
        json?.field_comments && typeof json.field_comments === "object"
          ? json.field_comments
          : {}
      );
    } catch {
      setSummary(null);
      setSuppliers([]);
      setFieldComments({});
      setMsg("Errore di rete");
    } finally {
      setLoading(false);
    }
  }

  async function saveSummary() {
    if (!summary) return;

    setSaving(true);
    setMsg(null);

    try {
      const res = await fetch("/api/cash-summary/admin-save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...summary,
          suppliers,
          field_comments: fieldComments,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore salvataggio");
        return;
      }

      router.push("/admin/cash-summary");
    } catch {
      setMsg("Errore di rete");
    } finally {
      setSaving(false);
    }
  }

  async function searchSuppliers(q: string) {
    setSupplierLoading(true);

    try {
      const res = await fetch(`/api/suppliers/search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setSupplierResults([]);
        return;
      }

      setSupplierResults(Array.isArray(json.rows) ? json.rows : []);
    } catch {
      setSupplierResults([]);
    } finally {
      setSupplierLoading(false);
    }
  }

  function resetSupplierModal() {
    setSupplierSearch("");
    setSupplierResults([]);
    setSelectedSupplier(null);
    setSupplierAmountInput("");
    setSupplierLoading(false);
  }

  function addSupplierFromModal() {
    const parsedAmount = parseMoney(supplierAmountInput);

    if (!selectedSupplier || parsedAmount === null) return;

    setSuppliers((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        supplier_code: selectedSupplier.code ?? "",
        supplier_name: selectedSupplier.name ?? "",
        amount: roundMoney(parsedAmount),
      },
    ]);

    setSupplierModalOpen(false);
    resetSupplierModal();
  }

  function updateSupplier(index: number, patch: Partial<SupplierRow>) {
    setSuppliers((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  function removeSupplierRow(index: number) {
    setSuppliers((prev) => prev.filter((_, i) => i !== index));
  }

  function updateFieldComment(fieldKey: FieldCommentKey, value: string) {
    setFieldComments((prev) => ({
      ...prev,
      [fieldKey]: value,
    }));
  }

  function clearFieldComment(fieldKey: FieldCommentKey) {
    setFieldComments((prev) => ({
      ...prev,
      [fieldKey]: "",
    }));
  }

  useEffect(() => {
    loadDetail();
  }, [id]);

  useEffect(() => {
    if (!supplierModalOpen) return;

    setTimeout(() => {
      const input = supplierSearchInputRef.current;
      if (!input) return;
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }, 0);

    const q = supplierSearch.trim();
    const t = setTimeout(() => {
      if (q.length >= 2) {
        searchSuppliers(q);
      } else {
        setSupplierResults([]);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [supplierSearch, supplierModalOpen]);

  const pvLabel = useMemo(() => {
    if (!summary) return "PV";
    return pvLabelFromJoin(summary.pvs);
  }, [summary]);

  const pagamentoFornitori = useMemo(() => {
    return roundMoney(suppliers.reduce((sum, row) => sum + n(row.amount), 0));
  }, [suppliers]);

  const totaleEsistenzaCassa = useMemo(() => {
    if (!summary) return 0;
    return roundMoney(
      n(summary.incasso_totale) -
        pagamentoFornitori -
        n(summary.gv_pagati) +
        n(summary.lis_plus) +
        n(summary.mooney)
    );
  }, [summary, pagamentoFornitori]);

  const totale = useMemo(() => {
    if (!summary) return 0;
    return roundMoney(totaleEsistenzaCassa + n(summary.vendita_gv) + n(summary.vendita_tabacchi));
  }, [summary, totaleEsistenzaCassa]);

  const versamento = useMemo(() => {
    if (!summary) return 0;
    return roundMoney(totale - n(summary.pos) - n(summary.spese_extra));
  }, [summary, totale]);

  const daVersare = useMemo(() => {
    if (!summary) return 0;
    return roundMoney(
      summary.tot_versato === null || n(summary.tot_versato) === 0
        ? versamento
        : versamento - n(summary.tot_versato)
    );
  }, [summary, versamento]);

  const fondoDeltaPercent = useMemo(() => {
    if (!summary) return null;
    return computeFondoDeltaPercent(summary.fondo_cassa_iniziale, summary.fondo_cassa);
  }, [summary]);

  if (loading) {
    return (
      <div className="rounded-2xl border bg-white p-6 text-sm text-gray-600">
        Caricamento...
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-2xl border bg-white p-6 text-sm text-gray-700">
        {msg || "Riepilogo non trovato."}
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

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Intestazione</h2>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Punto Vendita" value={pvLabel} />

          <EditableTextField
            label="Data"
            type="date"
            value={summary.data}
            onChange={(value) => setSummary({ ...summary, data: value })}
          />

          <EditableTextField
            label="Operatore"
            value={summary.operatore}
            onChange={(value) => setSummary({ ...summary, operatore: value })}
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Esistenza Cassa</h2>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <EditableNumberField
            label="Incasso Totale"
            value={summary.incasso_totale}
            onChange={(value) => setSummary({ ...summary, incasso_totale: value })}
            comment={fieldComments.incasso_totale ?? ""}
            onCommentChange={(value) => updateFieldComment("incasso_totale", value)}
            onCommentClear={() => clearFieldComment("incasso_totale")}
          />

          <Field label="Pagamento Fornitori" value={formatEuro(pagamentoFornitori)} />

          <EditableNumberField
            label="G&V Pagati"
            value={summary.gv_pagati}
            onChange={(value) => setSummary({ ...summary, gv_pagati: value })}
            comment={fieldComments.gv_pagati ?? ""}
            onCommentChange={(value) => updateFieldComment("gv_pagati", value)}
            onCommentClear={() => clearFieldComment("gv_pagati")}
          />

          <EditableNumberField
            label="LIS+"
            value={summary.lis_plus}
            onChange={(value) => setSummary({ ...summary, lis_plus: value })}
            comment={fieldComments.lis_plus ?? ""}
            onCommentChange={(value) => updateFieldComment("lis_plus", value)}
            onCommentClear={() => clearFieldComment("lis_plus")}
          />

          <EditableNumberField
            label="MOONEY"
            value={summary.mooney}
            onChange={(value) => setSummary({ ...summary, mooney: value })}
            comment={fieldComments.mooney ?? ""}
            onCommentChange={(value) => updateFieldComment("mooney", value)}
            onCommentClear={() => clearFieldComment("mooney")}
          />

          <Field label="Totale Esistenza Cassa" value={formatEuro(totaleEsistenzaCassa)} />
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Pagamenti Fornitori</h2>

          <button
            type="button"
            onClick={() => {
              setSupplierModalOpen(true);
              resetSupplierModal();
            }}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Aggiungi fornitore
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">Codice</th>
                <th className="p-2 text-left">Ragione Sociale</th>
                <th className="p-2 text-right">Importo</th>
                <th className="p-2 text-center">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((row, index) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">
                    <input
                      className="w-full rounded border p-2"
                      value={row.supplier_code ?? ""}
                      onChange={(e) =>
                        updateSupplier(index, { supplier_code: e.target.value })
                      }
                    />
                  </td>
                  <td className="p-2">
                    <input
                      className="w-full rounded border p-2"
                      value={row.supplier_name ?? ""}
                      onChange={(e) =>
                        updateSupplier(index, { supplier_name: e.target.value })
                      }
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full rounded border p-2 text-right"
                      value={row.amount ?? ""}
                      onChange={(e) => {
                        updateSupplier(index, {
                          amount: parseMoney(e.target.value),
                        });
                      }}
                    />
                  </td>
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeSupplierRow(index)}
                      className="text-red-600 hover:underline"
                    >
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}

              {suppliers.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-gray-500" colSpan={4}>
                    Nessun pagamento fornitore registrato.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Vendite e Calcoli</h2>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <EditableNumberField
            label="Vendita G&V"
            value={summary.vendita_gv}
            onChange={(value) => setSummary({ ...summary, vendita_gv: value })}
            comment={fieldComments.vendita_gv ?? ""}
            onCommentChange={(value) => updateFieldComment("vendita_gv", value)}
            onCommentClear={() => clearFieldComment("vendita_gv")}
          />

          <EditableNumberField
            label="Vendita Tabacchi"
            value={summary.vendita_tabacchi}
            onChange={(value) => setSummary({ ...summary, vendita_tabacchi: value })}
            comment={fieldComments.vendita_tabacchi ?? ""}
            onCommentChange={(value) => updateFieldComment("vendita_tabacchi", value)}
            onCommentClear={() => clearFieldComment("vendita_tabacchi")}
          />

          <Field label="Totale" value={formatEuro(totale)} />

          <EditableNumberField
            label="POS"
            value={summary.pos}
            onChange={(value) => setSummary({ ...summary, pos: value })}
            comment={fieldComments.pos ?? ""}
            onCommentChange={(value) => updateFieldComment("pos", value)}
            onCommentClear={() => clearFieldComment("pos")}
          />

          <EditableNumberField
            label="Prelievo"
            value={summary.spese_extra ?? null}
            onChange={(value) => setSummary({ ...summary, spese_extra: value })}
            comment={fieldComments.spese_extra ?? ""}
            onCommentChange={(value) => updateFieldComment("spese_extra", value)}
            onCommentClear={() => clearFieldComment("spese_extra")}
          />

          <Field label="Versamento" value={formatEuro(versamento)} />

          <Field label="Da Versare" value={formatEuro(daVersare)} />

          <EditableNumberField
            label="Tot. Versato"
            value={summary.tot_versato}
            onChange={(value) => setSummary({ ...summary, tot_versato: value })}
            comment={fieldComments.tot_versato ?? ""}
            onCommentChange={(value) => updateFieldComment("tot_versato", value)}
            onCommentClear={() => clearFieldComment("tot_versato")}
          />

          <Field label="Stato" value={summary.status?.trim() || (summary.is_closed ? "chiuso" : "aperto")} />
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">Fondo Cassa</h2>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <EditableNumberField
            label="Fondo Cassa Iniziale"
            value={summary.fondo_cassa_iniziale}
            onChange={(value) => setSummary({ ...summary, fondo_cassa_iniziale: value })}
            comment={fieldComments.fondo_cassa_iniziale ?? ""}
            onCommentChange={(value) => updateFieldComment("fondo_cassa_iniziale", value)}
            onCommentClear={() => clearFieldComment("fondo_cassa_iniziale")}
          />

          <EditableNumberField
            label="Parziale 1"
            value={summary.parziale_1}
            onChange={(value) => setSummary({ ...summary, parziale_1: value })}
            comment={fieldComments.parziale_1 ?? ""}
            onCommentChange={(value) => updateFieldComment("parziale_1", value)}
            onCommentClear={() => clearFieldComment("parziale_1")}
          />

          <EditableNumberField
            label="Parziale 2"
            value={summary.parziale_2}
            onChange={(value) => setSummary({ ...summary, parziale_2: value })}
            comment={fieldComments.parziale_2 ?? ""}
            onCommentChange={(value) => updateFieldComment("parziale_2", value)}
            onCommentClear={() => clearFieldComment("parziale_2")}
          />

          <EditableNumberField
            label="Parziale 3"
            value={summary.parziale_3}
            onChange={(value) => setSummary({ ...summary, parziale_3: value })}
            comment={fieldComments.parziale_3 ?? ""}
            onCommentChange={(value) => updateFieldComment("parziale_3", value)}
            onCommentClear={() => clearFieldComment("parziale_3")}
          />

          <EditableNumberField
            label="Fondo Cassa"
            value={summary.fondo_cassa}
            onChange={(value) => setSummary({ ...summary, fondo_cassa: value })}
            comment={fieldComments.fondo_cassa ?? ""}
            onCommentChange={(value) => updateFieldComment("fondo_cassa", value)}
            onCommentClear={() => clearFieldComment("fondo_cassa")}
          />

          <Field label="Differenza % Fondo Cassa" value={formatPercent(fondoDeltaPercent)} />
        </div>
      </section>

      {supplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Ricerca fornitore</h3>
              <button
                type="button"
                onClick={() => {
                  setSupplierModalOpen(false);
                  resetSupplierModal();
                }}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Chiudi
              </button>
            </div>

            <div className="mt-4">
              <input
                ref={supplierSearchInputRef}
                type="text"
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                placeholder="Cerca per codice o nome..."
                className="w-full rounded-lg border bg-white p-2"
              />
            </div>

            <div className="mt-4 max-h-52 space-y-2 overflow-y-auto">
              {supplierLoading && (
                <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">
                  Ricerca...
                </div>
              )}

              {!supplierLoading &&
                supplierResults.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setSelectedSupplier(row);
                      setSupplierAmountInput("");

                      setTimeout(() => {
                        const input = supplierAmountInputRef.current;
                        if (!input) return;
                        input.focus();
                        const len = input.value.length;
                        input.setSelectionRange(len, len);
                      }, 0);
                    }}
                    className={`block w-full rounded-lg border p-3 text-left hover:bg-gray-50 ${
                      selectedSupplier?.id === row.id ? "border-slate-900 bg-slate-50" : ""
                    }`}
                  >
                    <div className="font-medium text-slate-900">{row.name}</div>
                    <div className="text-sm text-gray-500">{row.code}</div>
                  </button>
                ))}

              {!supplierLoading &&
                supplierSearch.trim().length >= 2 &&
                supplierResults.length === 0 && (
                  <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">
                    Nessun fornitore trovato.
                  </div>
                )}

              {!supplierLoading && supplierSearch.trim().length < 2 && (
                <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">
                  Scrivi almeno 2 caratteri per cercare.
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="text"
                className="w-full rounded-lg border bg-slate-50 p-2"
                value={selectedSupplier ? `${selectedSupplier.code} — ${selectedSupplier.name}` : ""}
                placeholder="Fornitore selezionato"
                disabled
              />

              <input
                ref={supplierAmountInputRef}
                type="text"
                inputMode="decimal"
                className="w-full rounded-lg border bg-white p-2 text-right"
                value={supplierAmountInput}
                placeholder="Importo"
                onChange={(e) => setSupplierAmountInput(e.target.value)}
              />
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setSupplierModalOpen(false);
                  resetSupplierModal();
                }}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
              >
                Annulla
              </button>

              <button
                type="button"
                onClick={addSupplierFromModal}
                disabled={!selectedSupplier || parseMoney(supplierAmountInput) === null}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Aggiungi
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={saveSummary}
          disabled={saving}
          className="rounded-xl bg-slate-900 px-6 py-3 text-white hover:bg-slate-800 disabled:opacity-60"
          type="button"
        >
          {saving ? "Salvo..." : "Salva modifiche"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-medium text-slate-900">{value}</div>
    </div>
  );
}

function EditableNumberField({
  label,
  value,
  onChange,
  comment,
  onCommentChange,
  onCommentClear,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  comment?: string;
  onCommentChange?: (value: string) => void;
  onCommentClear?: () => void;
}) {
  const [showComment, setShowComment] = useState(false);
  const hasComment = Boolean(comment && comment.trim() !== "");

  return (
    <div className="rounded-xl border bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <input
        type="number"
        step="0.01"
        className="mt-1 w-full rounded-lg border bg-white p-2"
        value={value ?? ""}
        onChange={(e) => {
          onChange(parseMoney(e.target.value));
        }}
      />

      {onCommentChange && (
        <div className="mt-3">
          {!showComment ? (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowComment(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5 text-xs text-gray-600 hover:bg-white"
              >
                <span className="text-sm font-semibold leading-none">+</span>
                <span>Nota</span>
              </button>

              {hasComment && (
                <button
                  type="button"
                  onClick={() => setShowComment(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                >
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Nota presente
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-xs text-gray-500">Nota</div>
                <div className="flex items-center gap-3">
                  {hasComment && onCommentClear && (
                    <button
                      type="button"
                      onClick={onCommentClear}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Cancella
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowComment(false)}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    Chiudi
                  </button>
                </div>
              </div>

              <textarea
                className="min-h-[78px] w-full rounded-lg border bg-white p-2 text-sm"
                placeholder="Aggiungi una nota su questo campo..."
                value={comment ?? ""}
                onChange={(e) => onCommentChange(e.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditableTextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
}) {
  return (
    <div className="rounded-xl border bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <input
        type={type}
        className="mt-1 w-full rounded-lg border bg-white p-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}