"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SupplierPayment = {
  id: number;
  code: string;
  name: string;
  amount: number;
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
  const [totVersato, setTotVersato] = useState<number | null>(null);
  const [fondoCassaIniziale, setFondoCassaIniziale] = useState<number | null>(null);
  const [parziale1, setParziale1] = useState<number | null>(null);
  const [parziale2, setParziale2] = useState<number | null>(null);
  const [parziale3, setParziale3] = useState<number | null>(null);
  const [fondoCassa, setFondoCassa] = useState<number | null>(null);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [status, setStatus] = useState<SummaryStatus>("bozza");
  const [isClosed, setIsClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEditMainFields = !viewMode && !isClosed && status === "bozza";
  const canEditTotVersato = !viewMode && !isClosed && status !== "bozza";

  const pagamentoFornitori = useMemo(
    () => roundMoney(supplierPayments.reduce((sum, s) => sum + s.amount, 0)),
    [supplierPayments]
  );

  const totaleEsistenzaCassa = roundMoney(
    n(incassoTotale) - pagamentoFornitori - n(gvPagati) + n(lisPlus) + n(mooney)
  );

  const totale = roundMoney(totaleEsistenzaCassa + n(venditaGV) + n(venditaTabacchi));
  const versamento = roundMoney(totale - n(pos) - n(speseExtra));

  const daVersare = roundMoney(
    totVersato === null || totVersato === 0
      ? versamento
      : versamento - n(totVersato)
  );

  const deltaFondoCassaPercent = useMemo(() => {
    return computeDeltaPercent(fondoCassaIniziale, fondoCassa);
  }, [fondoCassaIniziale, fondoCassa]);

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
      setTotVersato(s.tot_versato ?? null);
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
          tot_versato: totVersato,
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

  async function salvaTotVersato() {
    if (isClosed) return;
    if (totVersato === null) {
      alert("Tot. Versato obbligatorio");
      return;
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
          tot_versato: totVersato,
          fondo_cassa_iniziale: fondoCassaIniziale,
          parziale_1: parziale1,
          parziale_2: parziale2,
          parziale_3: parziale3,
          fondo_cassa: fondoCassa,
          status,
          fornitori: supplierPayments,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        alert(json?.error || "Errore nel salvataggio");
        return;
      }

      alert("Tot. Versato salvato");
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
        <h2 className="mb-4 text-lg font-semibold">Pagamenti Fornitori</h2>

        <table className="w-full border text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="p-2 text-left">Codice</th>
              <th className="p-2 text-left">Ragione Sociale</th>
              <th className="p-2 text-right">Importo</th>
            </tr>
          </thead>
          <tbody>
            {supplierPayments.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{s.code}</td>
                <td className="p-2">{s.name}</td>
                <td className="p-2 text-right">{formatEuro(s.amount)}</td>
              </tr>
            ))}

            {supplierPayments.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-gray-500" colSpan={3}>
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
          <EditableNumberField
            label="Tot. Versato"
            value={totVersato}
            setValue={setTotVersato}
            disabled={!canEditTotVersato}
          />
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

      {!viewMode && !isClosed && (
        <div className="flex justify-end gap-3">
          {status === "bozza" && (
            <>
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
            </>
          )}

          {status === "completato" && (
            <button
              onClick={salvaTotVersato}
              disabled={saving}
              className="rounded-lg bg-green-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
              type="button"
            >
              {saving ? "Salvo..." : "Salva Tot. Versato"}
            </button>
          )}
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